import { AppError, EventName } from '@punto-amigo/shared';
import type { IEventPublisher } from '@punto-amigo/service-kit';
import { Servicio, normalizarCriterios } from '../../domain';
import {
  exigirServicio,
  type ICategoriaRepository,
  type IPrestadorRefRepository,
  type IServicioRepository,
  type PrestadorRef,
} from '../ports';

/**
 * Lo que el OFERENTE hace con su propio catalogo (SRS RF33 a RF38, RF52).
 *
 * Ninguna operacion acepta el identificador del prestador desde el cuerpo ni
 * desde la ruta: se resuelve SIEMPRE desde el usuario del token contra
 * `prestador_ref`. El rol OFERENTE dice que esa persona puede tener servicios,
 * no que ESTE servicio sea suyo, y confundir las dos cosas es un IDOR.
 */
export class ManageServiceCatalogUseCase {
  constructor(
    private readonly servicios: IServicioRepository,
    private readonly categorias: ICategoriaRepository,
    private readonly prestadores: IPrestadorRefRepository,
    private readonly eventos: IEventPublisher
  ) {}

  /**
   * Perfil de prestador del usuario del token.
   *
   * Que no exista se traduce a 409 y no a 404 en la publicacion, porque ahi no
   * se esta pidiendo ningun recurso ajeno: se le dice al oferente que le falta
   * un paso. En cambio, al tocar un servicio concreto se traduce a 404, que es
   * lo mismo que recibe quien no es el dueno (ver `exigirPropio`).
   */
  private async exigirPerfil(idUsuario: number): Promise<PrestadorRef> {
    const ref = await this.prestadores.findByUsuario(idUsuario);
    if (ref === null) {
      throw AppError.conflict('Necesita un perfil de prestador validado para publicar servicios.');
    }
    return ref;
  }

  /**
   * Comprueba la propiedad ANTES que cualquier otra validacion.
   *
   * El orden no es cosmetico. Si primero se validara la categoria, quien no es
   * el dueno recibiria un error de categoria en vez de un 404, y esa diferencia
   * ya confirma que el servicio existe: con ella se recorre el rango de
   * identificadores y se mapea el catalogo ajeno.
   *
   * El dominio vuelve a comprobarlo dentro de `editar` y `cambiarEstado`. La
   * duplicacion es deliberada: aqui se decide el ORDEN de los errores, alli se
   * cierra el paso a cualquier camino que no pase por este caso de uso.
   */
  private async exigirPropio(
    idServicio: number,
    idUsuario: number
  ): Promise<{
    servicio: Servicio;
    ref: PrestadorRef;
  }> {
    const servicio = await exigirServicio(this.servicios, idServicio);
    const ref = await this.prestadores.findByUsuario(idUsuario);

    if (ref === null || servicio.idPrestador !== ref.idPrestador) {
      throw AppError.notFound('El servicio no existe.');
    }
    return { servicio, ref };
  }

  /**
   * Una categoria inexistente y una desactivada se distinguen a proposito.
   *
   * El catalogo de categorias es publico, asi que decir cual de las dos cosas
   * pasa no revela nada que no se pueda consultar con un GET, y le ahorra al
   * oferente adivinar por que su publicacion no entra.
   */
  private async exigirCategoriaActiva(idCategoria: number): Promise<void> {
    const categoria = await this.categorias.findById(idCategoria);
    if (categoria === null) {
      throw AppError.validation('La categoria indicada no existe.', [
        { field: 'idCategoria', message: 'Seleccione una categoria del catalogo.' },
      ]);
    }
    if (!categoria.activa) {
      throw AppError.conflict('La categoria seleccionada no esta disponible.');
    }
  }

