import type { Knex } from 'knex';
import { AppError } from '@punto-amigo/shared';
import { currentDb } from '@punto-amigo/service-kit';
import {
  Solicitud,
  type EstadoSolicitud,
  type ISolicitudRepository,
  type OrigenSolicitud,
  type Pagina,
} from '../../domain';

interface FilaSolicitud {
  id_solicitud: number;
  estado: string;
  origen: string;
  descripcion_problema: string;
  id_usuario: number;
  id_prestador: number;
  id_servicio: number | null;
  id_necesidad: number | null;
  id_propuesta: number | null;
  valor_acordado: string | null;
  plazo_acordado: number | null;
  fecha_solicitud: Date;
}

const COLUMNAS = [
  'id_solicitud',
  'estado',
  'origen',
  'descripcion_problema',
  'id_usuario',
  'id_prestador',
  'id_servicio',
  'id_necesidad',
  'id_propuesta',
  'valor_acordado',
  'plazo_acordado',
  'fecha_solicitud',
] as const;

export class KnexSolicitudRepository implements ISolicitudRepository {
  constructor(private readonly knex: Knex) {}

  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  async findById(id: number): Promise<Solicitud | null> {
    const fila = await this.db<FilaSolicitud>('solicitud_servicio')
      .select(...COLUMNAS)
      .where({ id_solicitud: id })
      .whereNull('deleted_at')
      .first();

    return fila === undefined ? null : this.aDominio(fila);
  }

  async save(solicitud: Solicitud, creadoPor: number): Promise<Solicitud> {
    const d = solicitud.toJSON(false);

    const [id] = await this.db('solicitud_servicio').insert({
      estado: d['estado'],
      origen: d['origen'],
      descripcion_problema: d['descripcionProblema'],
      id_usuario: d['idUsuario'],
      id_prestador: d['idPrestador'],
      id_servicio: d['idServicio'],
      id_necesidad: d['idNecesidad'],
      id_propuesta: d['idPropuesta'],
      valor_acordado: d['valorAcordado'],
      plazo_acordado: d['plazoAcordado'],
      fecha_solicitud: d['fechaSolicitud'],
      created_by: creadoPor,
    });

    const guardada = await this.findById(Number(id));
    if (guardada === null) throw new Error('La solicitud recien insertada no se pudo leer.');
    return guardada;
  }

  /**
   * El precio y el plazo NO se actualizan nunca.
   *
   * Son el acuerdo, no una preferencia editable (REQUEST-INV-009). Dejarlos
   * fuera del UPDATE es lo que impide que un error en una capa de arriba cambie
   * lo pactado despues de pactarlo.
   */
  async update(
    solicitud: Solicitud,
    motivoEstado: string | null,
    completadaAt: Date | null
  ): Promise<void> {
    const d = solicitud.toJSON(false);

    const afectadas = await this.db('solicitud_servicio')
      .where({ id_solicitud: d['id'] })
      .whereNull('deleted_at')
      .update({
        estado: d['estado'],
        ...(motivoEstado === null ? {} : { motivo_estado: motivoEstado }),
        ...(completadaAt === null ? {} : { fecha_completada: completadaAt }),
      });

    if (afectadas === 0) {
      throw AppError.conflict('La solicitud cambio o se elimino mientras se actualizaba.');
    }
  }

  /**
   * Cuando se acepto, leido del historial.
   *
   * La politica de cancelacion mide la ventana de gracia desde ahi, y el
   * historial es la unica fuente que lo sabe: `solicitud_servicio` guarda el
   * estado actual, no cuando llego a el. Se toma el asiento MAS RECIENTE porque
   * una solicitud puede pasar por ACEPTADA mas de una vez.
   */
  async aceptadaAt(idSolicitud: number): Promise<Date | null> {
    const fila = await this.db('historial_solicitud')
      .where({ id_solicitud: idSolicitud, estado_nuevo: 'ACEPTADA' })
      .orderBy('fecha_cambio', 'desc')
      .first('fecha_cambio');

    return fila === undefined ? null : (fila.fecha_cambio as Date);
  }

  async listarDeUsuario(
    idUsuario: number,
    pagina: number,
    tamano: number
  ): Promise<Pagina<Solicitud>> {
    return this.paginar((q) => q.where({ id_usuario: idUsuario }), pagina, tamano);
  }

  async listarDePrestador(
    idPrestador: number,
    pagina: number,
    tamano: number
  ): Promise<Pagina<Solicitud>> {
    return this.paginar((q) => q.where({ id_prestador: idPrestador }), pagina, tamano);
  }

  private async paginar(
    filtrar: (q: Knex.QueryBuilder) => Knex.QueryBuilder,
    pagina: number,
    tamano: number
  ): Promise<Pagina<Solicitud>> {
    const base = (): Knex.QueryBuilder =>
      filtrar(this.db('solicitud_servicio')).whereNull('deleted_at');

    const conteo = (await base().count({ total: '*' })) as unknown as { total: number }[];

    const filas = (await base()
      .select(...COLUMNAS)
      .orderBy('fecha_solicitud', 'desc')
      .limit(tamano)
      .offset((pagina - 1) * tamano)) as unknown as FilaSolicitud[];

    return {
      elementos: filas.map((f) => this.aDominio(f)),
      total: Number(conteo[0]?.total ?? 0),
      pagina,
      tamano,
    };
  }

  private aDominio(fila: FilaSolicitud): Solicitud {
    return Solicitud.rehydrate({
      id: Number(fila.id_solicitud),
      estado: fila.estado as EstadoSolicitud,
      origen: fila.origen as OrigenSolicitud,
      descripcionProblema: fila.descripcion_problema,
      idUsuario: Number(fila.id_usuario),
      idPrestador: Number(fila.id_prestador),
      idServicio: fila.id_servicio === null ? null : Number(fila.id_servicio),
      idNecesidad: fila.id_necesidad === null ? null : Number(fila.id_necesidad),
      idPropuesta: fila.id_propuesta === null ? null : Number(fila.id_propuesta),
      valorAcordado: fila.valor_acordado === null ? null : String(fila.valor_acordado),
      plazoAcordado: fila.plazo_acordado === null ? null : Number(fila.plazo_acordado),
      fechaSolicitud: fila.fecha_solicitud,
    });
  }
}
