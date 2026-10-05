/**
 * Consultas que alimentan `pa_admin.statistics_snapshot`.
 *
 * SRS: RF113, A-3 del backlog. Excepcion de lectura: ADR-005.
 *
 * Cada consulta produce el desglose por dimension y el agregado TOTAL. Se
 * resuelven con dos sentencias porque MySQL no tiene ROLLUP: el desglose no se
 * puede sumar en SQL, y pedirlo en el cliente seria rehacer la cuenta que el motor
 * ya ha hecho.
 *
 * Un detalle que no es negociable: los borrados logicos. Las tablas de dominio
 * usan `softDelete`, asi que `deleted_at IS NULL` va en todas. Contar sin ese
 * filtro daria metricas que crecen cuando se borra, que es justo el defecto que
 * hace que un grafico de altas no cuadre con la base.
 *
 * Las tablas van cualificadas con su esquema a proposito. La conexion de este
 * servicio tiene `pa_admin` como base por defecto, asi que un `knex('necesidad')`
 * buscaria `pa_admin.necesidad` y fallaria: el nombre corto no resolveria al esquema
 * ajeno. Y cuando falla, falla con `ER_NO_SUCH_TABLE`, que manda a buscar una tabla
 * que nadie ha borrado, en el sitio equivocado.
 *
 * Las consultas se escriben una a una, sin un generico de conteo, porque cada tabla
 * trae su propio filtro y un helper que los esconda termina repartiendo filas de
 * mas: es lo que pasaria con `pa_catalog.servicio`, que necesita `deleted_at IS NULL`,
 * y con `pa_catalog.prestador_ref`, que no tiene esa columna.
 */
import type { Knex } from 'knex';

import { DIMENSION_TOTAL, buscarMetrica } from '../../application/use-cases/CalculateStatistics';
import type { IEstadisticasCalculadora, PuntoCalculado } from '../../domain';

/**
 * Fila de conteo o promedio que devuelve una consulta de la calculadora.
 *
 * `dimension` falta en las consultas de total, y `valor` es opcional porque knex lo
 * tipa como opcional en sus selecciones aunque el alias este. Los dos casos se
 * resuelven al leer, nunca al escribir.
 */
interface FilaAgregada {
  dimension?: string | null;
  valor?: string | number | null;
}

/**
 * Una consulta de calculo produce el desglose por dimension y el total.
 *
 * `desglose` es opcional: las metricas declaradas con `dimension: null` en el
 * catalogo solo tienen total, y no tiene sentido pedirle al motor un corte que el
 * dominio ya ha decidido que no existe.
 *
 * El desglose trae la dimension con el alias `dimension`, no con el nombre de su
 * columna. No es cosmetico: el lector de estas filas solo mira `dimension`, y si la
 * fila llega con `estado` el valor cae al valor por defecto y TODOS los cortes
 * terminan guardados como `TOTAL`. El error no se ve al escribir, porque el guardado
 * es un `ON DUPLICATE KEY UPDATE` y MySQL resuelve el duplicado de la misma sentencia
 * sin protestarlo: el desglose se pierde y el total queda bien. Solo se nota al
 * graficar, que es el peor sitio posible para enterarse de que algo va mal.
 */
type ConsultaCalculo = (
  knex: Knex,
  fecha: string
) => {
  desglose?: () => PromiseLike<FilaAgregada[]>;
  total: () => PromiseLike<FilaAgregada[]>;
};

/** Adapta el resultado de un constructor de consultas de knex al tipo de fila. */
async function comoFilas(consulta: () => PromiseLike<unknown[]>): Promise<FilaAgregada[]> {
  return (await consulta()) as FilaAgregada[];
}

/**
 * Adapta el resultado de `knex.raw`, que NO es el mismo que el de un constructor.
 *
 * `knex.raw()` se resuelve como la pareja `[filas, campos]`, mientras que
 * `knex('tabla')` se resuelve directamente en las filas. Confundirlos no da un error:
 * la fila pasa a ser el array de filas, `fila.valor` pasa a ser `undefined` y el
 * `?? 0` convierte un 50 correcto en un 0 sin error de MySQL, sin excepcion y sin
 * fila quejosa. Por eso van dos adaptadores y no uno con heuristicas.
 */
async function comoFilasDeCrudo(consulta: () => PromiseLike<unknown>): Promise<FilaAgregada[]> {
  const [filas] = (await consulta()) as [unknown[], unknown];
  return filas as FilaAgregada[];
}

export class KnexEstadisticasCalculadora implements IEstadisticasCalculadora {
  constructor(private readonly knex: Knex) {}

  async calcular(nombre: string, fecha: string): Promise<readonly PuntoCalculado[]> {
    const definicion = buscarMetrica(nombre);
    if (!definicion) {
      throw new Error(`KnexEstadisticasCalculadora: metrica fuera del catalogo: ${nombre}`);
    }

    const consulta = CONSULTAS[nombre];
    if (!consulta) {
      throw new Error(`KnexEstadisticasCalculadora: ${nombre} no tiene consulta implementada`);
    }

    const { desglose, total } = consulta(this.knex, fecha);
    const puntos: PuntoCalculado[] = [];

    if (definicion.dimension !== null && desglose) {
      const filas = await desglose();
      for (const fila of filas) {
        puntos.push({
          metrica: nombre,
          dimension: String(fila.dimension ?? DIMENSION_TOTAL),
          valor: Number(fila.valor ?? 0),
        });
      }
    }

    const filasTotal = await total();
    puntos.push({
      metrica: nombre,
      dimension: DIMENSION_TOTAL,
      valor: Number(filasTotal[0]?.valor ?? 0),
    });

    return puntos;
  }
}

