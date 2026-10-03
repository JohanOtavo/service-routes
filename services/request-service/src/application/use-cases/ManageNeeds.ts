import { AppError, EventName, esVacio } from '@punto-amigo/shared';
import type { IClock, IEventPublisher } from '@punto-amigo/service-kit';
import {
  Necesidad,
  normalizarPaginacion,
  type FiltrosNecesidad,
  type INecesidadRepository,
  type IReplicaRepository,
} from '../../domain';

export interface LimitesNecesidad {
  maximoAbiertas: number;
  diasVigencia: number;
}

/**
 * El lado de la DEMANDA: el solicitante publica lo que necesita (SRS RF120 a RF128).
 *
 * Es la mitad que faltaba del negocio. Antes solo el oferente podia publicar, y
 * eso dejaba fuera a quien tiene el problema y no sabe a quien buscar.
 */
export class ManageNeedsUseCase {
  constructor(
    private readonly necesidades: INecesidadRepository,
    private readonly replicas: IReplicaRepository,
    private readonly eventos: IEventPublisher,
    private readonly clock: IClock,
    private readonly limites: LimitesNecesidad
  ) {}

  async publicar(entrada: {
    idUsuario: number;
    datos: {
      titulo: string;
      descripcion: string;
      idCategoria: number;
      presupuestoEstimado?: string | null;
      fechaDeseada?: string | null;
      ubicacionAproximada?: string | null;
    };
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    const ahora = this.clock.now();

    /**
     * La categoria se comprueba contra la replica local, no llamando al
     * catalogo. Es eventualmente consistente y aqui eso basta: una categoria
     * recien desactivada admitiria una necesidad de mas durante unos segundos,
     * que es mucho menos grave que no poder publicar porque catalog-service
     * este caido.
     */
    const categoriaActiva = await this.replicas.categoriaActiva(entrada.datos.idCategoria);

    const necesidad = Necesidad.publicar({
      titulo: entrada.datos.titulo,
      descripcion: entrada.datos.descripcion,
      idUsuario: entrada.idUsuario,
      idCategoria: entrada.datos.idCategoria,
      categoriaActiva,
      presupuestoEstimado: entrada.datos.presupuestoEstimado ?? null,
      fechaDeseada: esVacio(entrada.datos.fechaDeseada)
        ? null
        : new Date(entrada.datos.fechaDeseada),
      ubicacionAproximada: entrada.datos.ubicacionAproximada ?? null,
      abiertasDelUsuario: await this.necesidades.contarAbiertasDe(entrada.idUsuario, ahora),
      maximoAbiertas: this.limites.maximoAbiertas,
      diasVigencia: this.limites.diasVigencia,
      ahora,
    });

    const guardada = await this.necesidades.save(necesidad, entrada.idUsuario);

    await this.eventos.enqueue(
      {
        eventName: EventName.NeedPublished,
        aggregateType: 'Necesidad',
        aggregateId: guardada.id,
        payload: {
          idNecesidad: guardada.id,
          idUsuario: guardada.idUsuario,
          idCategoria: guardada.idCategoria,
          // El evento NO lleva la descripcion completa ni la ubicacion: lo
          // consume la notificacion a oferentes afines, que solo necesita saber
          // que hay algo nuevo en esa categoria.
          fechaVigencia: guardada.fechaVigencia.toISOString(),
        },
      },
      entrada.correlationId
    );

    return guardada.toOwnerJSON();
  }

  async editar(entrada: {
    idNecesidad: number;
    idUsuario: number;
    cambios: { titulo?: string; descripcion?: string; presupuestoEstimado?: string | null };
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    const necesidad = await this.exigir(entrada.idNecesidad);

    // La comprobacion de autor esta DENTRO de `editar`, en el dominio: el borde
    // sabe que quien llama es un solicitante, no que sea el autor de ESTA.
    necesidad.editar(entrada.idUsuario, this.clock.now(), entrada.cambios);
    await this.necesidades.update(necesidad);

    return necesidad.toOwnerJSON();
  }

  /**
   * Cierre por su autor (SRS RF127).
   *
   * CERRADA y CANCELADA son estados distintos a proposito: la primera dice
   * "ya no lo necesito", la segunda "me arrepenti". Las propuestas enviadas
   * quedan como estaban; descartarlas aqui ocultaria que existieron.
   */
  async cerrar(entrada: {
    idNecesidad: number;
    idUsuario: number;
    estado: 'CERRADA' | 'CANCELADA';
    motivo: string | null;
    correlationId: string;
  }): Promise<void> {
    const necesidad = await this.exigir(entrada.idNecesidad);

    necesidad.cerrar(entrada.idUsuario, entrada.estado);
    await this.necesidades.update(necesidad, entrada.motivo);

    await this.eventos.enqueue(
      {
        eventName: EventName.NeedClosed,
        aggregateType: 'Necesidad',
        aggregateId: necesidad.id,
        payload: {
          idNecesidad: necesidad.id,
          idUsuario: necesidad.idUsuario,
          estado: necesidad.estado,
        },
      },
      entrada.correlationId
    );
  }

  /**
   * Listado para oferentes (SRS RF130, RF136).
   *
   * Devuelve `toPublicJSON`, que NO incluye ni el autor ni datos de contacto.
   * Quien quiera contactar envia una propuesta; esa es toda la gracia de la
   * intermediacion y la medida que desincentiva saltarse la plataforma.
   */
  async listarAbiertas(entrada: {
    filtros: FiltrosNecesidad;
    pagina?: number | undefined;
    tamano?: number | undefined;
  }): Promise<Record<string, unknown>> {
    const { pagina, tamano } = normalizarPaginacion(entrada);
    const resultado = await this.necesidades.listarAbiertas(entrada.filtros, pagina, tamano);

    return {
      elementos: resultado.elementos.map((n) => n.toPublicJSON()),
      total: resultado.total,
      pagina: resultado.pagina,
      tamano: resultado.tamano,
    };
  }

  /** Detalle para un oferente: sin autor y sin contacto. */
  async verPublica(idNecesidad: number): Promise<Record<string, unknown>> {
    const necesidad = await this.exigir(idNecesidad);

    // Una necesidad cerrada, vencida o adjudicada deja de ser publica. 404 y no
    // 403: confirmar que existe permitiria recorrer identificadores.
    if (!necesidad.estaAbierta(this.clock.now())) {
      throw AppError.notFound('La necesidad no existe.');
    }
    return necesidad.toPublicJSON();
  }

  async misNecesidades(entrada: {
    idUsuario: number;
    pagina?: number | undefined;
    tamano?: number | undefined;
  }): Promise<Record<string, unknown>> {
    const { pagina, tamano } = normalizarPaginacion(entrada);
    const resultado = await this.necesidades.listarDeAutor(entrada.idUsuario, pagina, tamano);

    return {
      elementos: resultado.elementos.map((n) => n.toOwnerJSON()),
      total: resultado.total,
      pagina: resultado.pagina,
      tamano: resultado.tamano,
    };
  }

  private async exigir(idNecesidad: number): Promise<Necesidad> {
    const necesidad = await this.necesidades.findById(idNecesidad);
    if (necesidad === null) throw AppError.notFound('La necesidad no existe.');
    return necesidad;
  }
}
