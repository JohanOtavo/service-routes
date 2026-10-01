import { AppError, EventName } from '@punto-amigo/shared';
import type { IEventPublisher } from '@punto-amigo/service-kit';
import { Categoria } from '../../domain';
import type { ICategoriaRepository } from '../ports';

/**
 * Catalogo de categorias (SRS RF42, RF43, RF44).
 *
 * Alta y edicion son exclusivas del ADMINISTRADOR, y el borde ya lo exigio. Lo
 * que aqui importa es lo otro: que el listado es PUBLICO —el formulario de
 * publicacion y el filtro de busqueda lo necesitan antes de que nadie inicie
 * sesion— y que una categoria nunca se borra.
 */
export class ManageCategoriesUseCase {
  constructor(
    private readonly categorias: ICategoriaRepository,
    private readonly eventos: IEventPublisher
  ) {}

  /**
   * Categorias disponibles (SRS RF44).
   *
   * Solo las activas: una desactivada no debe aparecer en el formulario de
   * publicacion ni en el filtro, aunque los servicios que ya la usan sigan
   * clasificados con ella.
   *
   * No se pagina. El numero de categorias lo fija un administrador a mano y se
   * cuenta por decenas; paginarlo obligaria al formulario a hacer varias
   * llamadas para pintar un desplegable.
   */
  async listar(): Promise<Record<string, unknown>> {
    const categorias = await this.categorias.listarActivas();
    return { elementos: categorias.map((c) => c.toJSON()) };
  }

  /**
   * Alta (SRS RF42).
   *
   * La unicidad del nombre la garantiza el UNIQUE de la base y el repositorio
   * traduce el choque a conflicto. No se consulta antes a proposito: entre la
   * consulta y el INSERT cabe otra peticion, y comprobarlo antes solo daria una
   * falsa sensacion de seguridad mientras duplica la regla en dos sitios.
   */
  async crear(entrada: {
    idAdministrador: number;
    datos: { nombre: string; descripcion?: string | null };
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    const categoria = Categoria.crear(entrada.datos);
    const guardada = await this.categorias.save(categoria, entrada.idAdministrador);

    await this.eventos.enqueue(
      {
        eventName: EventName.CategoryCreated,
        aggregateType: 'Categoria',
        aggregateId: guardada.id,
        payload: {
          idCategoria: guardada.id,
          nombre: guardada.nombre,
          activa: guardada.activa,
          creadaPor: entrada.idAdministrador,
        },
      },
      entrada.correlationId
    );

    return guardada.toJSON();
  }

  /**
   * Edicion: renombrar y/o cambiar la disponibilidad (SRS RF43).
   *
   * Desactivar NO borra. Una categoria con servicios asociados no puede
   * desaparecer sin dejarlos huerfanos, y la clave foranea de `servicio` lo
   * impide con RESTRICT; desactivarla la retira del formulario y deja intacto
   * lo que ya se clasifico con ella.
   */
  async editar(entrada: {
    idCategoria: number;
    idAdministrador: number;
    cambios: { nombre?: string; activa?: boolean };
    correlationId: string;
  }): Promise<Record<string, unknown>> {
    const categoria = await this.categorias.findById(entrada.idCategoria);
    if (categoria === null) {
      throw AppError.notFound('La categoria no existe.');
    }

    if (entrada.cambios.nombre !== undefined) {
      categoria.renombrar(entrada.cambios.nombre);
    }
    if (entrada.cambios.activa === true) {
      categoria.reactivar();
    } else if (entrada.cambios.activa === false) {
      categoria.desactivar();
    }

    await this.categorias.update(categoria);

    await this.eventos.enqueue(
      {
        eventName: EventName.CategoryUpdated,
        aggregateType: 'Categoria',
        aggregateId: categoria.id,
        payload: {
          idCategoria: categoria.id,
          nombre: categoria.nombre,
          activa: categoria.activa,
          editadaPor: entrada.idAdministrador,
        },
      },
      entrada.correlationId
    );

    return categoria.toJSON();
  }
}
