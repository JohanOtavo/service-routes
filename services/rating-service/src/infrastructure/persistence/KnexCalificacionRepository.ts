import type { Knex } from 'knex';
import { AppError } from '@punto-amigo/shared';
import { currentDb } from '@punto-amigo/service-kit';
import {
  Calificacion,
  direccionQueEvalua,
  type AgregadoPuntuaciones,
  type Direccion,
  type Faceta,
  type ICalificacionRepository,
  type Pagina,
} from '../../domain';

interface FilaCalificacion {
  id_calificacion: number;
  id_solicitud: number;
  direccion: string;
  id_emisor: number;
  id_receptor: number;
  id_servicio: number | null;
  puntuacion: number;
  comentario: string | null;
  visible_at: Date | null;
  oculta_por_moderacion: number | boolean;
  fecha: Date;
}

const COLUMNAS = [
  'id_calificacion',
  'id_solicitud',
  'direccion',
  'id_emisor',
  'id_receptor',
  'id_servicio',
  'puntuacion',
  'comentario',
  'visible_at',
  'oculta_por_moderacion',
  'fecha',
] as const;

/** Codigo de MySQL para violacion de clave unica. */
const ER_DUP_ENTRY = 1062;

export class KnexCalificacionRepository implements ICalificacionRepository {
  constructor(private readonly knex: Knex) {}

  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  /**
   * Publica = revelada Y no retirada por moderacion.
   *
   * Vive aqui, en SQL, ademas de en el dominio. No es duplicacion ociosa: el
   * dominio protege el objeto y esto protege la CONSULTA. Filtrar en memoria
   * obligaria a traer todas las ocultas para descartarlas, y la paginacion
   * devolveria paginas a medio llenar.
   */
  private soloPublicas(q: Knex.QueryBuilder): Knex.QueryBuilder {
    return q.whereNotNull('visible_at').where('oculta_por_moderacion', false);
  }

  async findById(id: number): Promise<Calificacion | null> {
    const fila = await this.db<FilaCalificacion>('calificacion')
      .select(...COLUMNAS)
      .where({ id_calificacion: id })
      .first();

    return fila === undefined ? null : this.aDominio(fila);
  }

  async findPorSolicitudYDireccion(
    idSolicitud: number,
    direccion: Direccion
  ): Promise<Calificacion | null> {
    const fila = await this.db<FilaCalificacion>('calificacion')
      .select(...COLUMNAS)
      .where({ id_solicitud: idSolicitud, direccion })
      .first();

    return fila === undefined ? null : this.aDominio(fila);
  }

  /**
   * El UNIQUE(id_solicitud, direccion) es la garantia real de "una por parte".
   *
   * El caso de uso consulta antes para dar un mensaje que se entienda, pero
   * entre esa consulta y este INSERT cabe otra peticion. Traducir el choque
   * aqui es lo que convierte esa carrera en un conflicto explicado en vez de en
   * un error de motor.
   */
  async save(calificacion: Calificacion, creadoPor: number): Promise<Calificacion> {
    const d = calificacion.toJSON();

    try {
      const [id] = await this.db('calificacion').insert({
        id_solicitud: d['idSolicitud'],
        direccion: d['direccion'],
        // El emisor no sale de toJSON(), que no lo expone: se toma del
        // parametro, que es quien autentico la peticion.
        id_emisor: creadoPor,
        id_receptor: d['idReceptor'],
        id_servicio: d['idServicio'],
        puntuacion: d['puntuacion'],
        comentario: d['comentario'],
        visible_at: calificacion.visibleAt,
        oculta_por_moderacion: false,
        fecha: calificacion.fecha,
        created_by: creadoPor,
      });

      const guardada = await this.findById(Number(id));
      if (guardada === null) throw new Error('La calificacion recien insertada no se pudo leer.');
      return guardada;
    } catch (error) {
      if (this.esDuplicado(error)) {
        throw AppError.conflict('Ya califico esta solicitud. Cada parte califica una sola vez.');
      }
      throw error;
    }
  }

  /**
   * Solo se actualiza lo que el dominio puede cambiar despues del alta:
   * revelarse y retirarse por moderacion.
   *
   * La puntuacion y el comentario quedan fuera del UPDATE a proposito. Una
   * calificacion no se edita: si se pudiera, bastaria esperar a ver la de la
   * contraparte y cambiar la propia, que es justo lo que el periodo ciego
   * existe para impedir.
   */
  async update(calificacion: Calificacion): Promise<void> {
    const afectadas = await this.db('calificacion')
      .where({ id_calificacion: calificacion.id })
      .update({
        visible_at: calificacion.visibleAt,
        oculta_por_moderacion: calificacion.ocultaPorModeracion,
      });

    if (afectadas === 0) {
      throw AppError.conflict('La calificacion cambio o se elimino mientras se actualizaba.');
    }
  }

