import type { Knex } from 'knex';
import { AppError } from '@punto-amigo/shared';
import { currentDb } from '@punto-amigo/service-kit';
import {
  Prestador,
  type EstadoPrestador,
  type IPrestadorRepository,
  type Pagina,
} from '../../domain';

/** Fila de `pa_provider.prestador`, tal como la devuelve el motor. */
interface FilaPrestador {
  id_prestador: number;
  id_usuario: number;
  nombre: string;
  especialidad: string;
  experiencia: string | null;
  telefono: string | null;
  correo: string | null;
  disponibilidad: string | null;
  estado: string;
  deleted_at: Date | null;
}

/** Codigo de MySQL para violacion de clave unica. */
const ER_DUP_ENTRY = 1062;

const COLUMNAS = [
  'id_prestador',
  'id_usuario',
  'nombre',
  'especialidad',
  'experiencia',
  'telefono',
  'correo',
  'disponibilidad',
  'estado',
  'deleted_at',
] as const;

export class KnexPrestadorRepository implements IPrestadorRepository {
  constructor(private readonly knex: Knex) {}

  /**
   * Conexion a usar: la transaccion en curso si la hay.
   *
   * Es lo que permite que el cambio del perfil y su evento en el outbox se
   * confirmen juntos. Usar `this.knex` directamente escribiria por fuera de la
   * transaccion y rompia esa garantia sin avisar.
   */
  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  /**
   * El filtro de borrado logico va en SQL y no despues de cargar.
   *
   * Un perfil borrado no existe para nadie, asi que traerlo para descartarlo
   * solo gasta trabajo. La comprobacion del dominio sobre `deletedAt` sigue en
   * pie como segunda barrera para cualquier camino que no pase por aqui.
   *
   * INACTIVE no se filtra: es un ESTADO, no un borrado. Un perfil retirado debe
   * seguir siendo localizable para volver a la cola de validacion.
   */
  async findById(id: number): Promise<Prestador | null> {
    const fila = await this.db<FilaPrestador>('prestador')
      .select(...COLUMNAS)
      .where({ id_prestador: id })
      .whereNull('deleted_at')
      .first();

    return fila === undefined ? null : this.aDominio(fila);
  }

  async findByUsuario(idUsuario: number): Promise<Prestador | null> {
    const fila = await this.db<FilaPrestador>('prestador')
      .select(...COLUMNAS)
      .where({ id_usuario: idUsuario })
      .whereNull('deleted_at')
      .first();

    return fila === undefined ? null : this.aDominio(fila);
  }

  /**
   * Inserta y devuelve el perfil con su identificador.
   *
   * El choque con el UNIQUE de `id_usuario` se traduce a conflicto: es la regla
   * "un perfil por usuario" (SRS RF23) hablando, no un fallo del motor, y
   * dejarlo salir como error 500 le diria al oferente que el sistema se rompio
   * cuando lo que pasa es que ya tiene perfil.
   */
  async save(prestador: Prestador, creadoPor: number): Promise<Prestador> {
    const datos = prestador.vistaPrivada();

    try {
      const [id] = await this.db('prestador').insert({
        id_usuario: datos['idUsuario'],
        nombre: datos['nombre'],
        especialidad: datos['especialidad'],
        experiencia: datos['experiencia'],
        telefono: datos['telefono'],
        correo: datos['correo'],
        disponibilidad: datos['disponibilidad'],
        estado: datos['estado'],
        created_by: creadoPor,
      });

      const guardado = await this.findById(Number(id));
      if (guardado === null) {
        // Imposible salvo que algo borre la fila entre el INSERT y el SELECT,
        // dentro de la misma transaccion. Si ocurre, es un error del sistema.
        throw new Error('El perfil recien insertado no se pudo leer.');
      }
      return guardado;
    } catch (error) {
      if (this.esDuplicado(error)) {
        throw AppError.conflict('Ya tiene un perfil de prestador.', {
          idUsuario: datos['idUsuario'],
        });
      }
      throw error;
    }
  }

