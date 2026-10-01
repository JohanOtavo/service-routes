import { AppError, EventName } from '@punto-amigo/shared';
import type { IClock, IEventPublisher } from '@punto-amigo/service-kit';
import {
  clasificarCancelacion,
  resolverImputacion,
  type Actor,
  type ICancelacionRepository,
  type IHistorialRepository,
  type INecesidadRepository,
  type IReplicaRepository,
  type ISolicitudRepository,
  type ParametrosCancelacion,
  type Solicitud,
} from '../../domain';

export interface OpcionesCancelacion {
  parametros: ParametrosCancelacion;
  /** Dias que se anaden a la vigencia al reabrir una necesidad (SRS RF185). */
  diasReapertura: number;
}

/**
 * Cancelacion de una contratacion (SRS 10.2, RF174 a RF186).
 *
 * La politica esta tomada del transporte por aplicacion: alli el problema es el
 * mismo —dos partes que se comprometen y una se echa atras— y la solucion es
 * medir cuanto aviso dio quien cancela, no solo si cancelo.
 *
 * Con una diferencia que lo cambia todo: aqui NO hay cobro, porque los pagos
 * estan fuera del alcance. Un conductor que cancela paga una penalizacion; un
 * oferente que cancela, no. Asi que todo el peso disuasorio recae sobre la
 * reputacion y la visibilidad, y por eso la clasificacion tiene que ser
 * cuidadosa: es el unico instrumento que queda.
 */
export class CancelRequestUseCase {
  constructor(
    private readonly solicitudes: ISolicitudRepository,
    private readonly necesidades: INecesidadRepository,
    private readonly cancelaciones: ICancelacionRepository,
    private readonly historial: IHistorialRepository,
    private readonly replicas: IReplicaRepository,
    private readonly eventos: IEventPublisher,
    private readonly clock: IClock,
    private readonly opciones: OpcionesCancelacion
  ) {}

