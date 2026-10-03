import type { Knex } from 'knex';
import { currentDb } from '@punto-amigo/service-kit';
import type { EstadoPrestador } from '../../domain';
import type {
  IPrestadorRefRepository,
  PrestadorRef,
  RefrescoPrestador,
} from '../../application/ports';

/** Fila de `pa_catalog.prestador_ref`, tal como la devuelve el motor. */
interface FilaPrestadorRef {
  id_prestador: number;
  id_usuario: number;
  nombre: string;
  especialidad: string | null;
  estado: string;
}

// `synced_at` se escribe pero no se lee: a quien consulta la replica no le
// sirve de nada saber cuando se sincronizo, y pedirla obligaria a traerla en
// cada consulta. Por eso tampoco esta en el tipo de la fila.
const COLUMNAS = ['id_prestador', 'id_usuario', 'nombre', 'especialidad', 'estado'] as const;

/**
 * Replica local del prestador, alimentada solo por eventos de pa_provider.
 *
 * Nada de este servicio escribe aqui por decision propia: si lo hiciera, la
 * replica dejaria de ser una copia y pasaria a ser una segunda fuente de verdad
 * que diverge de pa_provider sin que nadie lo note.
 */
export class KnexPrestadorRefRepository implements IPrestadorRefRepository {
  constructor(private readonly knex: Knex) {}

  /** La transaccion en curso si la hay: el consumidor entrega la suya. */
  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  async findById(idPrestador: number): Promise<PrestadorRef | null> {
    const fila = await this.db<FilaPrestadorRef>('prestador_ref')
      .select(...COLUMNAS)
      .where({ id_prestador: idPrestador })
      .first();

    return fila === undefined ? null : this.aPuerto(fila);
  }

  async findByUsuario(idUsuario: number): Promise<PrestadorRef | null> {
    const fila = await this.db<FilaPrestadorRef>('prestador_ref')
      .select(...COLUMNAS)
      .where({ id_usuario: idUsuario })
      .first();

    return fila === undefined ? null : this.aPuerto(fila);
  }

  /**
   * Alta o refresco, descartando lo que llegue tarde.
   *
   * `synced_at` guarda el momento del HECHO, no el de la escritura, y la
   * condicion `synced_at <= ?` del UPDATE es lo que impide que un evento viejo
   * pise a uno nuevo. Hace falta porque el consumidor procesa hasta `prefetch`
   * mensajes a la vez: dos cambios seguidos del mismo prestador pueden
   * terminar en desorden, y sin esta guarda el catalogo se quedaria mostrando
   * el nombre anterior sin que ningun evento se hubiera perdido.
   *
   * Es un INSERT ... ON DUPLICATE KEY UPDATE con la guarda incrustada en los
   * valores, y no un SELECT seguido de un UPDATE, porque entre esas dos
   * sentencias cabe otro manejador haciendo lo mismo.
   */
  async upsert(datos: RefrescoPrestador): Promise<void> {
    // `merge` con expresiones: en MySQL, Knex traduce `onConflict().merge()` a
    // ON DUPLICATE KEY UPDATE, y `VALUES(col)` es la fila que se intentaba
    // insertar. La comparacion se hace columna a columna porque MySQL no
    // permite condicionar el UPDATE entero.
    const condicional = (columna: string): Knex.Raw =>
      this.knex.raw(`IF(synced_at <= VALUES(synced_at), VALUES(??), ??)`, [columna, columna]);

    await this.db('prestador_ref')
      .insert({
        id_prestador: datos.idPrestador,
        id_usuario: datos.idUsuario,
        nombre: datos.nombre,
        especialidad: datos.especialidad,
        estado: datos.estado,
        synced_at: datos.ocurridoAt,
      })
      .onConflict('id_prestador')
      .merge({
        id_usuario: condicional('id_usuario'),
        nombre: condicional('nombre'),
        especialidad: condicional('especialidad'),
        estado: condicional('estado'),
        synced_at: this.knex.raw('GREATEST(synced_at, VALUES(synced_at))'),
      });
  }

  /**
   * Solo el estado, y solo si el evento es mas reciente que lo guardado.
   *
   * Devuelve false cuando no hay fila todavia. No se inserta una: el evento no
   * trae nombre, y una fila con el nombre vacio apareceria en la busqueda
   * publica como un prestador sin nombre.
   */
  async actualizarEstado(datos: {
    idPrestador: number;
    estado: EstadoPrestador;
    ocurridoAt: Date;
  }): Promise<boolean> {
    const afectadas = await this.db('prestador_ref')
      .where({ id_prestador: datos.idPrestador })
      .where('synced_at', '<=', datos.ocurridoAt)
      .update({ estado: datos.estado, synced_at: datos.ocurridoAt });

    return afectadas > 0;
  }

  private aPuerto(fila: FilaPrestadorRef): PrestadorRef {
    return {
      idPrestador: Number(fila.id_prestador),
      idUsuario: Number(fila.id_usuario),
      nombre: fila.nombre,
      especialidad: fila.especialidad,
      // La columna no tiene CHECK, pero solo la escribe este servicio tras
      // validar el valor en `exigirEstadoPrestador`.
      estado: fila.estado as EstadoPrestador,
    };
  }
}
