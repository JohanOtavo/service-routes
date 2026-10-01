import type { Knex } from 'knex';
import { currentDb } from '@punto-amigo/service-kit';
import type {
  ActividadDiaria,
  AsientoAuditoria,
  AsientoRegistrado,
  CampoOrdenAuditoria,
  FiltroAuditoria,
  IAuditRepository,
  Pagina,
  ResultadoAuditoria,
  ResumenAccion,
  SentidoOrden,
} from '../../domain';

/**
 * Bitacora de auditoria (SRS RF101 a RF103).
 *
 * Solo inserta y lee. No hay `update` ni `delete`, ni aqui ni en el puerto: una
 * bitacora corregible no prueba nada, y la base lo refuerza con disparadores.
 * Que el programa tampoco pueda intentarlo evita descubrirlo como un error 500.
 */
export class KnexAuditRepository implements IAuditRepository {
  constructor(private readonly knex: Knex) {}

  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  async registrar(asiento: AsientoAuditoria): Promise<void> {
    await this.db('audit_record').insert({
      ocurrido_at: asiento.ocurridoAt,
      id_actor: asiento.idActor,
      actor_rol: asiento.actorRol,
      accion: asiento.accion,
      recurso_tipo: asiento.recursoTipo,
      recurso_id: asiento.recursoId,
      resultado: asiento.resultado,
      correlation_id: asiento.correlationId,
      // El detalle ya viene depurado por el dominio: aqui no se vuelve a mirar,
      // porque dos sitios que depuran acaban depurando distinto.
      detalle: asiento.detalle === null ? null : JSON.stringify(asiento.detalle),
      ip_origen: asiento.ipOrigen,
    });
  }

  /**
   * Aplica los filtros. Todos van parametrizados por el constructor de Knex.
   *
   * `accion` y `recursoTipo` se comparan por igualdad exacta y no con LIKE: son
   * vocabularios cerrados que escriben los propios servicios, asi que una
   * busqueda parcial solo invitaria a recorrer la tabla entera.
   */
  private filtrar(q: Knex.QueryBuilder, f: FiltroAuditoria): Knex.QueryBuilder {
    let c = q;
    if (f.desde !== undefined) c = c.where('ocurrido_at', '>=', f.desde);
    if (f.hasta !== undefined) c = c.where('ocurrido_at', '<=', f.hasta);
    if (f.idActor !== undefined) c = c.where({ id_actor: f.idActor });
    if (f.accion !== undefined) c = c.where({ accion: f.accion });
    if (f.recursoTipo !== undefined) c = c.where({ recurso_tipo: f.recursoTipo });
    if (f.recursoId !== undefined) c = c.where({ recurso_id: f.recursoId });
    if (f.resultado !== undefined) c = c.where({ resultado: f.resultado });
    if (f.correlationId !== undefined) c = c.where({ correlation_id: f.correlationId });
    return c;
  }

  async consultar(
    filtros: FiltroAuditoria,
    orden: { campo: CampoOrdenAuditoria; sentido: SentidoOrden },
    pagina: number,
    tamano: number
  ): Promise<Pagina<AsientoRegistrado>> {
    const conteo = (await this.filtrar(this.db('audit_record'), filtros).count({
      total: '*',
    })) as unknown as { total: number }[];

    const filas = (await this.filtrar(this.db('audit_record'), filtros)
      // `orden.campo` viene de la lista blanca del dominio. ORDER BY no admite
      // parametros, asi que esa validacion es lo unico que hay entre el filtro
      // y una inyeccion; pasarlo tal cual desde la peticion seria el agujero.
      .orderBy(orden.campo, orden.sentido)
      // Desempate estable: sin el, dos asientos del mismo instante pueden
      // cambiar de pagina entre consultas y uno se repetiria mientras otro se
      // pierde.
      .orderBy('id_auditoria', 'desc')
      .limit(tamano)
      .offset((pagina - 1) * tamano)) as unknown as Record<string, unknown>[];

    return {
      elementos: filas.map((f) => this.aDominio(f)),
      total: Number(conteo[0]?.total ?? 0),
      pagina,
      tamano,
    };
  }

  async resumirPorAccion(
    filtros: Pick<FiltroAuditoria, 'desde' | 'hasta'>,
    limite: number
  ): Promise<readonly ResumenAccion[]> {
    const filas = (await this.filtrar(this.db('audit_record'), filtros)
      .select('accion', 'resultado')
      .count({ total: '*' })
      .groupBy('accion', 'resultado')
      .orderBy('total', 'desc')
      .limit(limite)) as unknown as Record<string, unknown>[];

    return filas.map((f) => ({
      accion: String(f['accion']),
      resultado: String(f['resultado']) as ResultadoAuditoria,
      total: Number(f['total']),
    }));
  }

  /**
   * Serie diaria.
   *
   * La fecha se agrupa con DATE() sobre `ocurrido_at`. La conexion fija la zona
   * en UTC, asi que el corte del dia es el mismo para todos: con la zona del
   * servidor, dos replicas en husos distintos dibujarian series diferentes a
   * partir de los mismos datos.
   */
  async resumirPorDia(
    filtros: Pick<FiltroAuditoria, 'desde' | 'hasta'>,
    limite: number
  ): Promise<readonly ActividadDiaria[]> {
    const filas = (await this.filtrar(this.db('audit_record'), filtros)
      .select(this.db.raw('DATE(ocurrido_at) as fecha'))
      .count({ total: '*' })
      .groupByRaw('DATE(ocurrido_at)')
      .orderByRaw('DATE(ocurrido_at) desc')
      .limit(limite)) as unknown as Record<string, unknown>[];

    return filas.map((f) => ({
      fecha: this.aFechaISO(f['fecha']),
      total: Number(f['total']),
    }));
  }

  async contar(filtros: Pick<FiltroAuditoria, 'desde' | 'hasta'>): Promise<number> {
    const filas = (await this.filtrar(this.db('audit_record'), filtros).count({
      total: '*',
    })) as unknown as { total: number }[];

    return Number(filas[0]?.total ?? 0);
  }

  private aFechaISO(valor: unknown): string {
    // MySQL devuelve DATE como objeto Date o como cadena segun el driver.
    if (valor instanceof Date) return valor.toISOString().slice(0, 10);
    return String(valor).slice(0, 10);
  }

  private aDominio(f: Record<string, unknown>): AsientoRegistrado {
    const detalle = f['detalle'];

    return {
      id: Number(f['id_auditoria']),
      ocurridoAt: f['ocurrido_at'] as Date,
      registradoAt: f['registrado_at'] as Date,
      idActor: f['id_actor'] === null ? null : Number(f['id_actor']),
      actorRol: f['actor_rol'] === null ? null : String(f['actor_rol']),
      accion: String(f['accion']),
      recursoTipo: String(f['recurso_tipo']),
      recursoId: f['recurso_id'] === null ? null : String(f['recurso_id']),
      resultado: String(f['resultado']) as ResultadoAuditoria,
      correlationId: f['correlation_id'] === null ? null : String(f['correlation_id']),
      // Segun el driver y la version, una columna JSON llega ya analizada o
      // como texto. Se admiten las dos en vez de confiar en una.
      detalle:
        detalle === null || detalle === undefined
          ? null
          : typeof detalle === 'string'
            ? (JSON.parse(detalle) as Record<string, never>)
            : (detalle as Record<string, never>),
      ipOrigen: f['ip_origen'] === null ? null : String(f['ip_origen']),
    };
  }
}
