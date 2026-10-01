import { AppError, EventName } from '@punto-amigo/shared';
import type { IClock, IEventPublisher } from '@punto-amigo/service-kit';
import {
  Solicitud,
  adjudicar,
  normalizarPaginacion,
  type Actor,
  type EstadoSolicitud,
  type IHistorialRepository,
  type INecesidadRepository,
  type IPropuestaRepository,
  type IReplicaRepository,
  type ISolicitudRepository,
} from '../../domain';

/**
 * Las contrataciones (SRS RF60 a RF70, RF149 a RF157).
 *
 * Los dos flujos del negocio terminan en la MISMA solicitud: el del catalogo
 * —el solicitante elige un servicio y pide— y el de la demanda —el solicitante
 * publica una necesidad y adjudica una propuesta—. La columna `origen`
 * distingue de donde vino, y a partir de ahi el ciclo de vida es uno solo. Tener
 * dos entidades distintas habria duplicado el historial, la cancelacion y la
 * calificacion sin que ninguna regla fuera diferente.
 */
export class ManageRequestsUseCase {
  constructor(
    private readonly solicitudes: ISolicitudRepository,
    private readonly necesidades: INecesidadRepository,
    private readonly propuestas: IPropuestaRepository,
    private readonly historial: IHistorialRepository,
    private readonly replicas: IReplicaRepository,
    private readonly eventos: IEventPublisher,
    private readonly clock: IClock
  ) {}

