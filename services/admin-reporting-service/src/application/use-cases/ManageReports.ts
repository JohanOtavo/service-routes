import { AppError } from '@punto-amigo/shared';
import type { IClock } from '@punto-amigo/service-kit';
import {
  crearAsiento,
  exigirRangoValido,
  normalizarPaginacion,
  normalizarParametro,
  nombreSensible,
  type IAuditRepository,
  type IBackupRepository,
  type IParameterRepository,
  type IStatisticsRepository,
  type InformeActividad,
  type TipoParametro,
} from '../../domain';

/** Tope de filas de un agregado: un informe no es una descarga de la base. */
const MAX_FILAS_AGREGADO = 100;

/**
 * Informes, parametros y estado de respaldos (SRS RF105 a RF115).
 *
 * Todo se consulta sobre tablas de ESTE esquema. No hay un solo JOIN a otro
 * esquema: cada servicio es dueno de sus datos, y cruzar fronteras aqui
 * convertiria un informe en un acoplamiento que se rompe con cada migracion
 * ajena. Lo que falte aqui tiene que llegar por un evento, no por una consulta.
 */
export class ManageReportsUseCase {
  constructor(
    private readonly auditoria: IAuditRepository,
    private readonly parametros: IParameterRepository,
    private readonly estadisticas: IStatisticsRepository,
    private readonly respaldos: IBackupRepository,
    private readonly clock: IClock
  ) {}

  /** Informe consolidado de actividad (SRS RF115). */
  async actividad(entrada: {
    desde?: Date | undefined;
    hasta?: Date | undefined;
  }): Promise<InformeActividad> {
    exigirRangoValido(entrada.desde, entrada.hasta);

    const filtros = { desde: entrada.desde, hasta: entrada.hasta };
    const [totalAsientos, porAccion, porDia] = await Promise.all([
      this.auditoria.contar(filtros),
      this.auditoria.resumirPorAccion(filtros, MAX_FILAS_AGREGADO),
      this.auditoria.resumirPorDia(filtros, MAX_FILAS_AGREGADO),
    ]);

    return {
      desde: entrada.desde?.toISOString() ?? null,
      hasta: entrada.hasta?.toISOString() ?? null,
      totalAsientos,
      porAccion,
      porDia,
    };
  }

  async serie(entrada: {
    metrica: string;
    dimension?: string | undefined;
    desde?: Date | undefined;
    hasta?: Date | undefined;
    pagina?: number | undefined;
    tamano?: number | undefined;
  }): Promise<Record<string, unknown>> {
    exigirRangoValido(entrada.desde, entrada.hasta);
    const { pagina, tamano } = normalizarPaginacion(entrada);

    const resultado = await this.estadisticas.serie(
      {
        metrica: entrada.metrica,
        dimension: entrada.dimension,
        desde: entrada.desde,
        hasta: entrada.hasta,
      },
      pagina,
      tamano
    );

    return { ...resultado, elementos: resultado.elementos };
  }

  async metricas(): Promise<Record<string, unknown>> {
    return { metricas: await this.estadisticas.metricas() };
  }

  async listarParametros(entrada: {
    pagina?: number | undefined;
    tamano?: number | undefined;
  }): Promise<Record<string, unknown>> {
    const { pagina, tamano } = normalizarPaginacion(entrada);
    return { ...(await this.parametros.listar(pagina, tamano)) };
  }

  /**
   * Alta o cambio de un parametro, con su asiento de auditoria (SRS RF105).
   *
   * El asiento se escribe en la MISMA transaccion que el cambio. Si fueran dos,
   * un fallo entre ambas dejaria un parametro cambiado sin rastro de quien lo
   * cambio, que es justo el caso en el que la bitacora tendria que servir.
   *
   * El detalle guarda el valor ANTERIOR y el nuevo. Pasan por el depurador del
   * dominio como todo lo demas: si alguien crea un parametro llamado
   * `SMTP_PASSWORD`, su valor no acabara escrito en una tabla inmutable.
   */
  async guardarParametro(entrada: {
    clave: string;
    valor: string;
    descripcion?: string | null | undefined;
    tipoDato: TipoParametro;
    idAdministrador: number;
    correlationId: string;
    ipOrigen: string | null;
  }): Promise<Record<string, unknown>> {
    const normalizado = normalizarParametro(entrada);
    const anterior = await this.parametros.buscar(normalizado.clave);

    const guardado = await this.parametros.guardar(normalizado, entrada.idAdministrador);

    await this.auditoria.registrar(
      crearAsiento({
        ocurridoAt: this.clock.now(),
        idActor: entrada.idAdministrador,
        actorRol: 'ADMINISTRADOR',
        accion: anterior === null ? 'CREAR_PARAMETRO' : 'CAMBIAR_PARAMETRO',
        recursoTipo: 'ParametroSistema',
        recursoId: normalizado.clave,
        resultado: 'EXITO',
        correlationId: entrada.correlationId,
        /**
         * Si el PARAMETRO suena a secreto, no se guardan sus valores.
         *
         * `depurarDetalle` censura por el nombre de cada campo del detalle, y
         * aqui esos campos se llaman `clave`, `anterior` y `nuevo`: ninguno
         * suena a secreto. El secreto esta en el VALOR, y lo que delata que lo
         * es resulta ser el nombre del parametro. Sin esta comprobacion, crear
         * uno llamado SMTP_PASSWORD escribiria su contrasena en una tabla que
         * por diseno no se puede corregir: el error seria permanente.
         *
         * Se deja constancia de que hubo un cambio, que es lo que la auditoria
         * tiene que demostrar; lo que se pierde es el valor, no el hecho.
         */
        detalle: nombreSensible(normalizado.clave)
          ? { clave: normalizado.clave, valores: '[omitido]', cambio: anterior === null ? 'ALTA' : 'CAMBIO' }
          : { clave: normalizado.clave, anterior: anterior?.valor ?? null, nuevo: normalizado.valor },
        ipOrigen: entrada.ipOrigen,
      })
    );

    return { ...guardado };
  }

  async verParametro(clave: string): Promise<Record<string, unknown>> {
    const parametro = await this.parametros.buscar(clave.trim().toUpperCase());
    if (parametro === null) throw AppError.notFound('El parametro no existe.');
    return { ...parametro };
  }

  async listarRespaldos(entrada: {
    esquema?: string | undefined;
    desde?: Date | undefined;
    hasta?: Date | undefined;
    pagina?: number | undefined;
    tamano?: number | undefined;
  }): Promise<Record<string, unknown>> {
    exigirRangoValido(entrada.desde, entrada.hasta);
    const { pagina, tamano } = normalizarPaginacion(entrada);

    return {
      ...(await this.respaldos.listar(
        { esquema: entrada.esquema, desde: entrada.desde, hasta: entrada.hasta },
        pagina,
        tamano
      )),
    };
  }
}
