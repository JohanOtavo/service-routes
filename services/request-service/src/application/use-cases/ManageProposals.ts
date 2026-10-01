import { AppError, EventName } from '@punto-amigo/shared';
import type { IClock, IEventPublisher } from '@punto-amigo/service-kit';
import {
  Propuesta,
  normalizarPaginacion,
  type INecesidadRepository,
  type IPropuestaRepository,
  type IReplicaRepository,
} from '../../domain';

/**
 * El otro lado de la demanda: el oferente responde a una necesidad
 * (SRS RF137 a RF146).
 */
export class ManageProposalsUseCase {
  constructor(
    private readonly propuestas: IPropuestaRepository,
    private readonly necesidades: INecesidadRepository,
    private readonly replicas: IReplicaRepository,
    private readonly eventos: IEventPublisher,
    private readonly clock: IClock
  ) {}

  /**
   * Envia una propuesta (SRS RF137, RF138).
   *
   * El prestador se resuelve desde el USUARIO del token, no desde un campo del
   * cuerpo: aceptar `idPrestador` del cliente permitiria proponer en nombre de
   * otro oferente.
   */
  async enviar(entrada: {
    idNecesidad: number;
    idUsuario: number;
    datos: { precio: string; tiempoEstimado: number; mensaje: string; idServicio?: number | null };
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    const prestador = await this.replicas.prestadorPorUsuario(entrada.idUsuario);
    if (prestador === null) {
      throw AppError.conflict('Necesita un perfil de prestador para enviar propuestas.');
    }

    const necesidad = await this.necesidades.findById(entrada.idNecesidad);
    if (necesidad === null) throw AppError.notFound('La necesidad no existe.');

    /**
     * Si adjunta un servicio, tiene que ser SUYO.
     *
     * Sin esta comprobacion, un oferente podria adjuntar el servicio mejor
     * valorado de otro y apropiarse de su reputacion en la propuesta.
     */
    const idServicio = entrada.datos.idServicio ?? null;
    if (idServicio !== null) {
      const servicio = await this.replicas.servicioPorId(idServicio);
      if (servicio === null || servicio.idPrestador !== prestador.idPrestador) {
        throw AppError.notFound('El servicio adjuntado no existe.');
      }
    }

    const propuesta = Propuesta.enviar({
      necesidad,
      idPrestador: prestador.idPrestador,
      idUsuarioPrestador: prestador.idUsuario,
      estadoPrestador: prestador.estado,
      precio: entrada.datos.precio,
      tiempoEstimado: entrada.datos.tiempoEstimado,
      mensaje: entrada.datos.mensaje,
      idServicio,
      yaTienePropuestaVigente: await this.propuestas.tieneVigente(
        necesidad.id,
        prestador.idPrestador
      ),
      ahora: this.clock.now(),
    });

    const guardada = await this.propuestas.save(propuesta, entrada.idUsuario);

    await this.eventos.enqueue(
      {
        eventName: EventName.ProposalSubmitted,
        aggregateType: 'Propuesta',
        aggregateId: guardada.id,
        payload: {
          idPropuesta: guardada.id,
          idNecesidad: necesidad.id,
          idPrestador: prestador.idPrestador,
          // El destinatario del aviso es el autor de la necesidad.
          idUsuarioDestinatario: necesidad.idUsuario,
        },
      },
      entrada.correlationId
    );

    return guardada.toAuthorJSON();
  }

  async modificar(entrada: {
    idPropuesta: number;
    idUsuario: number;
    cambios: { precio?: string; tiempoEstimado?: number; mensaje?: string };
  }): Promise<Record<string, unknown>> {
    const { propuesta, prestador } = await this.exigirPropia(entrada.idPropuesta, entrada.idUsuario);

    propuesta.modificar(prestador.idPrestador, entrada.cambios);
    await this.propuestas.update(propuesta);

    return propuesta.toAuthorJSON();
  }

  /** Retirada por su autor (SRS RF144). No borra: deja constancia de que existio. */
  async retirar(entrada: {
    idPropuesta: number;
    idUsuario: number;
    correlationId: string;
  }): Promise<void> {
    const { propuesta, prestador } = await this.exigirPropia(entrada.idPropuesta, entrada.idUsuario);

    propuesta.retirar(prestador.idPrestador);
    await this.propuestas.update(propuesta);

    await this.eventos.enqueue(
      {
        eventName: EventName.ProposalDiscarded,
        aggregateType: 'Propuesta',
        aggregateId: propuesta.id,
        payload: {
          idPropuesta: propuesta.id,
          idNecesidad: propuesta.idNecesidad,
          estado: propuesta.estado,
        },
      },
      entrada.correlationId
    );
  }

  /**
   * Propuestas de una necesidad, SOLO para su autor (SRS RF146, RF148).
   *
   * Ningun otro oferente ve esta lista. Si la viera, sabria contra que precios
   * compite y la puja dejaria de ser ciega: bastaria rebajar un peso la mas
   * barata para ganar siempre.
   */
  async listarDeNecesidad(entrada: {
    idNecesidad: number;
    idUsuario: number;
  }): Promise<Record<string, unknown>[]> {
    const necesidad = await this.necesidades.findById(entrada.idNecesidad);
    if (necesidad === null || necesidad.idUsuario !== entrada.idUsuario) {
      // 404 tambien cuando existe pero es de otro: un 403 confirmaria que esa
      // necesidad existe y cuantas propuestas tiene.
      throw AppError.notFound('La necesidad no existe.');
    }

    const lista = await this.propuestas.findByNecesidad(necesidad.id);
    return lista.map((p) => p.toAuthorJSON());
  }

  async misPropuestas(entrada: {
    idUsuario: number;
    pagina?: number | undefined;
    tamano?: number | undefined;
  }): Promise<Record<string, unknown>> {
    const prestador = await this.replicas.prestadorPorUsuario(entrada.idUsuario);
    if (prestador === null) {
      return { elementos: [], total: 0, pagina: 1, tamano: 0 };
    }

    const { pagina, tamano } = normalizarPaginacion(entrada);
    const resultado = await this.propuestas.listarDePrestador(
      prestador.idPrestador,
      pagina,
      tamano
    );

    return {
      elementos: resultado.elementos.map((p) => p.toAuthorJSON()),
      total: resultado.total,
      pagina: resultado.pagina,
      tamano: resultado.tamano,
    };
  }

  /**
   * Carga la propuesta comprobando que es de quien llama.
   *
   * Devuelve 404 y no 403 por el mismo motivo de siempre: un 403 confirmaria
   * que la propuesta existe y permitiria recorrer identificadores para contar
   * cuantas hay.
   */
  private async exigirPropia(
    idPropuesta: number,
    idUsuario: number
  ): Promise<{ propuesta: Propuesta; prestador: { idPrestador: number } }> {
    const prestador = await this.replicas.prestadorPorUsuario(idUsuario);
    if (prestador === null) throw AppError.notFound('La propuesta no existe.');

    const propuesta = await this.propuestas.findById(idPropuesta);
    if (propuesta === null || propuesta.idPrestador !== prestador.idPrestador) {
      throw AppError.notFound('La propuesta no existe.');
    }

    return { propuesta, prestador };
  }
}