  /**
   * Camino del catalogo: el solicitante pide un servicio (SRS RF60).
   *
   * Nace PENDIENTE y espera que el oferente acepte. El prestador NO viene del
   * cuerpo: se deduce del servicio, para que nadie pueda dirigir una solicitud
   * a un oferente que no ofrece ese servicio.
   */
  async crearDirecta(entrada: {
    idUsuario: number;
    idServicio: number;
    descripcionProblema: string;
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    const servicio = await this.replicas.servicioPorId(entrada.idServicio);
    if (servicio === null) throw AppError.notFound('El servicio no existe.');

    const prestador = await this.replicas.prestadorPorId(servicio.idPrestador);
    if (prestador === null) throw AppError.notFound('El servicio no existe.');

    // Contratarse a si mismo deja una solicitud en la que una sola persona es
    // las dos partes: podria calificarse sola y subirse la reputacion.
    if (prestador.idUsuario === entrada.idUsuario) {
      throw AppError.conflict('No puede contratar su propio servicio.');
    }

    const solicitud = Solicitud.directa({
      descripcionProblema: entrada.descripcionProblema,
      idUsuario: entrada.idUsuario,
      idPrestador: servicio.idPrestador,
      idServicio: servicio.idServicio,
      servicioActivo: servicio.estado === 'ACTIVE' && prestador.estado === 'ACTIVE',
      ahora: this.clock.now(),
    });

    const guardada = await this.solicitudes.save(solicitud, entrada.idUsuario);
    await this.asentar(guardada.id, null, guardada.estado, entrada.idUsuario, null);

    await this.eventos.enqueue(
      {
        eventName: EventName.ServiceRequestCreated,
        aggregateType: 'Solicitud',
        aggregateId: guardada.id,
        payload: {
          idSolicitud: guardada.id,
          origen: guardada.origen,
          idUsuario: guardada.idUsuario,
          idPrestador: guardada.idPrestador,
          idUsuarioPrestador: prestador.idUsuario,
          estado: guardada.estado,
        },
      },
      entrada.correlationId
    );

    return guardada.toJSON(false);
  }

  /**
   * Camino de la demanda: el autor adjudica una propuesta (SRS RF149 a RF153).
   *
   * Es la operacion mas delicada del servicio porque toca cuatro cosas a la vez:
   * la necesidad pasa a ADJUDICADA, la propuesta elegida a ACEPTADA, TODAS las
   * demas a DESCARTADA, y nace la solicitud ya ACEPTADA. El dominio decide el
   * conjunto completo en `adjudicar()` y aqui solo se escribe, de modo que o se
   * confirma todo o no se confirma nada.
   *
   * Si esto se confirmara a medias, lo que quedaria es una necesidad adjudicada
   * con dos propuestas aceptadas, o una solicitud sin necesidad que la respalde.
   */
  async adjudicar(entrada: {
    idNecesidad: number;
    idPropuesta: number;
    idUsuario: number;
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    const necesidad = await this.necesidades.findById(entrada.idNecesidad);
    if (necesidad === null) throw AppError.notFound('La necesidad no existe.');

    const resultado = adjudicar({
      necesidad,
      propuestas: await this.propuestas.findByNecesidad(necesidad.id),
      idPropuestaElegida: entrada.idPropuesta,
      // La comprobacion de autor vive dentro de `necesidad.adjudicar`.
      idUsuarioAutor: entrada.idUsuario,
      ahora: this.clock.now(),
    });

    await this.necesidades.update(resultado.necesidad);
    await this.propuestas.update(resultado.propuestaAceptada);
    for (const descartada of resultado.propuestasDescartadas) {
      await this.propuestas.update(descartada);
    }

    const solicitud = await this.solicitudes.save(resultado.solicitud, entrada.idUsuario);

    /**
     * Nace ACEPTADA, asi que el historial arranca ahi y no en PENDIENTE.
     * Inventar un PENDIENTE que nunca existio haria creer que el oferente
     * acepto algo, cuando lo que hubo fue una adjudicacion.
     */
    await this.asentar(solicitud.id, null, solicitud.estado, entrada.idUsuario, 'ADJUDICACION');

    const prestador = await this.replicas.prestadorPorId(solicitud.idPrestador);

    await this.eventos.enqueue(
      {
        eventName: EventName.ProposalAwarded,
        aggregateType: 'Propuesta',
        aggregateId: resultado.propuestaAceptada.id,
        payload: {
          idPropuesta: resultado.propuestaAceptada.id,
          idNecesidad: necesidad.id,
          idSolicitud: solicitud.id,
          idPrestador: resultado.propuestaAceptada.idPrestador,
          idUsuarioPrestador: prestador?.idUsuario ?? null,
        },
      },
      entrada.correlationId
    );

    // Un evento por cada descartada: el oferente que perdio merece saberlo, y
    // un solo evento con una lista obligaria al consumidor a desmontarla.
    for (const descartada of resultado.propuestasDescartadas) {
      await this.eventos.enqueue(
        {
          eventName: EventName.ProposalDiscarded,
          aggregateType: 'Propuesta',
          aggregateId: descartada.id,
          payload: {
            idPropuesta: descartada.id,
            idNecesidad: necesidad.id,
            idPrestador: descartada.idPrestador,
            estado: descartada.estado,
          },
        },
        entrada.correlationId
      );
    }

    await this.eventos.enqueue(
      {
        eventName: EventName.ServiceRequestCreated,
        aggregateType: 'Solicitud',
        aggregateId: solicitud.id,
        payload: {
          idSolicitud: solicitud.id,
          origen: solicitud.origen,
          idUsuario: solicitud.idUsuario,
          idPrestador: solicitud.idPrestador,
          idUsuarioPrestador: prestador?.idUsuario ?? null,
          estado: solicitud.estado,
        },
      },
      entrada.correlationId
    );

    return solicitud.toJSON(false);
  }

  /**
   * Cambio de estado por una de las partes (SRS RF62 a RF66).
   *
   * Quien pide el cambio se traduce a SOLICITANTE u OFERENTE con `actorDe`, y
   * la tabla de transiciones del dominio decide si ese actor puede hacerlo. Es
   * la diferencia entre "quien eres" y "que papel juegas aqui": la misma
   * persona puede ser solicitante en una contratacion y oferente en otra.
   */
  async cambiarEstado(entrada: {
    idSolicitud: number;
    idUsuario: number;
    destino: Exclude<EstadoSolicitud, 'CANCELADA'>;
    motivo: string | null;
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    const { solicitud, actor, idUsuarioPrestador } = await this.exigirParte(
      entrada.idSolicitud,
      entrada.idUsuario
    );

    const anterior = solicitud.estado;
    solicitud.cambiarEstado(entrada.destino, actor);

    const completadaAt = solicitud.estado === 'COMPLETADA' ? this.clock.now() : null;
    await this.solicitudes.update(solicitud, entrada.motivo, completadaAt);
    await this.asentar(solicitud.id, anterior, solicitud.estado, entrada.idUsuario, entrada.motivo);

    await this.publicarCambio(solicitud, anterior, idUsuarioPrestador, entrada.correlationId);

    return solicitud.toJSON(false);
  }

  /**
   * Detalle de una contratacion, con contacto si YA hay acuerdo.
   *
   * Esta es la frontera que sostiene toda la intermediacion (SRS RF156, RNF84):
   * el telefono y el correo no se publican en el catalogo ni en el perfil, solo
   * aparecen aqui y solo cuando la solicitud paso de PENDIENTE. Antes del
   * acuerdo no hay nada que coordinar, y revelarlo convertiria la plataforma en
   * un directorio del que las partes se van sin dejar rastro.
   */
  async ver(entrada: { idSolicitud: number; idUsuario: number }): Promise<Record<string, unknown>> {
    const { solicitud, idUsuarioPrestador } = await this.exigirParte(
      entrada.idSolicitud,
      entrada.idUsuario
    );

    const hayAcuerdo = solicitud.estado === 'ACEPTADA' || solicitud.estado === 'COMPLETADA';
    if (!hayAcuerdo) return solicitud.toJSON(false);

    /**
     * Se devuelve el contacto de la CONTRAPARTE, no los dos.
     *
     * Cada parte ya conoce el suyo, asi que incluirlo solo multiplicaria por dos
     * los datos personales que viajan en cada respuesta. Quien pregunta recibe
     * exactamente lo que necesita para coordinar el trabajo y nada mas.
     */
    const idContraparte =
      entrada.idUsuario === solicitud.idUsuario ? idUsuarioPrestador : solicitud.idUsuario;

    const contraparte = await this.replicas.usuarioPorId(idContraparte);

    return solicitud.toJSON(true, {
      idUsuario: idContraparte,
      nombre: contraparte?.nombre ?? null,
      telefono: contraparte?.telefono ?? null,
      correo: contraparte?.correo ?? null,
    });
  }

  async mias(entrada: {
    idUsuario: number;
    como: 'SOLICITANTE' | 'OFERENTE';
    pagina?: number | undefined;
    tamano?: number | undefined;
  }): Promise<Record<string, unknown>> {
    const { pagina, tamano } = normalizarPaginacion(entrada);

    if (entrada.como === 'SOLICITANTE') {
      const r = await this.solicitudes.listarDeUsuario(entrada.idUsuario, pagina, tamano);
      return this.aPagina(r);
    }

    const prestador = await this.replicas.prestadorPorUsuario(entrada.idUsuario);
    if (prestador === null) return { elementos: [], total: 0, pagina, tamano };

    const r = await this.solicitudes.listarDePrestador(prestador.idPrestador, pagina, tamano);
    return this.aPagina(r);
  }

  private aPagina(r: {
    elementos: readonly Solicitud[];
    total: number;
    pagina: number;
    tamano: number;
  }): Record<string, unknown> {
    return {
      // El listado nunca revela contacto, ni siquiera de las ya aceptadas: para
      // eso esta el detalle, y asi una sola peticion no vuelca todos los
      // contactos de una vez.
      elementos: r.elementos.map((s) => s.toJSON(false)),
      total: r.total,
      pagina: r.pagina,
      tamano: r.tamano,
    };
  }

  /** Carga la solicitud y traduce a quien llama en su papel, o 404. */
  private async exigirParte(
    idSolicitud: number,
    idUsuario: number
  ): Promise<{ solicitud: Solicitud; actor: Actor; idUsuarioPrestador: number }> {
    const solicitud = await this.solicitudes.findById(idSolicitud);
    if (solicitud === null) throw AppError.notFound('La solicitud no existe.');

    const prestador = await this.replicas.prestadorPorId(solicitud.idPrestador);
    // Sin la replica no se puede decidir quien es el oferente. Tratarlo como
    // "no eres parte" es lo correcto: denegar por defecto, no por omision.
    if (prestador === null) throw AppError.notFound('La solicitud no existe.');

    return {
      solicitud,
      actor: solicitud.actorDe(idUsuario, prestador.idUsuario),
      idUsuarioPrestador: prestador.idUsuario,
    };
  }

  private async asentar(
    idSolicitud: number,
    anterior: EstadoSolicitud | null,
    nuevo: EstadoSolicitud,
    cambiadoPor: number,
    motivo: string | null
  ): Promise<void> {
    await this.historial.registrar({
      idSolicitud,
      estadoAnterior: anterior,
      estadoNuevo: nuevo,
      cambiadoPor,
      motivo,
      fechaCambio: this.clock.now(),
    });
  }

  /**
   * Un evento especifico por estado, ademas del generico.
   *
   * El generico `ServiceRequestStatusChanged` sirve a quien solo lleva la
   * cuenta; los especificos permiten que rating-service se suscriba SOLO a
   * `completed` y `cancelled` sin recibir y descartar todos los demas.
   */
  private async publicarCambio(
    solicitud: Solicitud,
    anterior: EstadoSolicitud,
    idUsuarioPrestador: number,
    correlationId: string
  ): Promise<void> {
    const especificos: Partial<Record<EstadoSolicitud, string>> = {
      ACEPTADA: EventName.ServiceRequestAccepted,
      RECHAZADA: EventName.ServiceRequestRejected,
      COMPLETADA: EventName.ServiceRequestCompleted,
      CANCELADA: EventName.ServiceRequestCancelled,
    };

    const payload = {
      idSolicitud: solicitud.id,
      origen: solicitud.origen,
      estadoAnterior: anterior,
      estado: solicitud.estado,
      idUsuario: solicitud.idUsuario,
      idPrestador: solicitud.idPrestador,
      idUsuarioPrestador,
      idServicio: solicitud.toJSON(false)['idServicio'],
    };

    const especifico = especificos[solicitud.estado];
    if (especifico !== undefined) {
      await this.eventos.enqueue(
        {
          eventName: especifico,
          aggregateType: 'Solicitud',
          aggregateId: solicitud.id,
          payload,
        },
        correlationId
      );
    }

    await this.eventos.enqueue(
      {
        eventName: EventName.ServiceRequestStatusChanged,
        aggregateType: 'Solicitud',
        aggregateId: solicitud.id,
        payload,
      },
      correlationId
    );
  }
}