/** El mismo criterio de necesidad abierta, usado por el numerador y el denominador. */
const COBERTURA_SQL = `
  SELECT COALESCE(
    ROUND(
      100 * COUNT(DISTINCT CASE WHEN p.id_necesidad IS NOT NULL THEN n.id_necesidad END)
      / NULLIF(COUNT(DISTINCT n.id_necesidad), 0),
      4
    ),
    0
  ) AS valor
  FROM pa_request.necesidad n
  LEFT JOIN pa_request.propuesta p
    ON p.id_necesidad = n.id_necesidad
   AND p.deleted_at IS NULL
   AND p.estado IN ('ENVIADA', 'ACEPTADA')
  WHERE n.deleted_at IS NULL
    AND n.estado = 'ABIERTA'
`;

const CONSULTAS: Record<string, ConsultaCalculo> = {
  /**
   * Necesidades publicadas ese dia, agrupadas por su estado actual.
   *
   * El desglose es por estado *actual* y no por estado al publicarse: no hay tabla
   * de historial de estados, asi que cualquier otra cosa seria inventarla.
   */
  necesidades_publicadas: (knex, fecha) => {
    const q = (): Knex.QueryBuilder =>
      knex('pa_request.necesidad')
        .whereNull('deleted_at')
        .whereRaw('DATE(fecha_publicacion) = ?', [fecha]);
    return {
      desglose: () =>
        comoFilas(() =>
          q().count({ valor: '*' }).groupBy('estado').select({ dimension: 'estado' })
        ),
      total: () => comoFilas(() => q().count({ valor: '*' })),
    };
  },

  /** Propuestas enviadas ese dia, agrupadas por su estado actual. */
  propuestas_enviadas: (knex, fecha) => {
    const q = (): Knex.QueryBuilder =>
      knex('pa_request.propuesta')
        .whereNull('deleted_at')
        .whereRaw('DATE(fecha_envio) = ?', [fecha]);
    return {
      desglose: () =>
        comoFilas(() =>
          q().count({ valor: '*' }).groupBy('estado').select({ dimension: 'estado' })
        ),
      total: () => comoFilas(() => q().count({ valor: '*' })),
    };
  },

  /**
   * Fotografia del catalogo: prestadores replicados por estado.
   *
   * Sin filtro de borrado logico porque `prestador_ref` es una replica que se
   * reconstruye con reemision de eventos: si el prestador desaparece, la fila se
   * queda vacia en vez de marcarse. El historico de altas no existe.
   */
  prestadores_por_estado: (knex) => ({
    desglose: () =>
      comoFilas(() =>
        knex('pa_catalog.prestador_ref')
          .count({ valor: '*' })
          .groupBy('estado')
          .select({ dimension: 'estado' })
      ),
    total: () => comoFilas(() => knex('pa_catalog.prestador_ref').count({ valor: '*' })),
  }),

  /** Fotografia del catalogo: servicios vivos por estado. Este si tiene soft delete. */
  servicios_por_estado: (knex) => ({
    desglose: () =>
      comoFilas(() =>
        knex('pa_catalog.servicio')
          .whereNull('deleted_at')
          .count({ valor: '*' })
          .groupBy('estado')
          .select({ dimension: 'estado' })
      ),
    total: () =>
      comoFilas(() => knex('pa_catalog.servicio').whereNull('deleted_at').count({ valor: '*' })),
  }),

  /**
   * Valoracion media diaria de lo ya publico.
   *
   * `visible_at IS NOT NULL` es el periodo ciego (RF166) y `oculta_por_moderacion`
   * la retirada (RF85): promediar sobre lo que el usuario todavia no puede ver
   * daria una media que cambia cada dia sin que haya cambiado ningun dato.
   *
   * El filtro de moderacion compara con `false` y no usa `whereNull` a proposito:
   * la columna es `boolean NOT NULL DEFAULT 0`, asi que `whereNull` no devuelve lo
   * no moderado sino que no devuelve nada, y el promedio sale `NULL` sin avisar.
   *
   * Sin calificaciones visibles la media es 0. Podria ser null para distinguirlas,
   * pero un cero se grafica como un cero real y engaña mas de lo que informa.
   */
  valoracion_media: (knex, fecha) => ({
    total: () =>
      comoFilas(() =>
        knex('pa_rating.calificacion')
          .whereNull('deleted_at')
          .where('oculta_por_moderacion', false)
          .whereNotNull('visible_at')
          .whereRaw('DATE(fecha) = ?', [fecha])
          .avg({ valor: 'puntuacion' })
      ),
  }),

  /**
   * Porcentaje de necesidades abiertas con al menos una propuesta viva.
   *
   * Se cuentan las necesidades ABIERTAS y no las publicadas hoy: la cobertura de
   * un dia vale casi cero siempre, porque una necesidad abierta ayer ya no lo esta,
   * y la serie saldria plana. El filtro de la propuesta va en el `ON` y no en el
   * `WHERE` a proposito: puesto en el `WHERE` el `LEFT JOIN` se vuelve `INNER` en la
   * practica y el denominador pierde las necesidades sin propuesta, que son justo
   * las que hacen que la cobertura baje de 100.
   */
  tasa_cobertura: (knex) => ({
    total: () => comoFilasDeCrudo(() => knex.raw(COBERTURA_SQL)),
  }),
};
