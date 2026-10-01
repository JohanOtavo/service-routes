import type { Knex } from 'knex';
import { AppError } from '@punto-amigo/shared';
import { currentDb } from '@punto-amigo/service-kit';
import { Categoria } from '../../domain';
import type { ICategoriaRepository } from '../../application/ports';

/** Fila de `pa_catalog.categoria_servicio`, tal como la devuelve el motor. */
interface FilaCategoria {
  id_categoria: number;
  nombre_categoria: string;
  descripcion: string | null;
  activa: number | boolean;
}

/** Codigo de MySQL para violacion de clave unica. */
const ER_DUP_ENTRY = 1062;

const COLUMNAS = ['id_categoria', 'nombre_categoria', 'descripcion', 'activa'] as const;

export class KnexCategoriaRepository implements ICategoriaRepository {
  constructor(private readonly knex: Knex) {}

  /**
   * Conexion a usar: la transaccion en curso si la hay.
   *
   * Es lo que permite que el alta de la categoria y su evento en el outbox se
   * confirmen juntos. Usar `this.knex` directamente escribiria por fuera de la
   * transaccion y rompia esa garantia sin avisar.
   */
  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  /**
   * El filtro de borrado logico va en SQL y no despues de cargar.
   *
   * Una categoria borrada no existe para nadie, asi que traerla para
   * descartarla solo gasta trabajo.
   *
   * `activa = false` NO se filtra aqui: es un ESTADO, no un borrado. Una
   * categoria desactivada debe seguir siendo localizable para reactivarla y
   * para que `Servicio.publicar` pueda rechazarla con un motivo que se entienda.
   */
  async findById(id: number): Promise<Categoria | null> {
    const fila = await this.db<FilaCategoria>('categoria_servicio')
      .select(...COLUMNAS)
      .where({ id_categoria: id })
      .whereNull('deleted_at')
      .first();

    return fila === undefined ? null : this.aDominio(fila);
  }

  /**
   * Inserta y devuelve la categoria con su identificador.
   *
   * El choque con el UNIQUE de `nombre_categoria` se traduce a conflicto: es la
   * regla "el nombre es unico" (SRS RF42) hablando, no un fallo del motor, y
   * dejarlo salir como 500 le diria al administrador que el sistema se rompio
   * cuando lo que pasa es que esa categoria ya existe.
   */
  async save(categoria: Categoria, creadoPor: number): Promise<Categoria> {
    const datos = categoria.toJSON();

    try {
      const [id] = await this.db('categoria_servicio').insert({
        nombre_categoria: datos['nombre'],
        descripcion: datos['descripcion'],
        activa: datos['activa'],
        created_by: creadoPor,
      });

      const guardada = await this.findById(Number(id));
      if (guardada === null) {
        // Imposible salvo que algo borre la fila entre el INSERT y el SELECT,
        // dentro de la misma transaccion. Si ocurre, es un error del sistema.
        throw new Error('La categoria recien insertada no se pudo leer.');
      }
      return guardada;
    } catch (error) {
      if (this.esDuplicado(error)) {
        throw AppError.conflict('Ya existe una categoria con ese nombre.');
      }
      throw error;
    }
  }

  async update(categoria: Categoria): Promise<void> {
    const datos = categoria.toJSON();

    try {
      const afectadas = await this.db('categoria_servicio')
        .where({ id_categoria: datos['id'] })
        .whereNull('deleted_at')
        .update({
          nombre_categoria: datos['nombre'],
          descripcion: datos['descripcion'],
          activa: datos['activa'],
        });

      // Cero filas significa que la categoria se borro entre la lectura y la
      // escritura. Confirmar la transaccion como si todo hubiera ido bien
      // dejaria un evento en el outbox anunciando un cambio que no ocurrio.
      if (afectadas === 0) {
        throw AppError.conflict('La categoria cambio o se elimino mientras se editaba.');
      }
    } catch (error) {
      if (this.esDuplicado(error)) {
        throw AppError.conflict('Ya existe una categoria con ese nombre.');
      }
      throw error;
    }
  }

  /**
   * Catalogo disponible para clasificar y filtrar (SRS RF44).
   *
   * Sin paginar: el numero de categorias lo fija un administrador a mano y se
   * cuenta por decenas. El indice `idx_categoria_disponibles` cubre justo este
   * par de condiciones.
   */
  async listarActivas(): Promise<readonly Categoria[]> {
    const filas = await this.db<FilaCategoria>('categoria_servicio')
      .select(...COLUMNAS)
      .where({ activa: true })
      .whereNull('deleted_at')
      .orderBy('nombre_categoria', 'asc');

    return filas.map((f) => this.aDominio(f));
  }

  /**
   * `activa` llega como 0 o 1 desde MySQL.
   *
   * El driver no convierte TINYINT(1) a booleano, y `Boolean(0)` es false pero
   * `Boolean("0")` seria true: convertirlo aqui, una sola vez, evita que cada
   * sitio que lea esta fila tenga que acordarse.
   */
  private aDominio(fila: FilaCategoria): Categoria {
    return Categoria.rehydrate({
      id: Number(fila.id_categoria),
      nombre: fila.nombre_categoria,
      descripcion: fila.descripcion,
      activa: Number(fila.activa) === 1,
    });
  }

  private esDuplicado(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      (error as { errno?: number }).errno === ER_DUP_ENTRY
    );
  }
}
