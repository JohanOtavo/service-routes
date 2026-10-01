import { AppError } from '@punto-amigo/shared';

/**
 * Dominio del catalogo: servicios publicados y sus categorias.
 *
 * SRS: RF33 a RF53.
 *
 * Todo el dominio cabe en un archivo porque es pequeno y cohesionado: dos
 * entidades, dos estados y un punado de invariantes. Partirlo en siete archivos
 * anadiria navegacion sin anadir claridad.
 */

export const ESTADOS_SERVICIO = ['ACTIVE', 'INACTIVE'] as const;
export type EstadoServicio = (typeof ESTADOS_SERVICIO)[number];

/** Estado del prestador, replicado desde pa_provider. */
export type EstadoPrestador = 'PENDING_VALIDATION' | 'ACTIVE' | 'SUSPENDED' | 'INACTIVE';

export interface CategoriaProps {
  id: number;
  nombre: string;
  descripcion: string | null;
  activa: boolean;
}

export class Categoria {
  private constructor(private props: CategoriaProps) {}

  static rehydrate(props: CategoriaProps): Categoria {
    return new Categoria(props);
  }

  static crear(input: { nombre: string; descripcion?: string | null }): Categoria {
    const nombre = input.nombre.trim();
    if (nombre.length < 3 || nombre.length > 100) {
      throw AppError.validation('El nombre de la categoria no es valido.', [
        { field: 'nombreCategoria', message: 'Debe tener entre 3 y 100 caracteres.' },
      ]);
    }
    return new Categoria({
      id: 0,
      nombre,
      descripcion: input.descripcion?.trim() ?? null,
      activa: true,
    });
  }

  get id(): number {
    return this.props.id;
  }
  get nombre(): string {
    return this.props.nombre;
  }
  get activa(): boolean {
    return this.props.activa;
  }

  renombrar(nombre: string): void {
    const limpio = nombre.trim();
    if (limpio.length < 3 || limpio.length > 100) {
      throw AppError.validation('El nombre de la categoria no es valido.');
    }
    this.props.nombre = limpio;
  }

  /**
   * Desactivar NO es borrar.
   *
   * Una categoria con servicios asociados no puede desaparecer sin dejarlos
   * huerfanos (SRS RF43). Desactivarla la retira del formulario de publicacion
   * y deja intacto lo que ya se clasifico con ella.
   */
  desactivar(): void {
    this.props.activa = false;
  }

  reactivar(): void {
    this.props.activa = true;
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.props.id,
      nombre: this.props.nombre,
      descripcion: this.props.descripcion,
      activa: this.props.activa,
    };
  }
}

export interface ServicioProps {
  id: number;
  nombre: string;
  descripcion: string;
  idPrestador: number;
  idCategoria: number;
  estado: EstadoServicio;
  deletedAt: Date | null;
}

export class Servicio {
  private constructor(private props: ServicioProps) {}

  static rehydrate(props: ServicioProps): Servicio {
    return new Servicio(props);
  }

  /**
   * Publica un servicio.
   *
   * El estado del prestador llega ya resuelto: lo consulta el caso de uso contra
   * provider-service, porque es una decision de ESCRITURA y no puede apoyarse en
   * la replica local, que es eventualmente consistente (SRS RF34, RNF54).
   */
  static publicar(input: {
    nombre: string;
    descripcion: string;
    idPrestador: number;
    idCategoria: number;
    estadoPrestador: EstadoPrestador;
    categoriaActiva: boolean;
  }): Servicio {
    if (input.estadoPrestador !== 'ACTIVE') {
      throw AppError.conflict(
        'Su perfil de prestador debe estar validado antes de publicar servicios.'
      );
    }
    if (!input.categoriaActiva) {
      throw AppError.conflict('La categoria seleccionada no esta disponible.');
    }

    const nombre = input.nombre.trim();
    const descripcion = input.descripcion.trim();
    const errores: { field: string; message: string }[] = [];

    if (nombre.length < 5 || nombre.length > 150) {
      errores.push({ field: 'nombreServicio', message: 'Debe tener entre 5 y 150 caracteres.' });
    }
    if (descripcion.length < 20) {
      errores.push({
        field: 'descripcion',
        message: 'Describa el servicio con al menos 20 caracteres.',
      });
    }
    if (errores.length > 0) {
      throw AppError.validation('Los datos del servicio no son validos.', errores);
    }

    return new Servicio({
      id: 0,
      nombre,
      descripcion,
      idPrestador: input.idPrestador,
      idCategoria: input.idCategoria,
      estado: 'ACTIVE',
      deletedAt: null,
    });
  }

