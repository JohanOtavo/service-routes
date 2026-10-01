import {
  exigirRangoValido,
  normalizarPaginacion,
  type AsientoRegistrado,
  type CampoOrdenAuditoria,
  type FiltroAuditoria,
  type IAuditRepository,
  type SentidoOrden,
} from '../../domain';

/**
 * Consulta de la bitacora de auditoria (SRS RF102, SRS-ADM-02).
 *
 * Solo lee. No existe aqui ningun metodo que corrija o borre un asiento, y esa
 * ausencia es el requisito RF103 escrito en codigo: la base lo impide con dos
 * disparadores, pero si la capa de aplicacion ofreciera el camino, el fallo
 * aparecia en produccion como un error 500 en vez de no existir.
 *
 * Quien puede invocarlo lo decide el borde HTTP, que exige el rol
 * ADMINISTRADOR en todas las rutas de este servicio.
 */
export class QueryAuditTrailUseCase {
  constructor(private readonly auditoria: IAuditRepository) {}

  async consultar(entrada: {
    filtros: FiltroAuditoria;
    campoOrden?: CampoOrdenAuditoria | undefined;
    sentidoOrden?: SentidoOrden | undefined;
    pagina?: number | undefined;
    tamano?: number | undefined;
  }): Promise<Record<string, unknown>> {
    exigirRangoValido(entrada.filtros.desde, entrada.filtros.hasta);

    const { pagina, tamano } = normalizarPaginacion(entrada);

    const resultado = await this.auditoria.consultar(
      entrada.filtros,
      {
        campo: entrada.campoOrden ?? 'ocurrido_at',
        // Lo mas reciente primero: quien abre la bitacora casi siempre viene a
        // mirar lo ultimo que paso, no el primer dia de la plataforma.
        sentido: entrada.sentidoOrden ?? 'desc',
      },
      pagina,
      tamano
    );

    return {
      elementos: resultado.elementos.map((a) => vista(a)),
      total: resultado.total,
      pagina: resultado.pagina,
      tamano: resultado.tamano,
    };
  }
}

/**
 * Forma de un asiento para el cliente.
 *
 * Las fechas salen en ISO 8601 con zona, no como objeto Date ni como la cadena
 * que devuelve el motor: la respuesta la lee un navegador en otra zona horaria,
 * y una fecha sin zona se interpreta como local y desplaza la hora del hecho.
 */
function vista(asiento: AsientoRegistrado): Record<string, unknown> {
  return {
    id: asiento.id,
    ocurridoAt: asiento.ocurridoAt.toISOString(),
    registradoAt: asiento.registradoAt.toISOString(),
    idActor: asiento.idActor,
    actorRol: asiento.actorRol,
    accion: asiento.accion,
    recursoTipo: asiento.recursoTipo,
    recursoId: asiento.recursoId,
    resultado: asiento.resultado,
    correlationId: asiento.correlationId,
    detalle: asiento.detalle,
    ipOrigen: asiento.ipOrigen,
  };
}
