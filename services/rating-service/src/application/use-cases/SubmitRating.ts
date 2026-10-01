import { AppError, EventName } from '@punto-amigo/shared';
import type { IClock, IEventPublisher } from '@punto-amigo/service-kit';
import {
  Calificacion,
  PeriodoCiego,
  direccionContraria,
  facetaEvaluada,
  resolverParte,
  type ICalificacionRepository,
  type ISolicitudRefRepository,
} from '../../domain';
import type { ReputationRecalculator } from '../ReputationRecalculator';

/**
 * Registro de calificaciones (SRS RF78 a RF82, RF164, RF166).
 *
 * El punto delicado es el periodo ciego: una calificacion nace OCULTA y solo se
 * revela cuando existe la de la contraparte o vence el plazo. Sin esa regla
 * nadie califica mal, porque quien va primero sabe que el otro puede responder
 * con un 1, y entonces todo el mundo pone cinco estrellas y la reputacion deja
 * de medir nada.
 */
export class SubmitRatingUseCase {
  constructor(
    private readonly calificaciones: ICalificacionRepository,
    private readonly recalculador: ReputationRecalculator,
    private readonly solicitudes: ISolicitudRefRepository,
    private readonly periodoCiego: PeriodoCiego,
    private readonly eventos: IEventPublisher,
    private readonly clock: IClock
  ) {}

  async registrar(entrada: {
    idSolicitud: number;
    idEmisor: number;
    puntuacion: number;
    comentario: string | null;
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    const solicitud = await this.solicitudes.buscar(entrada.idSolicitud);
    // 404 y no 403: confirmar que la solicitud existe permitiria recorrer
    // identificadores y descubrir contrataciones ajenas.
    if (solicitud === null) throw AppError.notFound('La solicitud no existe.');

    // Resuelve la direccion y, de paso, comprueba que quien llama fue parte.
    const { direccion } = resolverParte(solicitud, entrada.idEmisor);

    const yaCalifico =
      (await this.calificaciones.findPorSolicitudYDireccion(solicitud.idSolicitud, direccion)) !==
      null;

    const ahora = this.clock.now();
    const calificacion = Calificacion.registrar({
      solicitud,
      idEmisor: entrada.idEmisor,
      puntuacion: entrada.puntuacion,
      comentario: entrada.comentario,
      yaCalificoEstaParte: yaCalifico,
      ahora,
    });

    const guardada = await this.calificaciones.save(calificacion, entrada.idEmisor);

    /**
     * La contraria decide si las dos se revelan ya.
     *
     * `resolverAlRegistrar` devuelve las que cambiaron de estado, y se persisten
     * TODAS en esta misma transaccion: revelar una y dejar la otra para despues
     * rompe justo la simetria que el periodo ciego protege.
     */
    const contraria = await this.calificaciones.findPorSolicitudYDireccion(
      solicitud.idSolicitud,
      direccionContraria(direccion)
    );
    const reveladas = this.periodoCiego.resolverAlRegistrar(guardada, contraria, ahora);

    for (const revelada of reveladas) {
      await this.calificaciones.update(revelada);
      await this.recalcularReputacion(revelada, entrada.correlationId);
    }

    await this.eventos.enqueue(
      {
        eventName: EventName.RatingSubmitted,
        aggregateType: 'Calificacion',
        aggregateId: guardada.id,
        payload: {
          idCalificacion: guardada.id,
          idSolicitud: solicitud.idSolicitud,
          idReceptor: guardada.idReceptor,
          idServicio: guardada.idServicio,
          faceta: guardada.facetaEvaluada,
          // La PUNTUACION solo viaja cuando la calificacion ya es publica. Si
          // saliera antes, el consumidor del catalogo moveria el promedio y
          // cualquiera podria deducir la nota oculta mirando como cambia.
          ...(guardada.esPublica ? { puntuacion: guardada.puntuacion } : {}),
          publica: guardada.esPublica,
        },
      },
      entrada.correlationId
    );

    return guardada.toJSON();
  }

  /**
   * Levanta los periodos ciegos vencidos (SRS RF166).
   *
   * Lo ejecuta un proceso programado, no una peticion. Sin el, quien recibio un
   * mal servicio y no califica dejaria la calificacion de la otra parte oculta
   * para siempre.
   */
  async vencerPeriodosCiegos(entrada: { lote: number; correlationId: string }): Promise<number> {
    const ahora = this.clock.now();
    const vencidas = await this.calificaciones.listarVencidas(
      this.periodoCiego.limiteDeVencimiento(ahora),
      entrada.lote
    );

    for (const calificacion of vencidas) {
      calificacion.revelar(ahora);
      await this.calificaciones.update(calificacion);
      await this.recalcularReputacion(calificacion, entrada.correlationId);
    }

    return vencidas.length;
  }

  private async recalcularReputacion(
    calificacion: Calificacion,
    correlationId: string
  ): Promise<void> {
    await this.recalculador.recalcular({
      idUsuario: calificacion.idReceptor,
      faceta: facetaEvaluada(calificacion.direccion),
      idServicio: calificacion.idServicio,
      correlationId,
    });
  }
}
