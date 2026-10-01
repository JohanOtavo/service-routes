import type { Knex } from 'knex';
import { AppError } from '@punto-amigo/shared';
import { currentDb } from '@punto-amigo/service-kit';
import {
  Propuesta,
  type EstadoPropuesta,
  type IPropuestaRepository,
  type Pagina,
} from '../../domain';

interface FilaPropuesta {
  id_propuesta: number;
  id_necesidad: number;
  id_prestador: number;
  precio: string;
  tiempo_estimado: number;
  mensaje: string;
  id_servicio: number | null;
  estado: string;
}

const COLUMNAS = [
  'id_propuesta',
  'id_necesidad',
  'id_prestador',
  'precio',
  'tiempo_estimado',
  'mensaje',
  'id_servicio',
  'estado',
] as const;

/** Las que todavia pueden decidirse. Una RETIRADA no bloquea enviar otra. */
const VIGENTES = ['ENVIADA'] as const;

export class KnexPropuestaRepository implements IPropuestaRepository {
  constructor(private readonly knex: Knex) {}

  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  async findById(id: number): Promise<Propuesta | null> {
    const fila = await this.db<FilaPropuesta>('propuesta')
      .select(...COLUMNAS)
      .where({ id_propuesta: id })
      .whereNull('deleted_at')
      .first();

    return fila === undefined ? null : this.aDominio(fila);
  }

  /**
   * Todas las de una necesidad, en una sola consulta.
   *
   * La adjudicacion las necesita juntas: acepta una y descarta el resto en la
   * misma transaccion. Traerlas de una en una abriria una ventana en la que
   * otra peticion podria enviar una propuesta nueva que se quedaria sin
   * descartar.
   */
  async findByNecesidad(idNecesidad: number): Promise<Propuesta[]> {
    const filas = await this.db<FilaPropuesta>('propuesta')
      .select(...COLUMNAS)
      .where({ id_necesidad: idNecesidad })
      .whereNull('deleted_at')
      .orderBy('fecha_envio', 'asc');

    return filas.map((f) => this.aDominio(f));
  }

  async save(propuesta: Propuesta, creadoPor: number): Promise<Propuesta> {
    const d = propuesta.toAuthorJSON();

    const [id] = await this.db('propuesta').insert({
      id_necesidad: d['idNecesidad'],
      id_prestador: d['idPrestador'],
      precio: d['precio'],
      tiempo_estimado: d['tiempoEstimado'],
      mensaje: d['mensaje'],
      id_servicio: d['idServicio'],
      estado: d['estado'],
      created_by: creadoPor,
    });

    const guardada = await this.findById(Number(id));
    if (guardada === null) throw new Error('La propuesta recien insertada no se pudo leer.');
    return guardada;
  }

  async update(propuesta: Propuesta): Promise<void> {
    const d = propuesta.toAuthorJSON();

    const afectadas = await this.db('propuesta')
      .where({ id_propuesta: d['id'] })
      .whereNull('deleted_at')
      .update({
        precio: d['precio'],
        tiempo_estimado: d['tiempoEstimado'],
        mensaje: d['mensaje'],
        estado: d['estado'],
      });

    if (afectadas === 0) {
      throw AppError.conflict('La propuesta cambio o se elimino mientras se editaba.');
    }
  }

  async tieneVigente(idNecesidad: number, idPrestador: number): Promise<boolean> {
    const fila = await this.db('propuesta')
      .where({ id_necesidad: idNecesidad, id_prestador: idPrestador })
      .whereIn('estado', VIGENTES as unknown as string[])
      .whereNull('deleted_at')
      .first('id_propuesta');

    return fila !== undefined;
  }

  async listarDePrestador(
    idPrestador: number,
    pagina: number,
    tamano: number
  ): Promise<Pagina<Propuesta>> {
    const filtrar = (q: Knex.QueryBuilder): Knex.QueryBuilder =>
      q.where({ id_prestador: idPrestador }).whereNull('deleted_at');

    const conteo = (await filtrar(this.db('propuesta')).count({ total: '*' })) as unknown as {
      total: number;
    }[];

    const filas = (await filtrar(this.db('propuesta'))
      .select(...COLUMNAS)
      .orderBy('fecha_envio', 'desc')
      .limit(tamano)
      .offset((pagina - 1) * tamano)) as unknown as FilaPropuesta[];

    return {
      elementos: filas.map((f) => this.aDominio(f)),
      total: Number(conteo[0]?.total ?? 0),
      pagina,
      tamano,
    };
  }

  private aDominio(fila: FilaPropuesta): Propuesta {
    return Propuesta.rehydrate({
      id: Number(fila.id_propuesta),
      idNecesidad: Number(fila.id_necesidad),
      idPrestador: Number(fila.id_prestador),
      // DECIMAL como cadena: convertirlo a number perderia precision.
      precio: String(fila.precio),
      tiempoEstimado: Number(fila.tiempo_estimado),
      mensaje: fila.mensaje,
      idServicio: fila.id_servicio === null ? null : Number(fila.id_servicio),
      estado: fila.estado as EstadoPropuesta,
    });
  }
}