  async listarPublicasDeReceptor(
    idReceptor: number,
    faceta: Faceta,
    pagina: number,
    tamano: number
  ): Promise<Pagina<Calificacion>> {
    // La faceta se traduce a direccion: una persona se mide como oferente por
    // lo que le dijeron los solicitantes, y al reves.
    return this.paginar(
      (q) =>
        this.soloPublicas(
          q.where({ id_receptor: idReceptor, direccion: direccionQueEvalua(faceta) })
        ),
      pagina,
      tamano
    );
  }

  async listarPublicasDeServicio(
    idServicio: number,
    pagina: number,
    tamano: number
  ): Promise<Pagina<Calificacion>> {
    return this.paginar(
      (q) => this.soloPublicas(q.where({ id_servicio: idServicio })),
      pagina,
      tamano
    );
  }

  /**
   * Suma y conteo de las VISIBLES de una faceta.
   *
   * Solo las visibles: incluir las del periodo ciego revelaria por la puerta de
   * atras lo que RF166 oculta por la de delante. Un promedio que baja de 5 a 3
   * dice, sin nombrarla, que la calificacion pendiente fue mala.
   */
  async agregadoDeReceptor(idReceptor: number, faceta: Faceta): Promise<AgregadoPuntuaciones> {
    return this.agregar((q) =>
      q.where({ id_receptor: idReceptor, direccion: direccionQueEvalua(faceta) })
    );
  }

  async agregadoDeServicio(idServicio: number): Promise<AgregadoPuntuaciones> {
    return this.agregar((q) => q.where({ id_servicio: idServicio }));
  }

  /**
   * Las ocultas cuyo plazo ya vencio.
   *
   * `limite` es el instante antes del cual todo lo registrado ha vencido, y lo
   * calcula el dominio. Va en lotes porque, si el proceso estuvo parado, una
   * consulta sin tope podria traer meses de atraso de golpe.
   */
  async listarVencidas(limite: Date, lote: number): Promise<Calificacion[]> {
    const filas = await this.db<FilaCalificacion>('calificacion')
      .select(...COLUMNAS)
      .whereNull('visible_at')
      .where('fecha', '<=', limite)
      // Las mas antiguas primero: son las que llevan mas tiempo esperando.
      .orderBy('fecha', 'asc')
      .limit(lote);

    return filas.map((f) => this.aDominio(f));
  }

  private async agregar(
    filtrar: (q: Knex.QueryBuilder) => Knex.QueryBuilder
  ): Promise<AgregadoPuntuaciones> {
    const filas = (await this.soloPublicas(filtrar(this.db('calificacion'))).select(
      this.db.raw('COALESCE(SUM(puntuacion), 0) as suma'),
      this.db.raw('COUNT(*) as total')
    )) as unknown as { suma: number | string; total: number | string }[];

    return {
      // SUM devuelve DECIMAL como cadena; sin convertir, la media saldria por
      // concatenacion en vez de por division.
      suma: Number(filas[0]?.suma ?? 0),
      total: Number(filas[0]?.total ?? 0),
    };
  }

  private async paginar(
    filtrar: (q: Knex.QueryBuilder) => Knex.QueryBuilder,
    pagina: number,
    tamano: number
  ): Promise<Pagina<Calificacion>> {
    const conteo = (await filtrar(this.db('calificacion')).count({
      total: '*',
    })) as unknown as { total: number }[];

    const filas = (await filtrar(this.db('calificacion'))
      .select(...COLUMNAS)
      .orderBy('fecha', 'desc')
      .limit(tamano)
      .offset((pagina - 1) * tamano)) as unknown as FilaCalificacion[];

    return {
      elementos: filas.map((f) => this.aDominio(f)),
      total: Number(conteo[0]?.total ?? 0),
      pagina,
      tamano,
    };
  }

  private aDominio(fila: FilaCalificacion): Calificacion {
    return Calificacion.rehydrate({
      id: Number(fila.id_calificacion),
      idSolicitud: Number(fila.id_solicitud),
      direccion: fila.direccion as Direccion,
      idEmisor: Number(fila.id_emisor),
      idReceptor: Number(fila.id_receptor),
      idServicio: fila.id_servicio === null ? null : Number(fila.id_servicio),
      puntuacion: Number(fila.puntuacion),
      comentario: fila.comentario,
      visibleAt: fila.visible_at,
      // MySQL devuelve los booleanos como 0 o 1.
      ocultaPorModeracion: Boolean(fila.oculta_por_moderacion),
      fecha: fila.fecha,
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
