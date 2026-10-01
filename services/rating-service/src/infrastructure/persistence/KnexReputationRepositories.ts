import type { Knex } from 'knex';
import { currentDb } from '@punto-amigo/service-kit';
import {
  Reputacion,
  TasaCancelacion,
  type CancelacionImputada,
  type Faceta,
  type IReputacionRepository,
  type ISolicitudRefRepository,
  type ITasaCancelacionRepository,
  type SolicitudCalificable,
  type VentanaCancelacion,
} from '../../domain';

export class KnexReputacionRepository implements IReputacionRepository {
  constructor(private readonly knex: Knex) {}

  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  async buscar(idUsuario: number, faceta: Faceta): Promise<Reputacion | null> {
    const fila = await this.db('reputacion').where({ id_usuario: idUsuario, faceta }).first();
    if (fila === undefined) return null;

    return Reputacion.rehydrate({
      idUsuario: Number(fila.id_usuario),
      faceta: String(fila.faceta) as Faceta,
      // DECIMAL llega como cadena.
      puntuacionMedia: Number(fila.puntuacion_media),
      totalCalificaciones: Number(fila.total_calificaciones),
      actualizadoAt: fila.actualizado_at as Date,
    });
  }

  /**
   * UPSERT, no INSERT ni UPDATE.
   *
   * La fila nace con la primera calificacion que esa persona recibe en esa
   * faceta, y a partir de ahi se reescribe. Con un UPDATE la primera se
   * perderia; con un INSERT fallaria la segunda.
   */
  async guardar(reputacion: Reputacion): Promise<void> {
    await this.db('reputacion')
      .insert({
        id_usuario: reputacion.idUsuario,
        faceta: reputacion.faceta,
        puntuacion_media: reputacion.puntuacionMedia,
        total_calificaciones: reputacion.totalCalificaciones,
        actualizado_at: reputacion.actualizadoAt,
      })
      .onConflict(['id_usuario', 'faceta'])
      .merge(['puntuacion_media', 'total_calificaciones', 'actualizado_at']);
  }
}

export class KnexTasaCancelacionRepository implements ITasaCancelacionRepository {
  constructor(private readonly knex: Knex) {}

  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  async buscar(idUsuario: number, faceta: Faceta): Promise<TasaCancelacion | null> {
    const fila = await this.db('tasa_cancelacion').where({ id_usuario: idUsuario, faceta }).first();
    if (fila === undefined) return null;

    return TasaCancelacion.rehydrate({
      idUsuario: Number(fila.id_usuario),
      faceta: String(fila.faceta) as Faceta,
      contratacionesEnVentana: Number(fila.contrataciones_en_ventana),
      cancelacionesPonderadas: Number(fila.cancelaciones_ponderadas),
      tasa: Number(fila.tasa),
      umbralAlcanzado: Number(fila.umbral_alcanzado),
      evaluable: Boolean(fila.evaluable),
      ventanaDesde: fila.ventana_desde as Date,
      calculadaAt: fila.calculada_at as Date,
    });
  }

  async guardar(tasa: TasaCancelacion): Promise<void> {
    await this.db('tasa_cancelacion')
      .insert({
        id_usuario: tasa.idUsuario,
        faceta: tasa.faceta,
        contrataciones_en_ventana: tasa.contratacionesEnVentana,
        cancelaciones_ponderadas: tasa.cancelacionesPonderadas,
        tasa: tasa.tasa,
        umbral_alcanzado: tasa.umbralAlcanzado,
        evaluable: tasa.evaluable,
        ventana_desde: tasa.ventanaDesde,
        calculada_at: tasa.calculadaAt,
      })
      .onConflict(['id_usuario', 'faceta'])
      .merge([
        'contrataciones_en_ventana',
        'cancelaciones_ponderadas',
        'tasa',
        'umbral_alcanzado',
        'evaluable',
        'ventana_desde',
        'calculada_at',
      ]);
  }

  /**
   * Numerador: suma de PESOS dentro de la ventana, no conteo.
   *
   * Cancelar el mismo dia pesa 1,5 y hacerlo con 48 horas de margen pesa 0,5.
   * Contar cancelaciones trataria igual las dos, y entonces avisar con tiempo no
   * serviria de nada.
   *
   * Se lee del detalle y no de un acumulado porque la ventana es movil: lo que
   * sale de ella hay que restarlo. Con solo el acumulado la tasa no podria bajar
   * nunca y una mala racha marcaria a alguien de forma permanente.
   */
  async resumirVentana(
    idUsuario: number,
    faceta: Faceta,
    desde: Date
  ): Promise<VentanaCancelacion> {
    const filas = (await this.db('cancelacion_ref')
      .where({ id_usuario_imputado: idUsuario, faceta, computa: true })
      .where('cancelada_at', '>=', desde)
      .select(this.db.raw('COALESCE(SUM(peso), 0) as ponderadas'))) as unknown as {
      ponderadas: number | string;
    }[];

    return {
      // `contrataciones` lo aporta `contarContrataciones`: aqui solo el numerador.
      contrataciones: 0,
      ponderadas: Number(filas[0]?.ponderadas ?? 0),
      ventanaDesde: desde,
    };
  }