  async update(prestador: Prestador): Promise<void> {
    const datos = prestador.vistaPrivada();

    const afectadas = await this.db('prestador')
      .where({ id_prestador: datos['id'] })
      .whereNull('deleted_at')
      .update({
        nombre: datos['nombre'],
        especialidad: datos['especialidad'],
        experiencia: datos['experiencia'],
        telefono: datos['telefono'],
        correo: datos['correo'],
        disponibilidad: datos['disponibilidad'],
        estado: datos['estado'],
      });

    // Cero filas significa que el perfil se borro entre la lectura y la
    // escritura. Confirmar la transaccion como si todo hubiera ido bien dejaria
    // un evento en el outbox anunciando un cambio que no ocurrio.
    if (afectadas === 0) {
      throw AppError.conflict('El perfil cambio o se elimino mientras se editaba.');
    }
  }

  async listarPendientes(pagina: number, tamano: number): Promise<Pagina<Prestador>> {
    return this.paginar(
      (q) => q.where({ estado: 'PENDING_VALIDATION' }).whereNull('deleted_at'),
      // Los mas antiguos primero: ordenar por lo mas reciente dejaria al final
      // a quien lleva mas tiempo esperando revision.
      (q) => q.orderBy('created_at', 'asc'),
      pagina,
      tamano
    );
  }

  async listarVisibles(
    filtros: { especialidad?: string | undefined },
    pagina: number,
    tamano: number
  ): Promise<Pagina<Prestador>> {
    const especialidad = filtros.especialidad?.trim();

    return this.paginar(
      (q) => {
        const base = q.where({ estado: 'ACTIVE' }).whereNull('deleted_at');
        // Knex parametriza el LIKE: el comodin se concatena al VALOR, nunca al
        // SQL, asi que no hay forma de inyectar desde el filtro.
        return especialidad === undefined || especialidad.length === 0
          ? base
          : base.whereLike('especialidad', '%' + especialidad + '%');
      },
      (q) => q.orderBy('nombre', 'asc'),
      pagina,
      tamano
    );
  }

  /**
   * Paginacion con total.
   *
   * El filtro se aplica dos veces —una para contar y otra para traer la
   * pagina— a partir de la MISMA funcion, para que no puedan divergir: un total
   * calculado con otro filtro produce una paginacion con paginas vacias al final.
   */
  private async paginar(
    filtrar: (q: Knex.QueryBuilder) => Knex.QueryBuilder,
    ordenar: (q: Knex.QueryBuilder) => Knex.QueryBuilder,
    pagina: number,
    tamano: number
  ): Promise<Pagina<Prestador>> {
    const conteo = (await filtrar(this.db('prestador')).count({ total: '*' })) as unknown as {
      total: number;
    }[];

    const filas = (await ordenar(filtrar(this.db('prestador')).select(...COLUMNAS))
      .limit(tamano)
      .offset((pagina - 1) * tamano)) as unknown as FilaPrestador[];

    return {
      elementos: filas.map((f) => this.aDominio(f)),
      total: Number(conteo[0]?.total ?? 0),
      pagina,
      tamano,
    };
  }

  private aDominio(fila: FilaPrestador): Prestador {
    return Prestador.rehydrate({
      id: Number(fila.id_prestador),
      idUsuario: Number(fila.id_usuario),
      nombre: fila.nombre,
      especialidad: fila.especialidad,
      experiencia: fila.experiencia,
      telefono: fila.telefono,
      correo: fila.correo,
      disponibilidad: fila.disponibilidad,
      // El CHECK de la columna garantiza el conjunto de valores. Si alguien lo
      // cambiara, el dominio fallaria en la primera transicion y no en silencio.
      estado: fila.estado as EstadoPrestador,
      deletedAt: fila.deleted_at,
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
