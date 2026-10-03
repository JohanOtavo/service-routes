import type { Knex } from 'knex';
import { currentDb } from '@punto-amigo/service-kit';
import type {
  EstadoRespaldo,
  IBackupRepository,
  IParameterRepository,
  IStatisticsRepository,
  Pagina,
  ParametroSistema,
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
