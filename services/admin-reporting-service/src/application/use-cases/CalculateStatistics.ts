/**
 * Calculo de las estadisticas diarias (RF113, RF114).
 *
 * SRS: RF113 (metricas y series), RF114 (filtros por periodo), A-3 del backlog.
 *
 * `pa_admin.statistics_snapshot` se leia y no la escribia nadie: el modulo de
 * reportes existia entero y devolvia series vacias. Este caso de uso es el lado
 * que faltaba.
 *
 * Dos decisiones que conviene no pasar por alto:
 *
 * 1. Las formulas viven aqui, en el dominio, y no en el SQL. El nombre de una
 *    metrica que no lleva su formula escrita es un numero sin significado para
 *    quien lo lee, y el SRS las expone al administrador.
 * 2. Las granularidades no son equivalentes. Una metrica `diaria` cuenta hechos de
 *    una fecha y se puede graficar como serie. Una `instantanea` es el estado en ese
 *    momento: repetirla manana da otro numero, y por eso no se promedia ni se
 *    suma en un rango. Mezclarlas en el mismo informe daria graficos que mienten.
 */
import {
  type DefinicionMetrica,
  type IEstadisticasCalculadora,
  type IEstadisticasSnapshotRepository,
  type PuntoCalculado,
} from '../../domain';
import { AppError } from '@punto-amigo/shared';

/** Dimension reservada para el agregado, tal y como la usa `uq_snapshot_point`. */
export const DIMENSION_TOTAL = 'TOTAL';

/**
 * Catalogo inicial de metricas.
 *
 * Es deliberadamente corto. Cada entrada declara su formula para que se pueda
 * auditar, y `requiere` para que la dependencia de datos ajenos quede a la vista en
 * el dominio y no escondida en el infraestructura. Si una metrica necesita una
 * tabla que no esta en esa lista, no se anade: se anade la tabla al ADR antes.
 *
 * Nota sobre `tasa_cobertura`: se calcula contra `necesidad` abierta, no contra
 * necesidades publicadas ese dia. La cobertura de un dia vale cero casi siempre
 * (una necesidad abierta ayer ya no esta abierta hoy) y la agregado daria una
 * serie plana que no significa nada.
 */
export const CATALOGO_METRICAS: readonly DefinicionMetrica[] = [
  {
    nombre: 'necesidades_publicadas',
    descripcion: 'Necesidades publicadas por dia y estado actual.',
    formula:
      'Cuenta de necesidades sin borrado logico cuya fecha de publicacion cae en la fecha del calculo, agrupada por su estado actual.',
    granularidad: 'diaria',
    dimension: 'estado',
    requiere: ['pa_request.necesidad'],
  },
  {
    nombre: 'propuestas_enviadas',
    descripcion: 'Propuestas enviadas por dia y estado actual.',
    formula:
      'Cuenta de propuestas sin borrado logico cuya fecha de envio cae en la fecha del calculo, agrupada por su estado actual.',
    granularidad: 'diaria',
    dimension: 'estado',
    requiere: ['pa_request.propuesta'],
  },
  {
    nombre: 'prestadores_por_estado',
    descripcion: 'Prestadores registrados por estado de habilitacion.',
    formula:
      'Cuenta de prestadores replicados en el catalogo, agrupada por estado. Es una fotografia: refleja el estado al calcular, no altas de ese dia.',
    granularidad: 'instantanea',
    dimension: 'estado',
    requiere: ['pa_catalog.prestador_ref'],
  },
  {
    nombre: 'servicios_por_estado',
    descripcion: 'Servicios publicados por estado.',
    formula:
      'Cuenta de servicios sin borrado logico, agrupada por estado. Es una fotografia: refleja el estado al calcular, no altas de ese dia.',
    granularidad: 'instantanea',
    dimension: 'estado',
    requiere: ['pa_catalog.servicio'],
  },
  {
    nombre: 'valoracion_media',
    descripcion: 'Valoracion media diaria, sobre las valoraciones ya visibles.',
    formula:
      'Promedio de puntuacion de las calificaciones de la fecha del calculo que estan publicadas (visible_at con valor) y no ocultas por moderacion.',
    granularidad: 'diaria',
    dimension: null,
    requiere: ['pa_rating.calificacion'],
  },
  {
    nombre: 'tasa_cobertura',
    descripcion: 'Porcentaje de necesidades abiertas que ya recibieron al menos una propuesta.',
    formula:
      'Necesidades ABIERTAS con al menos una propuesta en estado ENVIADA o ACEPTADA, dividido entre el total de necesidades ABIERTAS, por 100. Si no hay necesidades abiertas la tasa es 0, no indefinida.',
    granularidad: 'instantanea',
    dimension: null,
    requiere: ['pa_request.necesidad', 'pa_request.propuesta'],
  },
];

/** Solo el catalogo es dominio: por eso vive en la capa de aplicacion y no aqui. */
export interface CalculateStatisticsUseCase {
  ejecutar(fecha?: string): Promise<{ puntos: number; metricas: number }>;
}

/**
 * Calcula todas las metricas del catalogo y las guarda en la instantanea diaria.
 *
 * Se ejecuta al arrancar y luego en cada tick. Que sea idempotente no es
 * opcional: dos vueltas para la misma fecha tienen que converger al mismo estado,
 * o la tabla growaria con filas repetidas que el grafico leeria como actividad.
 */
export class CalculateStatistics implements CalculateStatisticsUseCase {
  constructor(
    private readonly calculadora: IEstadisticasCalculadora,
    private readonly snapshots: IEstadisticasSnapshotRepository
  ) {}

  async ejecutar(fecha?: string): Promise<{ puntos: number; metricas: number }> {
    const dia = fecha ?? fechaLocal();

    // El snapshot es unico por (fecha, metrica, dimension), asi que la fecha tiene
    // que ser la que guarda la tabla y no un ISO con hora: `DATE` trunca y el
    // indice unico no saltaria.
    const puntos: PuntoCalculado[] = [];

    for (const definicion of CATALOGO_METRICAS) {
      const calculados = await this.calculadora.calcular(definicion.nombre, dia);
      puntos.push(...calculados);
    }

    const guardados = await this.snapshots.guardar(dia, puntos, new Date());

    return { puntos: guardados, metricas: CATALOGO_METRICAS.length };
  }
}

/**
 * Fecha local en formato `YYYY-MM-DD`.
 *
 * No `toISOString()`: eso convierte a UTC y cerca de medianoche devuelve el dia
 * siguiente, que es la clase de bug que hace que un reporte de "hoy" aparezca
 * manana. El snapshot se indexa por fecha civil del servidor de base de datos.
 */
function fechaLocal(): string {
  const ahora = new Date();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const dia = String(ahora.getDate()).padStart(2, '0');
  return `${ahora.getFullYear()}-${mes}-${dia}`;
}

export function buscarMetrica(nombre: string): DefinicionMetrica | undefined {
  return CATALOGO_METRICAS.find((m) => m.nombre === nombre);
}

export function exigirMetrica(nombre: string): DefinicionMetrica {
  const definicion = buscarMetrica(nombre);
  if (!definicion) {
    throw AppError.validation(
      `metrica desconocida: ${nombre}. Disponibles: ${CATALOGO_METRICAS.map((m) => m.nombre).join(', ')}`
    );
  }
  return definicion;
}
