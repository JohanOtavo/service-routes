import type { IRatingSummaryRepository } from '../ports';

/**
 * Mantiene `service_rating_summary` al dia (SRS RF53, RF84).
 *
 * El agregado esta desnormalizado a proposito: la puntuacion media se muestra
 * en cada fila de cada pagina de resultados, y calcularla con un AVG sobre
 * pa_rating exigiria una llamada entre servicios por resultado. Su fuente de
 * verdad sigue siendo rating-service; esto es solo una copia para leer rapido.
 *
 * AVISO sobre el contrato: rating-service todavia no esta implementado, asi que
 * el payload de `RatingSubmitted` y `ReputationRecalculated` NO esta definido.
 * Aqui no se inventa: se leen los campos que SI existen en el modelo de datos
 * de pa_rating (`id_servicio`, `puntuacion`) y, cuando el evento no trae lo que
 * hace falta, se descarta sin tocar nada en lugar de adivinar. Un descarte deja
 * el agregado desactualizado, que se arregla con el siguiente recalculo; una
 * adivinanza deja un numero falso en la vista publica para siempre.
 */
export class SyncRatingSummaryUseCase {
  constructor(private readonly resumenes: IRatingSummaryRepository) {}

  /**
   * Una calificacion nueva (SRS RF84).
   *
   * Suma incremental y no recalculo: el catalogo no tiene las calificaciones,
   * solo el agregado. Es seguro frente a reentregas porque el consumidor
   * descarta el evento repetido por `event_id` ANTES de llamar aqui; sin esa
   * marca, una suma incremental contaria dos veces.
   *
   * Una calificacion sin `idServicio` se ignora: las calificaciones de
   * solicitante a oferente no cuelgan de ningun servicio —`id_servicio` es
   * nullable en pa_rating— y no hay agregado que actualizar.
   *
   * Que no exista fila de `servicio` tampoco es un error: el servicio pudo
   * retirarse y borrarse logicamente entre la calificacion y su entrega. La
   * clave foranea lo impediria con un error de motor que no explica nada, asi
   * que el repositorio lo comprueba y devuelve false.
   */
  async alCalificar(entrada: {
    idServicio: number | null;
    puntuacion: number | null;
    ocurridoAt: Date;
  }): Promise<void> {
    if (entrada.idServicio === null || entrada.puntuacion === null) return;

    await this.resumenes.acumular({
      idServicio: entrada.idServicio,
      puntuacion: entrada.puntuacion,
      actualizadoAt: entrada.ocurridoAt,
    });
  }

  /**
   * Recalculo autoritativo de la reputacion.
   *
   * Fija el agregado en lugar de sumar: este evento existe precisamente para
   * corregir desviaciones, y sumar sobre lo que ya hay las conservaria.
   *
   * CONTRADICCION ANOTADA: `ReputationRecalculated` describe la reputacion de
   * una PERSONA por faceta (SRS RF165), mientras que `service_rating_summary`
   * va por SERVICIO. Mientras rating-service no publique el evento no se sabe
   * si su payload llevara `idServicio`. Por eso el manejador aplica solo cuando
   * el evento trae los tres campos que necesita, y en cualquier otro caso no
   * toca nada: aplicar la media de una persona a uno de sus servicios pondria
   * en la ficha publica un numero que no corresponde a ese servicio.
   */
  async alRecalcular(entrada: {
    idServicio: number | null;
    puntuacionMedia: number | null;
    totalCalificaciones: number | null;
    ocurridoAt: Date;
  }): Promise<void> {
    if (
      entrada.idServicio === null ||
      entrada.puntuacionMedia === null ||
      entrada.totalCalificaciones === null
    ) {
      return;
    }

    await this.resumenes.fijar({
      idServicio: entrada.idServicio,
      puntuacionMedia: entrada.puntuacionMedia,
      totalCalificaciones: entrada.totalCalificaciones,
      actualizadoAt: entrada.ocurridoAt,
    });
  }
}
