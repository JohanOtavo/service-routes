import type { Knex } from 'knex';
import { currentDb } from '@punto-amigo/service-kit';
import type {
  ConteoAgrupado,
  EstadoRespaldo,
  IBackupRepository,
  IParameterRepository,
  IStatisticsRepository,
  IStatisticsSourceRepository,
  Pagina,
  ParametroSistema,
  PuntoCalculado,
  PuntoSerie,
  TipoParametro,
} from '../../domain';

export class KnexParameterRepository implements IParameterRepository {
  constructor(private readonly knex: Knex) {}

  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  async listar(pagina: number, tamano: number): Promise<Pagina<ParametroSistema>> {
    const conteo = (await this.db('system_parameter').count({ total: '*' })) as unknown as {
      total: number;
    }[];

    const filas = (await this.db('system_parameter')
      .select('*')
      .orderBy('clave', 'asc')
      .limit(tamano)
      .offset((pagina - 1) * tamano)) as unknown as Record<string, unknown>[];

    return {
      elementos: filas.map((f) => this.aDominio(f)),
      total: Number(conteo[0]?.total ?? 0),
      pagina,
      tamano,
    };
  }

  async buscar(clave: string): Promise<ParametroSistema | null> {
    const fila = await this.db('system_parameter').where({ clave }).first();
    return fila === undefined ? null : this.aDominio(fila as Record<string, unknown>);
  }

  /**
   * Upsert, no update.
   *
   * La migracion no siembra ninguna fila, asi que si solo se pudiera actualizar
   * lo existente la tabla quedaria vacia para siempre y RF105 no se cumpliria
   * por ninguna via.
   */
  async guardar(
    parametro: Pick<ParametroSistema, 'clave' | 'valor' | 'descripcion' | 'tipoDato'>,
    idAdministrador: number
  ): Promise<ParametroSistema> {
    await this.db('system_parameter')
      .insert({
        clave: parametro.clave,
        valor: parametro.valor,
        descripcion: parametro.descripcion,
        tipo_dato: parametro.tipoDato,
        created_by: idAdministrador,
      })
      // `created_by` NO se actualiza: dice quien lo dio de alta, y reescribirlo
      // en cada cambio borraria ese dato. Quien hizo el ultimo cambio queda en
      // la bitacora de auditoria, que es donde se rinden cuentas.
      .onConflict('clave')
      .merge(['valor', 'descripcion', 'tipo_dato']);

    const guardado = await this.buscar(parametro.clave);
    if (guardado === null) throw new Error('El parametro recien escrito no se pudo leer.');
    return guardado;
  }

  private aDominio(f: Record<string, unknown>): ParametroSistema {
    return {
      clave: String(f['clave']),
      valor: String(f['valor']),
      descripcion: f['descripcion'] === null ? null : String(f['descripcion']),
      tipoDato: String(f['tipo_dato']) as TipoParametro,
      actualizadoAt: (f['updated_at'] ?? null) as Date | null,
      creadoPor: f['created_by'] === null ? null : Number(f['created_by']),
    };
  }
}

/** Series precalculadas (SRS RF113). Este servicio las lee, no las calcula. */
export class KnexStatisticsRepository implements IStatisticsRepository {
  constructor(private readonly knex: Knex) {}

  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  async serie(
    consulta: {
      metrica: string;
      dimension?: string | undefined;
      desde?: Date | undefined;
      hasta?: Date | undefined;
    },
    pagina: number,
    tamano: number
  ): Promise<Pagina<PuntoSerie>> {
    const filtrar = (q: Knex.QueryBuilder): Knex.QueryBuilder => {
      let c = q.where({ metrica: consulta.metrica });
      if (consulta.dimension !== undefined) c = c.where({ dimension: consulta.dimension });
      if (consulta.desde !== undefined) c = c.where('fecha', '>=', consulta.desde);
      if (consulta.hasta !== undefined) c = c.where('fecha', '<=', consulta.hasta);
      return c;
    };

    const conteo = (await filtrar(this.db('statistics_snapshot')).count({
      total: '*',
    })) as unknown as { total: number }[];

    const filas = (await filtrar(this.db('statistics_snapshot'))
      .select('fecha', 'metrica', 'dimension', 'valor')
      .orderBy('fecha', 'desc')
      .limit(tamano)
      .offset((pagina - 1) * tamano)) as unknown as Record<string, unknown>[];

    return {
      elementos: filas.map((f) => ({
        fecha:
          f['fecha'] instanceof Date ? f['fecha'].toISOString().slice(0, 10) : String(f['fecha']),
        metrica: String(f['metrica']),
        dimension: String(f['dimension']),
        valor: Number(f['valor']),
      })),
      total: Number(conteo[0]?.total ?? 0),
      pagina,
      tamano,
    };
  }

  /** Sin esto, el administrador tendria que adivinar los nombres de metrica. */
  async metricas(): Promise<readonly string[]> {
    const filas = (await this.db('statistics_snapshot')
      .distinct('metrica')
      .orderBy('metrica', 'asc')) as unknown as { metrica: string }[];

    return filas.map((f) => String(f.metrica));
  }

