import type { Knex } from 'knex';
import { currentDb } from '@punto-amigo/service-kit';
import type {
  AsientoHistorial,
  ICancelacionRepository,
  IHistorialRepository,
  IReplicaRepository,
  MotivoCancelacion,
  MotivoOfrecido,
  PrestadorRef,
  RegistroCancelacion,
  ServicioRef,
  UsuarioRef,
} from '../../domain';

/**
 * Historial de estados de una solicitud (SRS RF70).
 *
 * Solo inserta. Sin `update` ni `delete` a proposito: un historial que se puede
 * corregir no prueba nada, y de aqui sale la fecha de aceptacion que decide la
 * ventana de gracia de una cancelacion. Si se pudiera editar, se podria mover
 * esa fecha y hacer que una cancelacion tardia pareciera inmediata.
 */
export class KnexHistorialRepository implements IHistorialRepository {
  constructor(private readonly knex: Knex) {}

  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  async registrar(asiento: AsientoHistorial): Promise<void> {
    await this.db('historial_solicitud').insert({
      id_solicitud: asiento.idSolicitud,
      estado_anterior: asiento.estadoAnterior,
      estado_nuevo: asiento.estadoNuevo,
      cambiado_por: asiento.cambiadoPor,
      motivo: asiento.motivo,
      fecha_cambio: asiento.fechaCambio,
    });
  }
}

export class KnexCancelacionRepository implements ICancelacionRepository {
  constructor(private readonly knex: Knex) {}

  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  /**
   * Motivo del catalogo, solo si esta activo.
   *
   * Los motivos son datos y no una enumeracion en el codigo porque sus efectos
   * —si computa, si traslada la falta, si exige validacion— son parametros que
   * hay que recalibrar con datos reales, y cambiarlos no deberia exigir un
   * despliegue. Un motivo desactivado no se puede volver a elegir, pero las
   * cancelaciones que ya lo usaron lo conservan.
   */
  async buscarMotivo(codigo: string): Promise<MotivoCancelacion | null> {
    const fila = await this.db('motivo_cancelacion')
      .where({ codigo, activo: true })
      .first();

    if (fila === undefined) return null;

    return {
      codigo: String(fila.codigo),
      // MySQL devuelve los booleanos como 0 o 1; `Boolean` sobre 0 da false.
      computa: Boolean(fila.computa),
      trasladaFalta: Boolean(fila.traslada_falta),
      exigeValidacion: Boolean(fila.exige_validacion),
      exigeDetalle: Boolean(fila.exige_detalle),
    };
  }

  /**
   * Los motivos activos, ordenados por descripcion.
   *
   * Solo lo que quien cancela necesita ver. `computa` y `traslada_falta` se
   * quedan fuera: son el efecto que decide el servidor, y ofrecerlos seria
   * invitar a elegir el motivo por su consecuencia y no por lo que paso.
   */
  async listarMotivos(): Promise<readonly MotivoOfrecido[]> {
    const filas = await this.db('motivo_cancelacion')
      .where({ activo: true })
      .orderBy('descripcion', 'asc')
      .select('codigo', 'descripcion', 'exige_detalle', 'traslada_falta', 'exige_validacion');

    return filas.map((f) => ({
      codigo: String(f.codigo),
      descripcion: String(f.descripcion),
      exigeDetalle: Boolean(f.exige_detalle),
      // Los dos caminos que abren revision se presentan como uno: a quien
      // cancela le da igual por que motivo tecnico su caso se va a revisar.
      abreRevision: Boolean(f.traslada_falta) || Boolean(f.exige_validacion),
    }));
  }

  async guardar(registro: RegistroCancelacion): Promise<number> {
    const [id] = await this.db('cancelacion').insert({
      id_solicitud: registro.idSolicitud,
      parte_canceladora: registro.parteCanceladora,
      id_usuario_cancela: registro.idUsuarioCancela,
      id_usuario_afectado: registro.idUsuarioAfectado,
      estado_origen: registro.estadoOrigen,
      codigo_motivo: registro.codigoMotivo,
      detalle: registro.detalle,
      franja: registro.franja,
      horas_de_antelacion: registro.horasDeAntelacion,
      peso: registro.peso,
      computa: registro.computa,
      id_usuario_imputado: registro.idUsuarioImputado,
      estado: registro.estado,
      cancelada_at: registro.canceladaAt,
    });

    return Number(id);
  }
}

