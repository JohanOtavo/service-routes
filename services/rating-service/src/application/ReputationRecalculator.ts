import { EventName } from '@punto-amigo/shared';
import type { IClock, IEventPublisher } from '@punto-amigo/service-kit';
import {
  Reputacion,
  calcularMedia,
  type Faceta,
  type ICalificacionRepository,
  type IReputacionRepository,
} from '../domain';

/**
 * Recalculo de la reputacion de una persona en una faceta.
 *
 * Vive en su propia clase porque lo necesitan dos caminos que no se parecen en
 * nada: registrar o revelar una calificacion, y retirar una por moderacion. Si
 * cada uno lo hiciera por su cuenta, el dia que alguien cambiara como se cuenta
 * la media solo cambiaria uno de los dos, y la moderacion dejaria de restar.
 *
 * Siempre recalcula ENTERO desde las calificaciones visibles. Sumar o restar la
 * nueva sobre la media anterior acumula error al estar redondeada a dos
 * decimales, y ademas una calificacion puede volverse visible mucho despues de
 * registrarse, asi que no hay un orden fiable que incorporar.
 */
export class ReputationRecalculator {
  constructor(
    private readonly calificaciones: ICalificacionRepository,
    private readonly reputaciones: IReputacionRepository,
    private readonly eventos: IEventPublisher,
    private readonly clock: IClock
  ) {}

  async recalcular(entrada: {
    idUsuario: number;
    faceta: Faceta;
    idServicio: number | null;
    correlationId: string;
  }): Promise<void> {
    const agregado = await this.calificaciones.agregadoDeReceptor(
      entrada.idUsuario,
      entrada.faceta
    );

    const reputacion = Reputacion.recalcular({
      idUsuario: entrada.idUsuario,
      faceta: entrada.faceta,
      agregado,
      ahora: this.clock.now(),
    });
    await this.reputaciones.guardar(reputacion);

    const porServicio =
      entrada.idServicio === null
        ? null
        : await this.calificaciones.agregadoDeServicio(entrada.idServicio);

    await this.eventos.enqueue(
      {
        eventName: EventName.ReputationRecalculated,
        aggregateType: 'Reputacion',
        aggregateId: entrada.idUsuario,
        payload: {
          idUsuario: reputacion.idUsuario,
          faceta: reputacion.faceta,
          puntuacionMedia: reputacion.puntuacionMedia,
          totalCalificaciones: reputacion.totalCalificaciones,
          /**
           * El promedio del SERVICIO viaja ya calculado.
           *
           * El catalogo ordena por el, y deducirlo alli de un contador propio
           * lo dejaria desviarse en cuanto se perdiera o repitiera un evento.
           * Asi recibe el valor que este servicio considera verdadero.
           */
          ...(porServicio === null
            ? {}
            : {
                idServicio: entrada.idServicio,
                puntuacionMediaServicio: calcularMedia(porServicio),
                totalCalificacionesServicio: porServicio.total,
              }),
        },
      },
      entrada.correlationId
    );
  }
}