  /**
   * Escribe los puntos recalculados, sustituyendo los del mismo dia.
   *
   * Un solo INSERT con todas las filas y no uno por punto: son decenas por
   * ejecucion, y la clave unica `uq_snapshot_punto (fecha, metrica, dimension)`
   * resuelve el choque en el motor. `calculado_at` se refresca para que se
   * pueda ver cuando se calculo por ultima vez, que es distinto del dia que
   * describe la fila.
   */
  async registrar(puntos: readonly PuntoCalculado[]): Promise<number> {
    if (puntos.length === 0) return 0;

    await this.db('statistics_snapshot')
      .insert(
        puntos.map((p) => ({
          fecha: p.fecha,
          metrica: p.metrica,
          dimension: p.dimension,
          valor: p.valor,
          calculado_at: new Date(),
        }))
      )
      .onConflict(['fecha', 'metrica', 'dimension'])
      .merge(['valor', 'calculado_at']);

    /**
     * Se devuelve la longitud de la entrada, no las filas afectadas.
     *
     * En MySQL, ON DUPLICATE KEY UPDATE cuenta 1 por alta y 2 por
     * actualizacion, y 0 cuando el valor no cambia. Ese numero no es "cuantos
     * puntos se escribieron" y leerlo como tal daria cifras absurdas en el log.
     */
    return puntos.length;
  }
}

/**
 * Agregados sobre las tablas de origen de `pa_admin`.
 *
 * Solo dos consultas porque solo hay dos tablas con volumen propio en este
 * esquema. Las dos agrupan por `DATE(...)` en el motor en lugar de traerse las
 * filas y contarlas en memoria: la auditoria es la tabla que mas crece del
 * proyecto, y cada agregado esta cubierto por su indice —`idx_auditoria_fecha`
 * y `idx_moderacion_fecha`—.
 */
export class KnexStatisticsSourceRepository implements IStatisticsSourceRepository {
  constructor(private readonly knex: Knex) {}

  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  async conteoAuditoriaPorDiaYResultado(desde: Date, hasta: Date): Promise<ConteoAgrupado[]> {
    return this.agrupar('audit_record', 'ocurrido_at', 'resultado', desde, hasta);
  }

  async conteoModeracionPorDiaYTipo(desde: Date, hasta: Date): Promise<ConteoAgrupado[]> {
    return this.agrupar('content_moderation', 'moderado_at', 'recurso_tipo', desde, hasta);
  }

  /**
   * `COUNT(*)` por dia y por una columna, dentro de un rango.
   *
   * El orden por fecha ascendente no es cosmetico: el caso de uso construye el
   * punto `TOTAL` de cada dia agrupando en el orden en que llegan las filas, y
   * una serie que saliera desordenada se escribiria igual pero se leeria peor
   * en cualquier registro de diagnostico.
   */
  private async agrupar(
    tabla: string,
    columnaFecha: string,
    columnaDimension: string,
    desde: Date,
    hasta: Date
  ): Promise<ConteoAgrupado[]> {
    const filas = (await this.db(tabla)
      .select(
        this.knex.raw('DATE(??) as fecha', [columnaFecha]),
        this.knex.raw('?? as dimension', [columnaDimension])
      )
      .count<{ valor: number }[]>({ valor: '*' })
      .whereBetween(columnaFecha, [desde, hasta])
      .groupByRaw('DATE(??), ??', [columnaFecha, columnaDimension])
      .orderByRaw('DATE(??) asc', [columnaFecha])) as unknown as Record<string, unknown>[];

    return filas.map((f) => ({
      // MySQL devuelve DATE como Date con la conexion en UTC; se recorta a
      // `YYYY-MM-DD` porque es lo que espera la columna de destino.
      fecha:
        f['fecha'] instanceof Date
          ? f['fecha'].toISOString().slice(0, 10)
          : String(f['fecha']).slice(0, 10),
      dimension: String(f['dimension']),
      valor: Number(f['valor']),
    }));
  }
}

/** Estado de los respaldos (SRS RF106, RF107). Solo lectura desde el API. */
export class KnexBackupRepository implements IBackupRepository {
  constructor(private readonly knex: Knex) {}

  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  async listar(
    filtros: { esquema?: string | undefined; desde?: Date | undefined; hasta?: Date | undefined },
    pagina: number,
    tamano: number
  ): Promise<Pagina<EstadoRespaldo>> {
    const filtrar = (q: Knex.QueryBuilder): Knex.QueryBuilder => {
      let c = q;
      if (filtros.esquema !== undefined) c = c.where({ esquema: filtros.esquema });
      if (filtros.desde !== undefined) c = c.where('iniciado_at', '>=', filtros.desde);
      if (filtros.hasta !== undefined) c = c.where('iniciado_at', '<=', filtros.hasta);
      return c;
    };

    const conteo = (await filtrar(this.db('backup_record')).count({ total: '*' })) as unknown as {
      total: number;
    }[];

    const filas = (await filtrar(this.db('backup_record'))
      .select('*')
      .orderBy('iniciado_at', 'desc')
      .limit(tamano)
      .offset((pagina - 1) * tamano)) as unknown as Record<string, unknown>[];

    return {
      elementos: filas.map((f) => ({
        id: Number(f['id_respaldo']),
        esquema: String(f['esquema']),
        iniciadoAt: f['iniciado_at'] as Date,
        finalizadoAt: (f['finalizado_at'] ?? null) as Date | null,
        exitoso: f['exitoso'] === null ? null : Boolean(f['exitoso']),
        tamanoBytes: f['tamano_bytes'] === null ? null : Number(f['tamano_bytes']),
        ubicacion: f['ubicacion'] === null ? null : String(f['ubicacion']),
        // El mensaje de error del respaldo puede traer rutas del servidor; se
        // devuelve porque solo lo ve un administrador y sin el no se puede
        // diagnosticar por que fallo.
        error: f['error'] === null ? null : String(f['error']),
        restauracionProbadaAt: (f['restauracion_probada_at'] ?? null) as Date | null,
      })),
      total: Number(conteo[0]?.total ?? 0),
      pagina,
      tamano,
    };
  }
}