/**
 * Replicas locales de datos ajenos (`prestador_ref`, `servicio_ref`,
 * `categoria_ref`).
 *
 * Son copias de lo que poseen provider-service y catalog-service. Existen para
 * que contratar no dependa de que esos servicios esten levantados: preguntarles
 * por HTTP en cada solicitud convertiria una caida del catalogo en la
 * imposibilidad de aceptar una contratacion ya acordada.
 *
 * Las escrituras son UPSERT, no INSERT. El broker entrega al menos una vez y los
 * eventos pueden llegar desordenados; un INSERT fallaria en la segunda entrega y
 * mandaria a la cola de fallidos algo que no tiene nada de malo.
 */
export class KnexReplicaRepository implements IReplicaRepository {
  constructor(private readonly knex: Knex) {}

  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  async usuarioPorId(idUsuario: number): Promise<UsuarioRef | null> {
    const fila = await this.db('usuario_ref').where({ id_usuario: idUsuario }).first();
    if (fila === undefined) return null;

    return {
      idUsuario: Number(fila.id_usuario),
      nombre: String(fila.nombre),
      correo: fila.correo === null ? null : String(fila.correo),
      telefono: fila.telefono === null ? null : String(fila.telefono),
      estado: String(fila.estado),
    };
  }

  async upsertUsuario(ref: UsuarioRef): Promise<void> {
    await this.db('usuario_ref')
      .insert({
        id_usuario: ref.idUsuario,
        nombre: ref.nombre,
        correo: ref.correo,
        telefono: ref.telefono,
        estado: ref.estado,
        synced_at: new Date(),
      })
      .onConflict('id_usuario')
      .merge(['nombre', 'correo', 'telefono', 'estado', 'synced_at']);
  }

  async prestadorPorId(idPrestador: number): Promise<PrestadorRef | null> {
    const fila = await this.db('prestador_ref').where({ id_prestador: idPrestador }).first();
    return fila === undefined ? null : this.aPrestador(fila);
  }

  async prestadorPorUsuario(idUsuario: number): Promise<PrestadorRef | null> {
    const fila = await this.db('prestador_ref').where({ id_usuario: idUsuario }).first();
    return fila === undefined ? null : this.aPrestador(fila);
  }

  async servicioPorId(idServicio: number): Promise<ServicioRef | null> {
    const fila = await this.db('servicio_ref').where({ id_servicio: idServicio }).first();
    if (fila === undefined) return null;

    return {
      idServicio: Number(fila.id_servicio),
      idPrestador: Number(fila.id_prestador),
      idCategoria: Number(fila.id_categoria),
      nombreServicio: String(fila.nombre_servicio),
      estado: String(fila.estado),
    };
  }

  /**
   * Una categoria desconocida cuenta como NO activa.
   *
   * Es denegacion por defecto: si la replica aun no recibio el evento de alta,
   * es mejor rechazar la publicacion —el usuario reintenta— que aceptarla
   * contra una categoria que quiza no existe y dejar una necesidad huerfana.
   */
  async categoriaActiva(idCategoria: number): Promise<boolean> {
    const fila = await this.db('categoria_ref').where({ id_categoria: idCategoria }).first();
    return fila !== undefined && Boolean(fila.activa);
  }

  async upsertPrestador(ref: PrestadorRef): Promise<void> {
    await this.db('prestador_ref')
      .insert({
        id_prestador: ref.idPrestador,
        id_usuario: ref.idUsuario,
        nombre: ref.nombre,
        especialidad: ref.especialidad,
        estado: ref.estado,
        synced_at: new Date(),
      })
      .onConflict('id_prestador')
      .merge(['id_usuario', 'nombre', 'especialidad', 'estado', 'synced_at']);
  }

  async upsertServicio(ref: ServicioRef): Promise<void> {
    await this.db('servicio_ref')
      .insert({
        id_servicio: ref.idServicio,
        id_prestador: ref.idPrestador,
        id_categoria: ref.idCategoria,
        nombre_servicio: ref.nombreServicio,
        estado: ref.estado,
        synced_at: new Date(),
      })
      .onConflict('id_servicio')
      .merge(['id_prestador', 'id_categoria', 'nombre_servicio', 'estado', 'synced_at']);
  }

  async upsertCategoria(ref: {
    idCategoria: number;
    nombreCategoria: string;
    activa: boolean;
  }): Promise<void> {
    await this.db('categoria_ref')
      .insert({
        id_categoria: ref.idCategoria,
        nombre_categoria: ref.nombreCategoria,
        activa: ref.activa,
        synced_at: new Date(),
      })
      .onConflict('id_categoria')
      .merge(['nombre_categoria', 'activa', 'synced_at']);
  }

  private aPrestador(fila: Record<string, unknown>): PrestadorRef {
    return {
      idPrestador: Number(fila['id_prestador']),
      idUsuario: Number(fila['id_usuario']),
      nombre: String(fila['nombre']),
      especialidad: fila['especialidad'] === null ? null : String(fila['especialidad']),
      estado: String(fila['estado']),
    };
  }
}