  /**
   * Publicacion de un servicio (SRS RF33, RF34, RF35).
   *
   * El estado del prestador sale de `prestador_ref`, que es la replica local.
   * El comentario del dominio pide preguntarselo a provider-service de forma
   * sincrona (RNF54); no hay cliente entre servicios en el kit, y la replica es
   * ademas obligatoria porque `servicio.id_prestador` tiene clave foranea
   * contra ella: sin fila no hay INSERT posible. Queda anotado como pendiente.
   */
  async publicar(entrada: {
    idUsuario: number;
    datos: { nombre: string; descripcion: string; idCategoria: number };
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    const ref = await this.exigirPerfil(entrada.idUsuario);
    const categoria = await this.categorias.findById(entrada.datos.idCategoria);

    if (categoria === null) {
      throw AppError.validation('La categoria indicada no existe.', [
        { field: 'idCategoria', message: 'Seleccione una categoria del catalogo.' },
      ]);
    }

    // El dominio decide: estado del prestador y categoria activa son sus
    // invariantes, no condiciones que este caso de uso pueda interpretar.
    const servicio = Servicio.publicar({
      nombre: entrada.datos.nombre,
      descripcion: entrada.datos.descripcion,
      idPrestador: ref.idPrestador,
      idCategoria: entrada.datos.idCategoria,
      estadoPrestador: ref.estado,
      categoriaActiva: categoria.activa,
    });

    const guardado = await this.servicios.save(servicio, entrada.idUsuario);

    await this.eventos.enqueue(
      {
        eventName: EventName.ServicePublished,
        aggregateType: 'Servicio',
        aggregateId: guardado.id,
        payload: {
          idServicio: guardado.id,
          idPrestador: guardado.idPrestador,
          idCategoria: guardado.idCategoria,
          /**
           * El nombre viaja en el evento, y antes no.
           *
           * `servicio_ref.nombre_servicio` existe en pa_request para que una
           * solicitud pueda mostrar de que servicio es sin preguntar a este
           * servicio. Su consumidor siempre ha leido `nombreServicio`, pero
           * este payload no la incluia: con el `?? ''` del consumidor, cada
           * alta dejaba la columna vacia y nadie se enteraba.
           */
          nombreServicio: guardado.nombre,
          estado: guardado.estado,
        },
      },
      entrada.correlationId
    );

    return guardado.toJSON();
  }

  /**
   * Edicion por su dueno (SRS RF36).
   *
   * El evento sale siempre que la operacion llega hasta aqui, aunque los valores
   * coincidan con los anteriores: comparar campo a campo para ahorrar un evento
   * obligaria a recordar el estado previo completo, y quien lo consume es
   * idempotente de todas formas.
   */
  async editar(entrada: {
    idServicio: number;
    idUsuario: number;
    cambios: { nombre?: string; descripcion?: string; idCategoria?: number };
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    const { servicio, ref } = await this.exigirPropio(entrada.idServicio, entrada.idUsuario);

    if (entrada.cambios.idCategoria !== undefined) {
      await this.exigirCategoriaActiva(entrada.cambios.idCategoria);
    }

    servicio.editar(ref.idPrestador, entrada.cambios);
    await this.servicios.update(servicio);

    await this.eventos.enqueue(
      {
        eventName: EventName.ServiceUpdated,
        aggregateType: 'Servicio',
        aggregateId: servicio.id,
        payload: {
          idServicio: servicio.id,
          idPrestador: servicio.idPrestador,
          idCategoria: servicio.idCategoria,
          estado: servicio.estado,
        },
      },
      entrada.correlationId
    );

    return servicio.toJSON();
  }

  /**
   * Retirada del catalogo (SRS RF37).
   *
   * Pasa a INACTIVE, que NO es un borrado: las solicitudes ya creadas contra
   * este servicio siguen existiendo y la clave foranea de `service_rating_summary`
   * tambien. Borrar la fila dejaria huerfano el historial de contrataciones.
   */
  async desactivar(entrada: {
    idServicio: number;
    idUsuario: number;
    correlationId: string;
  }): Promise<void> {
    const { servicio, ref } = await this.exigirPropio(entrada.idServicio, entrada.idUsuario);

    servicio.cambiarEstado(ref.idPrestador, 'INACTIVE');
    await this.servicios.update(servicio);

    await this.eventos.enqueue(
      {
        eventName: EventName.ServiceDeactivated,
        aggregateType: 'Servicio',
        aggregateId: servicio.id,
        payload: {
          idServicio: servicio.id,
          idPrestador: servicio.idPrestador,
          estado: servicio.estado,
        },
      },
      entrada.correlationId
    );
  }

  /**
   * Su propio catalogo, con los desactivados incluidos (SRS RF52).
   *
   * No es la busqueda publica: el oferente tiene que poder ver lo que retiro
   * para saber que existe. La vista es la misma `toJSON()` porque un servicio no
   * guarda nada que su dueno no deba ver.
   */
  async listarPropios(entrada: {
    idUsuario: number;
    pagina?: number | undefined;
    tamano?: number | undefined;
  }): Promise<Record<string, unknown>> {
    const ref = await this.prestadores.findByUsuario(entrada.idUsuario);

    // Sin perfil no hay servicios, y eso no es un error: es el estado normal de
    // un oferente que acaba de registrarse y aun no ha creado su perfil.
    if (ref === null) {
      return { elementos: [], total: 0, pagina: 1, tamano: 0 };
    }

    // Se pasan solo los campos de paginacion. Entregar `entrada` entera
    // colaria `idUsuario` dentro de los criterios de busqueda, donde no pinta
    // nada, y el tipo lo rechaza con `exactOptionalPropertyTypes`.
    const { pagina, tamano } = normalizarCriterios({
      ...(entrada.pagina === undefined ? {} : { pagina: entrada.pagina }),
      ...(entrada.tamano === undefined ? {} : { tamano: entrada.tamano }),
    });
    const resultado = await this.servicios.listarDePrestador(ref.idPrestador, pagina, tamano);

    return {
      elementos: resultado.elementos.map((s) => s.toJSON()),
      total: resultado.total,
      pagina: resultado.pagina,
      tamano: resultado.tamano,
    };
  }
}