  async cancelar(entrada: {
    idSolicitud: number;
    idUsuario: number;
    codigoMotivo: string;
    detalle: string | null;
    fechaAcordada: string | null;
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    const solicitud = await this.solicitudes.findById(entrada.idSolicitud);
    if (solicitud === null) throw AppError.notFound('La solicitud no existe.');

    const prestador = await this.replicas.prestadorPorId(solicitud.idPrestador);
    if (prestador === null) throw AppError.notFound('La solicitud no existe.');

    const actor: Actor = solicitud.actorDe(entrada.idUsuario, prestador.idUsuario);
    const idUsuarioAfectado =
      actor === 'SOLICITANTE' ? prestador.idUsuario : solicitud.idUsuario;

    const motivo = await this.cancelaciones.buscarMotivo(entrada.codigoMotivo);
    if (motivo === null) {
      throw AppError.validation('El motivo de cancelacion no es valido.', [
        { field: 'codigoMotivo', message: 'Elija uno de los motivos del catalogo.' },
      ]);
    }

    const estadoOrigen = solicitud.estado;

    /**
     * El cambio de estado va PRIMERO.
     *
     * La tabla de transiciones decide si este actor puede cancelar desde este
     * estado. Si no puede, se sale aqui sin haber escrito nada: clasificar y
     * guardar antes dejaria una cancelacion registrada para una solicitud que
     * no se cancelo.
     */
    solicitud.cambiarEstado('CANCELADA', actor);

    /**
     * Dos relojes distintos, y no es un detalle.
     *
     * La gracia se mide desde que se ACEPTO: permite deshacer un arrepentimiento
     * inmediato sin castigo, igual que cancelar un viaje a los treinta segundos.
     * El resto se mide desde la FECHA ACORDADA, porque lo que de verdad dana a
     * la contraparte no es que cancelen, sino quedarse sin margen para
     * reorganizarse.
     *
     * Una solicitud PENDIENTE todavia no se acepto, asi que no hay reloj de
     * gracia que correr: se toma la fecha de la propia solicitud y la
     * clasificacion cae en la franja mas benigna, que es lo correcto —nadie se
     * comprometio a nada todavia—.
     */
    const aceptadaAt =
      (await this.solicitudes.aceptadaAt(solicitud.id)) ?? this.clock.now();

    const clasificacion = clasificarCancelacion({
      aceptadaAt,
      fechaAcordada: entrada.fechaAcordada === null ? null : new Date(entrada.fechaAcordada),
      ahora: this.clock.now(),
      parametros: this.opciones.parametros,
    });

    const imputacion = resolverImputacion({
      motivo,
      franja: clasificacion.franja,
      idUsuarioCancela: entrada.idUsuario,
      idUsuarioAfectado,
      detalle: entrada.detalle,
    });

    await this.solicitudes.update(solicitud, entrada.codigoMotivo, null);

    const idCancelacion = await this.cancelaciones.guardar({
      idSolicitud: solicitud.id,
      parteCanceladora: actor,
      idUsuarioCancela: entrada.idUsuario,
      idUsuarioAfectado,
      estadoOrigen,
      codigoMotivo: motivo.codigo,
      detalle: entrada.detalle,
      franja: clasificacion.franja,
      horasDeAntelacion: clasificacion.horasDeAntelacion,
      peso: clasificacion.peso,
      computa: imputacion.computa,
      idUsuarioImputado: imputacion.idUsuarioImputado,
      // EN_REVISION significa que todavia no cuenta para nadie. Un motivo que
      // traslada la falta o que exige validacion no puede surtir efecto solo
      // porque quien cancela lo haya elegido: si no, todos elegirian ese.
      estado: imputacion.requiereRevision ? 'EN_REVISION' : 'REGISTRADA',
      canceladaAt: this.clock.now(),
    });

    await this.historial.registrar({
      idSolicitud: solicitud.id,
      estadoAnterior: estadoOrigen,
      estadoNuevo: solicitud.estado,
      cambiadoPor: entrada.idUsuario,
      motivo: motivo.codigo,
      fechaCambio: this.clock.now(),
    });

    await this.reabrirNecesidadSiProcede(solicitud, actor, estadoOrigen, entrada.correlationId);

    /**
     * El evento lleva el PESO y si computa, ya resueltos.
     *
     * rating-service no vuelve a clasificar: la politica vive en un solo sitio.
     * Si la calculara tambien alli, las dos copias divergirian en cuanto alguien
     * ajustara un umbral, y la tasa dejaria de corresponder con lo registrado.
     *
     * Una cancelacion EN_REVISION sale con `computa: false`. Cuando la revision
     * la confirme, se emitira otro evento; adelantarlo marcaria a alguien por
     * una falta que todavia se esta discutiendo.
     */
    await this.eventos.enqueue(
      {
        eventName: EventName.ServiceRequestCancelled,
        aggregateType: 'Solicitud',
        aggregateId: solicitud.id,
        payload: {
          idCancelacion,
          idSolicitud: solicitud.id,
          origen: solicitud.origen,
          estadoAnterior: estadoOrigen,
          estado: solicitud.estado,
          idUsuario: solicitud.idUsuario,
          idPrestador: solicitud.idPrestador,
          idUsuarioPrestador: idUsuarioAfectado,
          parteCanceladora: actor,
          codigoMotivo: motivo.codigo,
          franja: clasificacion.franja,
          peso: imputacion.computa ? clasificacion.peso : 0,
          computa: imputacion.computa && !imputacion.requiereRevision,
          idUsuarioImputado: imputacion.requiereRevision ? null : imputacion.idUsuarioImputado,
          // La faceta en la que se le carga: quien cancela como oferente
          // ensucia su faceta de oferente, no la de solicitante.
          faceta:
            imputacion.idUsuarioImputado === solicitud.idUsuario
              ? 'COMO_SOLICITANTE'
              : 'COMO_OFERENTE',
          canceladaAt: this.clock.now().toISOString(),
        },
      },
      entrada.correlationId
    );

    return {
      idCancelacion,
      estado: solicitud.estado,
      franja: clasificacion.franja,
      // Se le dice a quien cancela que peso tuvo y si entra en revision. Ocultar
      // el efecto haria que la medida no disuadiera a nadie: lo que no se ve no
      // corrige el comportamiento.
      peso: imputacion.computa ? clasificacion.peso : 0,
      computa: imputacion.computa && !imputacion.requiereRevision,
      enRevision: imputacion.requiereRevision,
    };
  }

  /**
   * Retractacion del oferente sobre una adjudicacion (SRS RF184 a RF186).
   *
   * Es el caso mas grave de todos y por eso tiene reparacion propia. Al
   * adjudicar se descartaron TODAS las demas propuestas, asi que el solicitante
   * se quedo sin alternativas; si ahora el oferente se retira, esta peor que
   * antes de publicar. Devolver la necesidad a ABIERTA con la vigencia ampliada
   * es lo unico que repara ese dano, porque no hay dinero con el que compensar.
   *
   * Solo aplica si cancela el OFERENTE desde ACEPTADA: si cancela el
   * solicitante, es el quien decide si vuelve a publicar.
   */
  private async reabrirNecesidadSiProcede(
    solicitud: Solicitud,
    actor: Actor,
    estadoOrigen: string,
    correlationId: string
  ): Promise<void> {
    if (actor !== 'OFERENTE' || estadoOrigen !== 'ACEPTADA') return;
    if (solicitud.idNecesidad === null) return;

    const necesidad = await this.necesidades.findById(solicitud.idNecesidad);
    if (necesidad === null) return;

    necesidad.reabrir(this.clock.now(), this.opciones.diasReapertura);
    await this.necesidades.update(necesidad);

    await this.eventos.enqueue(
      {
        eventName: EventName.NeedReopened,
        aggregateType: 'Necesidad',
        aggregateId: necesidad.id,
        payload: {
          idNecesidad: necesidad.id,
          idUsuario: necesidad.idUsuario,
          motivo: 'RETRACTACION_OFERENTE',
          fechaVigencia: necesidad.fechaVigencia.toISOString(),
        },
      },
      correlationId
    );
  }
}
