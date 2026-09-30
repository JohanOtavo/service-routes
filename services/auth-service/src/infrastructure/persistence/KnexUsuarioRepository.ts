import type { Knex } from 'knex';
import { AppError } from '@punto-amigo/shared';
import { Usuario, type EstadoCuenta } from '../../domain/entities/Usuario';
import { Email } from '../../domain/value-objects/Email';
import { UserRoles } from '../../domain/value-objects/UserRole';
import type { IUsuarioRepository } from '../../domain/ports/out';
import { currentDb } from './transaction';

interface FilaUsuario {
  id_usuario: number;
  nombre: string;
  correo: string;
  contrasena_hash: string;
  telefono: string | null;
  estado: string;
  ultimo_acceso_at: Date | null;
  deleted_at: Date | null;
}

/**
 * Repositorio de usuarios sobre MySQL.
 *
 * Todas las consultas usan el constructor de Knex, nunca concatenacion de
 * cadenas: los valores viajan como parametros enlazados y no como parte del SQL
 * (security-rules.md, "consultas parametrizadas SIEMPRE").
 */
export class KnexUsuarioRepository implements IUsuarioRepository {
  constructor(private readonly knex: Knex) {}

  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  async findByEmail(email: Email): Promise<Usuario | null> {
    const fila = await this.db<FilaUsuario>('usuario')
      .where({ correo: email.value })
      .whereNull('deleted_at')
      .first();

    return fila === undefined ? null : this.hidratar(fila, await this.rolesDe(fila.id_usuario));
  }

  async findById(id: number): Promise<Usuario | null> {
    const fila = await this.db<FilaUsuario>('usuario').where({ id_usuario: id }).first();
    return fila === undefined ? null : this.hidratar(fila, await this.rolesDe(id));
  }

  async existsByEmail(email: Email): Promise<boolean> {
    const fila = await this.db('usuario')
      .select('id_usuario')
      .where({ correo: email.value })
      .first();
    return fila !== undefined;
  }

  async save(usuario: Usuario): Promise<Usuario> {
    try {
      const [id] = await this.db('usuario').insert({
        nombre: usuario.nombre,
        correo: usuario.email.value,
        contrasena_hash: usuario.contrasenaHash,
        telefono: usuario.telefono,
        estado: usuario.estado,
      });

      const idUsuario = Number(id);
      await this.sincronizarRoles(idUsuario, usuario.roles.toArray(), null);

      const persistido = await this.findById(idUsuario);
      if (persistido === null) {
        throw new Error('El usuario recien insertado no se pudo releer.');
      }
      return persistido;
    } catch (error) {
      /**
       * El UNIQUE sobre el correo es la garantia real de unicidad, no la
       * consulta previa del caso de uso: entre aquella y este INSERT cabe otro
       * registro con el mismo correo. Traducir el choque al mismo error de
       * conflicto hace que el resultado no dependa de quien llegue primero.
       */
      if (esCorreoDuplicado(error)) {
        throw AppError.conflict('Ese correo ya esta registrado.');
      }
      throw error;
    }
  }

  async update(usuario: Usuario): Promise<void> {
    await this.db('usuario')
      .where({ id_usuario: usuario.id })
      .update({
        nombre: usuario.nombre,
        contrasena_hash: usuario.contrasenaHash,
        telefono: usuario.telefono,
        estado: usuario.estado,
        ultimo_acceso_at: usuario.ultimoAccesoAt,
      });

    await this.sincronizarRoles(usuario.id, usuario.roles.toArray(), null);
  }

  private async rolesDe(idUsuario: number): Promise<string[]> {
    const filas = await this.db('usuario_rol as ur')
      .join('rol as r', 'r.id_rol', 'ur.id_rol')
      .where('ur.id_usuario', idUsuario)
      .select<{ nombre_rol: string }[]>('r.nombre_rol');

    return filas.map((f) => f.nombre_rol);
  }

  /**
   * Alinea los roles almacenados con los del agregado.
   *
   * Inserta los que faltan y borra los que sobran. Se ignora el duplicado al
   * insertar en lugar de consultar antes, porque la clave primaria compuesta ya
   * impide la repeticion y una comprobacion previa volveria a abrir la ventana
   * entre la lectura y la escritura.
   */
  private async sincronizarRoles(
    idUsuario: number,
    roles: string[],
    asignadoPor: number | null
  ): Promise<void> {
    const catalogo = await this.db('rol')
      .whereIn('nombre_rol', roles)
      .select<{ id_rol: number; nombre_rol: string }[]>('id_rol', 'nombre_rol');

    if (catalogo.length !== roles.length) {
      const conocidos = new Set(catalogo.map((r) => r.nombre_rol));
      const desconocidos = roles.filter((r) => !conocidos.has(r));
      throw new Error(`Roles no registrados en el catalogo: ${desconocidos.join(', ')}`);
    }

    const idsDeseados = catalogo.map((r) => r.id_rol);

    await this.db('usuario_rol')
      .insert(
        idsDeseados.map((idRol) => ({
          id_usuario: idUsuario,
          id_rol: idRol,
          asignado_por: asignadoPor,
        }))
      )
      .onConflict(['id_usuario', 'id_rol'])
      .ignore();

    await this.db('usuario_rol')
      .where({ id_usuario: idUsuario })
      .whereNotIn('id_rol', idsDeseados)
      .delete();
  }

  private hidratar(fila: FilaUsuario, roles: string[]): Usuario {
    return Usuario.rehydrate({
      id: fila.id_usuario,
      nombre: fila.nombre,
      email: Email.create(fila.correo),
      contrasenaHash: fila.contrasena_hash,
      telefono: fila.telefono,
      estado: fila.estado as EstadoCuenta,
      roles: UserRoles.create(roles),
      ultimoAccesoAt: fila.ultimo_acceso_at,
      deletedAt: fila.deleted_at,
    });
  }
}

/** Detecta el choque con el UNIQUE del correo sin acoplarse al texto del mensaje. */
function esCorreoDuplicado(error: unknown): boolean {
  const e = error as { code?: string; errno?: number; sqlMessage?: string };
  return (
    (e.code === 'ER_DUP_ENTRY' || e.errno === 1062) &&
    (e.sqlMessage?.includes('correo') ?? false)
  );
}
