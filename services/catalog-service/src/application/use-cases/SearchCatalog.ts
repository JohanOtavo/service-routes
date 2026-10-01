import { AppError } from '@punto-amigo/shared';
import { normalizarCriterios, type CriteriosBusqueda } from '../../domain';
import type { IServicioRepository, ServicioListado } from '../ports';

/**
 * Busqueda publica y ficha de un servicio (SRS RF45 a RF49, RF53).
 *
 * Es la unica parte del servicio que se alcanza sin sesion: el gateway tiene
 * `GET /api/v1/services` y `GET /api/v1/services/:id` en su lista blanca,
 * porque quien llega por primera vez no puede ver que ofrece la plataforma si
 * antes tiene que registrarse.
 *
 * Que sea publica obliga a dos cosas: acotar siempre la pagina —sin tope, una
 * sola peticion se lleva el catalogo entero— y no exponer nada que el visitante
 * no deba ver.
 */
export class SearchCatalogUseCase {
  constructor(private readonly servicios: IServicioRepository) {}

  /**
   * Proyeccion publica de un servicio.
   *
   * Lleva el nombre comercial y la especialidad del prestador porque un
   * resultado sin ellos no le dice nada a quien busca. NO lleva telefono,
   * correo ni `idUsuario`: los datos de contacto se revelan cuando hay acuerdo
   * y de eso es dueno request-service, y el identificador de cuenta no tiene
   * por que viajar jamas a un cliente anonimo.
   *
   * `idPrestador` si viaja: es el identificador del PERFIL publico, el mismo
   * que sirve `GET /api/v1/providers/:id`, no el de la cuenta.
   */
  private aVistaPublica(fila: ServicioListado): Record<string, unknown> {
    const servicio = fila.servicio.toJSON();

    return {
      ...servicio,
      prestador: {
        idPrestador: fila.servicio.idPrestador,
        nombre: fila.nombrePrestador,
        especialidad: fila.especialidadPrestador,
      },
      reputacion: {
        puntuacionMedia: fila.puntuacionMedia,
        totalCalificaciones: fila.totalCalificaciones,
      },
    };
  }

  /**
   * Busqueda con filtros combinables (SRS RF45 a RF49).
   *
   * Los criterios pasan por `normalizarCriterios` aunque el borde ya los haya
   * validado con Zod. No es desconfianza del borde: es que el tope de pagina es
   * una regla del dominio, y dejarla viviendo solo en un esquema HTTP la
   * perderia en cuanto alguien llamara al caso de uso desde otro sitio.
   */
  async buscar(entrada: Partial<CriteriosBusqueda>): Promise<Record<string, unknown>> {
    const criterios = normalizarCriterios(entrada);
    const resultado = await this.servicios.buscar(criterios);

    return {
      elementos: resultado.elementos.map((fila) => this.aVistaPublica(fila)),
      total: resultado.total,
      pagina: resultado.pagina,
      tamano: resultado.tamano,
    };
  }

  /**
   * Ficha publica de un servicio (SRS RF50).
   *
   * El repositorio ya descarta lo que no es visible —servicio inactivo o
   * borrado, prestador que no esta ACTIVE— y aqui eso se traduce a 404 y nunca
   * a 403. Un 403 confirmaria que el identificador corresponde a algo real, y
   * con esa diferencia se recorre el rango entero para saber que servicios se
   * retiraron o que prestadores estan suspendidos.
   */
  async verPublico(idServicio: number): Promise<Record<string, unknown>> {
    const fila = await this.servicios.verPublico(idServicio);
    if (fila === null) {
      throw AppError.notFound('El servicio no existe.');
    }
    return this.aVistaPublica(fila);
  }
}
