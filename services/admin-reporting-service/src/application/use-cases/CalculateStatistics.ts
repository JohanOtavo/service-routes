import { AppError } from '@punto-amigo/shared';
import type { IClock } from '@punto-amigo/service-kit';
import type {
  ConteoAgrupado,
  IStatisticsRepository,
  IStatisticsSourceRepository,
  PuntoCalculado,
} from '../../domain';

/**
 * Metricas que este servicio sabe calcular, y por que solo estas dos.
 *
 * `statistics_snapshot` existia, los informes de serie la leian, y **nadie la
 * escribia**: devolvian vacio siempre (A-3). Esto la puebla.
 *
 * Solo hay dos metricas porque `pa_admin` solo tiene dos tablas con volumen
 * propio: `audit_record` y `content_moderation`. Este servicio no puede
 * consultar el esquema de otro —es la propiedad de datos del SRS (RF108)— y
 * aqui no llega ninguna replica. Los informes por rol, categoria, estado de
 * solicitud y calificacion (RF109 a RF112) siguen sin datos, exactamente como
 * ya dice `domain/index.ts`: lo que falte tiene que llegar por un evento.
 */
export const METRICA_AUDITORIA = 'auditoria_eventos';
export const METRICA_MODERACION = 'moderaciones';

/**
 * Centinela de "sin desglose", no NULL.
 *
 * La columna es NOT NULL con este mismo valor por defecto y entra en la clave
 * unica `(fecha, metrica, dimension)`. Con NULL, MySQL considera distintas dos
 * filas que solo difieren en ese NULL y la clave dejaria de impedir duplicados.
 */
const DIMENSION_TOTAL = 'TOTAL';

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/**
 * Ventana de dias COMPLETOS que termina hoy.
 *
 * El tope es el fin del dia de hoy y no `now()`: con `now()`, lo que ocurriera
 * en el resto del dia quedaria fuera de este recalculo, y el de mañana ya no lo
 * recogeria si la ventana se hubiera desplazado mas alla de ese dia.
 */
function ventana(ahora: Date, dias: number): { desde: Date; hasta: Date } {
  const finDeHoy = new Date(
    Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate(), 23, 59, 59, 999)
  );
  const inicioDeHoy = Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate());

  return { desde: new Date(inicioDeHoy - (dias - 1) * MS_POR_DIA), hasta: finDeHoy };
}

/**
 * Cada dimension del dia, y un punto `TOTAL` con su suma.
 *
 * El total se calcula aqui en lugar de pedir un segundo agregado a la base: es
 * la suma de lo que ya se ha traido, y una consulta mas podria leer un estado
 * distinto si entre ambas se escribe una fila.
 */
function conTotales(metrica: string, conteos: readonly ConteoAgrupado[]): PuntoCalculado[] {
  const porDia = new Map<string, ConteoAgrupado[]>();
  for (const conteo of conteos) {
    const delDia = porDia.get(conteo.fecha);
    if (delDia === undefined) porDia.set(conteo.fecha, [conteo]);
    else delDia.push(conteo);
  }

  const puntos: PuntoCalculado[] = [];
  for (const [fecha, delDia] of porDia) {
    for (const conteo of delDia) {
      puntos.push({ fecha, metrica, dimension: conteo.dimension, valor: conteo.valor });
    }
    puntos.push({
      fecha,
      metrica,
      dimension: DIMENSION_TOTAL,
      valor: delDia.reduce((suma, c) => suma + c.valor, 0),
    });
  }

  return puntos;
}

/** Recalculo de las series de `statistics_snapshot` (SRS RF113, modulo 13). */
export class CalculateStatisticsUseCase {
  constructor(
    private readonly estadisticas: IStatisticsRepository,
    private readonly fuente: IStatisticsSourceRepository,
    private readonly clock: IClock
  ) {}

  /**
   * Recalcula los ultimos `dias` dias y devuelve cuantos puntos escribio.
   *
   * Recalcular y no acumular: la clave unica `(fecha, metrica, dimension)`
   * hace que volver a pasar por un dia SUSTITUYA su punto. Por eso la ventana
   * puede solaparse entre ejecuciones sin inflar las cifras, y por eso un
   * asiento de auditoria que llegue tarde —con `ocurrido_at` de ayer— acaba
   * contado.
   */
  async recalcular(entrada: { dias: number }): Promise<number> {
    if (!Number.isInteger(entrada.dias) || entrada.dias < 1) {
      throw AppError.validation('El numero de dias a recalcular debe ser un entero de 1 o mas.');
    }

    const { desde, hasta } = ventana(this.clock.now(), entrada.dias);

    const [auditoria, moderacion] = await Promise.all([
      this.fuente.conteoAuditoriaPorDiaYResultado(desde, hasta),
      this.fuente.conteoModeracionPorDiaYTipo(desde, hasta),
    ]);

    const puntos = [
      ...conTotales(METRICA_AUDITORIA, auditoria),
      ...conTotales(METRICA_MODERACION, moderacion),
    ];

    // Un dia sin actividad no escribe una fila de valor 0: la serie distingue
    // "no paso nada" de "no se ha calculado", y una fila a 0 borra esa diferencia.
    if (puntos.length === 0) return 0;

    return this.estadisticas.registrar(puntos);
  }
}