  /**
   * Denominador: contrataciones CERRADAS en la ventana.
   *
   * Cuentan las completadas y las canceladas. Si solo contaran las que salieron
   * bien, cancelar bajaria el denominador a la vez que sube el numerador y la
   * tasa se dispararia el doble de rapido de lo que corresponde.
   *
   * La faceta decide en que lado de la solicitud se mira a la persona.
   */
  async contarContrataciones(idUsuario: number, faceta: Faceta, desde: Date): Promise<number> {
    const columna = faceta === 'COMO_OFERENTE' ? 'id_usuario_prestador' : 'id_usuario';

    const completadas = (await this.db('solicitud_ref')
      .where({ [columna]: idUsuario, estado: 'COMPLETADA' })
      .where('completada_at', '>=', desde)
      .count({ total: '*' })) as unknown as { total: number }[];

    const canceladas = (await this.db('cancelacion_ref as c')
      .join('solicitud_ref as s', 's.id_solicitud', 'c.id_solicitud')
      .where(`s.${columna}`, idUsuario)
      .where('c.cancelada_at', '>=', desde)
      .count({ total: '*' })) as unknown as { total: number }[];

    return Number(completadas[0]?.total ?? 0) + Number(canceladas[0]?.total ?? 0);
  }

  /**
   * Guarda la cancelacion imputada. Idempotente por `id_cancelacion`.
   *
   * El evento puede llegar dos veces, y una segunda fila duplicaria el peso en
   * el numerador: la misma cancelacion contaria doble y la tasa subiria por una
   * reentrega del broker, no por una conducta.
   */
  async registrarCancelacion(cancelacion: CancelacionImputada): Promise<void> {
    await this.db('cancelacion_ref')
      .insert({
        id_cancelacion: cancelacion.idCancelacion,
        id_solicitud: cancelacion.idSolicitud,
        id_usuario_imputado: cancelacion.idUsuarioImputado,
        faceta: cancelacion.faceta,
        peso: cancelacion.peso,
        computa: cancelacion.computa,
        cancelada_at: cancelacion.canceladaAt,
        synced_at: new Date(),
      })
      .onConflict('id_cancelacion')
      .merge(['id_usuario_imputado', 'faceta', 'peso', 'computa', 'cancelada_at', 'synced_at']);
  }
}

/**
 * Replica de la solicitud, alimentada por eventos de request-service.
 *
 * Es eventualmente consistente, y aqui eso es aceptable: la condicion que se
 * comprueba —"existio una solicitud COMPLETADA entre estas dos partes"— es un
 * hecho terminal. Una solicitud completada no deja de estarlo, asi que el unico
 * error posible es rechazar una calificacion unos segundos antes de tiempo,
 * nunca aceptar una que no corresponde.
 */
export class KnexSolicitudRefRepository implements ISolicitudRefRepository {
  constructor(private readonly knex: Knex) {}

  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  async buscar(idSolicitud: number): Promise<SolicitudCalificable | null> {
    const fila = await this.db('solicitud_ref').where({ id_solicitud: idSolicitud }).first();
    if (fila === undefined) return null;

    return {
      idSolicitud: Number(fila.id_solicitud),
      idUsuario: Number(fila.id_usuario),
      idUsuarioPrestador: Number(fila.id_usuario_prestador),
      idServicio: fila.id_servicio === null ? null : Number(fila.id_servicio),
      estado: String(fila.estado),
      completadaAt: fila.completada_at === null ? null : (fila.completada_at as Date),
    };
  }

  async upsert(solicitud: SolicitudCalificable, idPrestador: number): Promise<void> {
    await this.db('solicitud_ref')
      .insert({
        id_solicitud: solicitud.idSolicitud,
        id_usuario: solicitud.idUsuario,
        id_prestador: idPrestador,
        id_usuario_prestador: solicitud.idUsuarioPrestador,
        id_servicio: solicitud.idServicio,
        estado: solicitud.estado,
        completada_at: solicitud.completadaAt,
        synced_at: new Date(),
      })
      .onConflict('id_solicitud')
      .merge([
        'id_usuario',
        'id_prestador',
        'id_usuario_prestador',
        'id_servicio',
        'estado',
        'completada_at',
        'synced_at',
      ]);
  }
}
