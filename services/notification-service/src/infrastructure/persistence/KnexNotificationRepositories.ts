import type { Knex } from 'knex';
import { AppError } from '@punto-amigo/shared';
import { currentDb } from '@punto-amigo/service-kit';
import {
  Notificacion,
  type DatosUsuarioRef,
  type EstadoCuentaRef,
  type EstadoNotificacion,
  type INotificacionRepository,
  type IUsuarioRefRepository,
  type Pagina,
  type RecursoNotificacion,
  type TipoNotificacion,
} from '../../domain';

interface FilaNotificacion {
  id_notificacion: number;
  id_usuario: number;
  tipo: string;
  titulo: string;
  mensaje: string;
  recurso_tipo: string | null;
  recurso_id: number | null;
  estado: string;
  leida_at: Date | null;
  fecha: Date;
}

const COLUMNAS = [
  'id_notificacion',
  'id_usuario',
  'tipo',
  'titulo',
  'mensaje',
  'recurso_tipo',
  'recurso_id',
  'estado',
  'leida_at',
  'fecha',
] as const;

export class KnexNotificacionRepository implements INotificacionRepository {
  constructor(private readonly knex: Knex) {}

  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  async findById(id: number): Promise<Notificacion | null> {
    const fila = await this.db<FilaNotificacion>('notificacion')
      .select(...COLUMNAS)
      .where({ id_notificacion: id })
      .first();

    return fila === undefined ? null : this.aDominio(fila);
  }

  async save(notificacion: Notificacion): Promise<Notificacion> {
    // `aFila()` lo construye el dominio para que `props` siga siendo privado.
    const [id] = await this.db('notificacion').insert(notificacion.aFila());

    const guardada = await this.findById(Number(id));
    if (guardada === null) throw new Error('La notificacion recien insertada no se pudo leer.');
    return guardada;
  }

  /**
   * Solo escribe el estado de lectura.
   *
   * El texto y el recurso quedan fuera del UPDATE a proposito: un aviso cuenta
   * un hecho que ya ocurrio, y reescribirlo despues haria que el historial
   * dijera algo distinto de lo que la persona leyo.
   */
  async update(notificacion: Notificacion): Promise<void> {
    const afectadas = await this.db('notificacion')
      .where({ id_notificacion: notificacion.id })
      .update({
        estado: notificacion.estado,
        leida_at: notificacion.leidaAt,
      });

    if (afectadas === 0) {
      throw AppError.conflict('La notificacion cambio o se elimino mientras se actualizaba.');
    }
  }

  /**
   * El destinatario es parte del WHERE, nunca una comprobacion posterior.
   *
   * Asi es imposible que esta consulta devuelva avisos ajenos, por mucho que
   * alguien anada despues una ruta y olvide filtrar.
   */
  async listarDe(
    idUsuario: number,
    filtros: { estado?: EstadoNotificacion | undefined },
    pagina: number,
    tamano: number
  ): Promise<Pagina<Notificacion>> {
    const filtrar = (q: Knex.QueryBuilder): Knex.QueryBuilder => {
      const base = q.where({ id_usuario: idUsuario });
      return filtros.estado === undefined ? base : base.where({ estado: filtros.estado });
    };

    const conteo = (await filtrar(this.db('notificacion')).count({
      total: '*',
    })) as unknown as { total: number }[];

    const filas = (await filtrar(this.db('notificacion'))
      .select(...COLUMNAS)
      // Lo mas reciente primero: una bandeja se lee de arriba abajo.
      .orderBy('fecha', 'desc')
      .limit(tamano)
      .offset((pagina - 1) * tamano)) as unknown as FilaNotificacion[];

    return {
      elementos: filas.map((f) => this.aDominio(f)),
      total: Number(conteo[0]?.total ?? 0),
      pagina,
      tamano,
    };
  }

  async contarNoLeidas(idUsuario: number): Promise<number> {
    const filas = (await this.db('notificacion')
      .where({ id_usuario: idUsuario, estado: 'NO_LEIDA' })
      .count({ total: '*' })) as unknown as { total: number }[];

    return Number(filas[0]?.total ?? 0);
  }

  async marcarTodasLeidasDe(idUsuario: number, leidaAt: Date): Promise<number> {
    return this.db('notificacion')
      .where({ id_usuario: idUsuario, estado: 'NO_LEIDA' })
      .update({ estado: 'LEIDA', leida_at: leidaAt });
  }

  private aDominio(fila: FilaNotificacion): Notificacion {
    return Notificacion.rehydrate({
      id: Number(fila.id_notificacion),
      idUsuario: Number(fila.id_usuario),
      // `tipo` es VARCHAR sin CHECK a proposito: un tipo nuevo no debe exigir
      // una migracion. La conversion es segura porque solo escribe este servicio.
      tipo: fila.tipo as TipoNotificacion,
      titulo: fila.titulo,
      mensaje: fila.mensaje,
      recursoTipo: fila.recurso_tipo === null ? null : (fila.recurso_tipo as RecursoNotificacion),
      recursoId: fila.recurso_id === null ? null : Number(fila.recurso_id),
      estado: fila.estado as EstadoNotificacion,
      leidaAt: fila.leida_at,
      fecha: fila.fecha,
    });
  }
}

/**
 * Replica del usuario. Guarda el identificador, el nombre, el estado y la
 * especialidad, y nada mas.
 *
 * No guarda correo ni telefono aunque el helper comun cree esas columnas: la
 * entrega por correo y por push esta fuera del alcance, asi que serian datos de
 * contacto replicados que este servicio no puede usar para nada. Replicar un
 * dato personal "por si acaso" solo amplia la superficie de una fuga.
 */
export class KnexUsuarioRefRepository implements IUsuarioRefRepository {
  constructor(private readonly knex: Knex) {}

  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  async existe(idUsuario: number): Promise<boolean> {
    const fila = await this.db('usuario_ref').where({ id_usuario: idUsuario }).first('id_usuario');
    return fila !== undefined;
  }

  /**
   * Upsert, no insert: el evento puede reentregarse y la segunda vez no debe
   * fallar por clave duplicada, que es un fallo del transporte y no del dato.
   */
  async guardar(datos: DatosUsuarioRef): Promise<void> {
    await this.db('usuario_ref')
      .insert({
        id_usuario: datos.idUsuario,
        nombre: datos.nombre,
        // Explicito: estas columnas existen en el helper comun y aqui se
        // dejan vacias a proposito, no por olvido.
        correo: null,
        telefono: null,
        estado: datos.estado,
        synced_at: datos.syncedAt,
      })
      .onConflict('id_usuario')
      .merge(['nombre', 'estado', 'synced_at']);
  }

  async actualizarEstado(
    idUsuario: number,
    estado: EstadoCuentaRef,
    syncedAt: Date
  ): Promise<number> {
    // Devuelve cuantas cambiaron: cero significa que no se conoce al usuario, y
    // el caso de uso decide que hacer con eso en lugar de fallar aqui.
    return this.db('usuario_ref')
      .where({ id_usuario: idUsuario })
      .update({ estado, synced_at: syncedAt });
  }

  async actualizarEspecialidad(
    idUsuario: number,
    especialidad: string,
    syncedAt: Date
  ): Promise<number> {
    return this.db('usuario_ref')
      .where({ id_usuario: idUsuario })
      .update({ especialidad, synced_at: syncedAt });
  }
}