  get id(): number {
    return this.props.id;
  }
  get idPrestador(): number {
    return this.props.idPrestador;
  }
  get idCategoria(): number {
    return this.props.idCategoria;
  }
  get estado(): EstadoServicio {
    return this.props.estado;
  }
  get activo(): boolean {
    return this.props.estado === 'ACTIVE' && this.props.deletedAt === null;
  }

  /**
   * Exige ser el dueno antes de dejar modificar.
   *
   * El guardia de rol del borde dice que quien llama es OFERENTE; no dice que
   * sea el dueno de ESTE servicio. Sin esto, cualquier oferente editaria el
   * catalogo de otro (SRS RF36).
   *
   * Responde 404 y no 403: confirmar que el servicio existe permitiria enumerar
   * el catalogo ajeno aunque no se pudiera modificar.
   */
  private exigirPropiedad(idPrestador: number): void {
    if (this.props.idPrestador !== idPrestador) {
      throw AppError.notFound('El servicio no existe.');
    }
  }

  editar(
    idPrestador: number,
    cambios: { nombre?: string; descripcion?: string; idCategoria?: number }
  ): void {
    this.exigirPropiedad(idPrestador);

    if (cambios.nombre !== undefined) {
      const nombre = cambios.nombre.trim();
      if (nombre.length < 5 || nombre.length > 150) {
        throw AppError.validation('El nombre del servicio no es valido.');
      }
      this.props.nombre = nombre;
    }
    if (cambios.descripcion !== undefined) {
      const descripcion = cambios.descripcion.trim();
      if (descripcion.length < 20) {
        throw AppError.validation('La descripcion es demasiado corta.');
      }
      this.props.descripcion = descripcion;
    }
    if (cambios.idCategoria !== undefined) {
      this.props.idCategoria = cambios.idCategoria;
    }
  }

  cambiarEstado(idPrestador: number, estado: EstadoServicio): void {
    this.exigirPropiedad(idPrestador);
    this.props.estado = estado;
  }

  /** Retirada por moderacion: la ejecuta un administrador, no el dueno (SRS RF104). */
  retirarPorModeracion(): void {
    this.props.estado = 'INACTIVE';
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.props.id,
      nombre: this.props.nombre,
      descripcion: this.props.descripcion,
      idPrestador: this.props.idPrestador,
      idCategoria: this.props.idCategoria,
      estado: this.props.estado,
    };
  }
}

/** Criterios de busqueda publica (SRS RF45 a RF49). */
export interface CriteriosBusqueda {
  texto?: string | undefined;
  idCategoria?: number | undefined;
  idPrestador?: number | undefined;
  pagina: number;
  tamano: number;
}

/** Tope de pagina: sin el, una peticion puede pedir el catalogo entero (SRS RNF-S04). */
export const TAMANO_PAGINA_MAXIMO = 50;

export function normalizarCriterios(entrada: Partial<CriteriosBusqueda>): CriteriosBusqueda {
  const pagina = Math.max(1, Math.floor(entrada.pagina ?? 1));
  const tamano = Math.min(TAMANO_PAGINA_MAXIMO, Math.max(1, Math.floor(entrada.tamano ?? 20)));

  return {
    texto: entrada.texto?.trim() || undefined,
    idCategoria: entrada.idCategoria,
    idPrestador: entrada.idPrestador,
    pagina,
    tamano,
  };
}
