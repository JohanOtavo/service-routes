import { AppError } from '@punto-amigo/shared';
import type { Categoria, CriteriosBusqueda, EstadoPrestador, Servicio } from '../domain';

/**
 * Puertos de la capa de aplicacion.
 *
 * Viven aqui y no en el dominio porque `src/domain/index.ts` ya esta cerrado por
 * su prueba unitaria y solo describe reglas, no colaboradores. Ponerlos en cada
 * caso de uso los duplicaria: tres casos de uso distintos leen `servicio`, y dos
 * definiciones de la misma interfaz divergen en cuanto alguien anade un metodo.
 */

export interface Pagina<T> {
  elementos: readonly T[];
  total: number;
  pagina: number;
  tamano: number;
}

/**
 * Fila de la replica `prestador_ref`.
 *
 * Es un tipo plano y no una entidad del dominio: el catalogo no decide nada
 * sobre el prestador, solo copia lo que pa_provider le cuenta por eventos.
 */
export interface PrestadorRef {
  idPrestador: number;
  idUsuario: number;
  nombre: string;
  especialidad: string | null;
  estado: EstadoPrestador;
}

/** Datos que un evento de pa_provider trae para refrescar la replica. */
export interface RefrescoPrestador {
  idPrestador: number;
  idUsuario: number;
  nombre: string;
  especialidad: string | null;
  estado: EstadoPrestador;
  /**
   * Momento del HECHO, no de la escritura.
   *
   * El consumidor procesa hasta `prefetch` mensajes a la vez, asi que dos
   * eventos del mismo prestador pueden aplicarse en desorden. Guardarlo permite
   * descartar el mas viejo en lugar de dejar que pise al mas nuevo.
   */
  ocurridoAt: Date;
}

export interface IPrestadorRefRepository {
  findById(idPrestador: number): Promise<PrestadorRef | null>;
  /** Resuelve el perfil del usuario del token: es como se decide la propiedad. */
  findByUsuario(idUsuario: number): Promise<PrestadorRef | null>;
  /** Alta o actualizacion completa de la replica. */
  upsert(datos: RefrescoPrestador): Promise<void>;
  /**
   * Solo el estado. `ProviderStatusChanged` no lleva nombre ni especialidad, y
   * un upsert con cadenas vacias dejaria el catalogo mostrando fichas sin nombre.
   */
  actualizarEstado(datos: {
    idPrestador: number;
    estado: EstadoPrestador;
    ocurridoAt: Date;
  }): Promise<boolean>;
}

/** Servicio con los datos que la busqueda publica muestra en cada fila. */
export interface ServicioListado {
  servicio: Servicio;
  nombrePrestador: string;
  especialidadPrestador: string | null;
  puntuacionMedia: number;
  totalCalificaciones: number;
}

export interface IServicioRepository {
  findById(id: number): Promise<Servicio | null>;
  save(servicio: Servicio, creadoPor: number): Promise<Servicio>;
  update(servicio: Servicio): Promise<void>;
  /** Busqueda publica: solo servicios activos de prestadores activos. */
  buscar(criterios: CriteriosBusqueda): Promise<Pagina<ServicioListado>>;
  /** Ficha publica, con el nombre del prestador y la puntuacion ya resueltos. */
  verPublico(id: number): Promise<ServicioListado | null>;
  /** El catalogo propio del oferente, incluidos los desactivados (SRS RF52). */
  listarDePrestador(
    idPrestador: number,
    pagina: number,
    tamano: number
  ): Promise<Pagina<Servicio>>;
}

export interface ICategoriaRepository {
  findById(id: number): Promise<Categoria | null>;
  save(categoria: Categoria, creadoPor: number): Promise<Categoria>;
  update(categoria: Categoria): Promise<void>;
  /** Catalogo de categorias disponibles para clasificar y para filtrar. */
  listarActivas(): Promise<readonly Categoria[]>;
}

/** Agregado desnormalizado de calificaciones por servicio (SRS RF53, RF84). */
export interface IRatingSummaryRepository {
  /** Suma una calificacion nueva al agregado. Devuelve false si no hay servicio. */
  acumular(datos: { idServicio: number; puntuacion: number; actualizadoAt: Date }): Promise<boolean>;
  /** Fija el agregado con el valor que rating-service considera verdadero. */
  fijar(datos: {
    idServicio: number;
    puntuacionMedia: number;
    totalCalificaciones: number;
    actualizadoAt: Date;
  }): Promise<boolean>;
}

/**
 * Carga un servicio o falla con 404.
 *
 * Vive aqui y no repetido en cada caso de uso porque "un servicio que no existe
 * es un 404, no un null que cada quien interprete" es una regla y no un detalle:
 * al primer caso de uso que olvidara comprobarlo, el fallo saldria como un 500.
 */
export async function exigirServicio(
  servicios: IServicioRepository,
  id: number
): Promise<Servicio> {
  const servicio = await servicios.findById(id);
  if (servicio === null) {
    throw AppError.notFound('El servicio no existe.');
  }
  return servicio;
}

/**
 * Estados de prestador que el catalogo sabe interpretar.
 *
 * El dominio declara el TIPO `EstadoPrestador`, que se borra al compilar y no
 * sirve para validar lo que llega por el broker. Esta lista es su contraparte
 * en tiempo de ejecucion y vive aqui, en la frontera, porque es exactamente ahi
 * donde entra un valor que nadie de este servicio escribio.
 */
export const ESTADOS_PRESTADOR_CONOCIDOS = [
  'PENDING_VALIDATION',
  'ACTIVE',
  'SUSPENDED',
  'INACTIVE',
] as const;
