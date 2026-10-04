import type { NextFunction, Request, Response } from 'express';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Registro estructurado en JSON, uno por servicio (SRS RNF77, RNF78; deuda AT-005).
 *
 * Una linea por evento, en JSON y en una sola linea, porque es lo que un
 * recolector puede leer sin un analizador propio. Lo que hace util el registro
 * no es el formato sino el `correlationId`: sin el, una operacion que atraveso
 * el gateway y tres servicios son cuatro lineas que nadie puede juntar.
 *
 * `info` sale por stderr a proposito. `console.log` escribe en stdout, que es
 * donde algunos procesos de este repositorio esperan datos (el `--silent` de
 * los scripts, la salida de `db/cli.js`); mezclar registro y datos en el mismo
 * flujo rompe a quien lo consuma. Todo el registro va a stderr, los datos a
 * stdout.
 */
export interface Logger {
  info(mensaje: string, contexto?: Record<string, unknown>): void;
  error(mensaje: string, contexto?: Record<string, unknown>): void;
}

export function crearLogger(servicio: string): Logger {
  const emitir = (level: string, mensaje: string, contexto: Record<string, unknown>): void => {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level,
        service: servicio,
        mensaje,
        ...contexto,
      })
    );
  };

  return {
    info: (mensaje, contexto = {}) => emitir('info', mensaje, contexto),
    error: (mensaje, contexto = {}) => emitir('error', mensaje, contexto),
  };
}

/**
 * Plantilla de la ruta, no la ruta concreta.
 *
 * Una metrica etiquetada con `/api/v1/providers/4812` crea una serie temporal
 * nueva por cada identificador que exista, y eso tumba a Prometheus (es su
 * fallo clasico, «cardinality explosion»). Express guarda la plantilla en
 * `req.route.path`, que es `/:id`, y el prefijo en `req.baseUrl`.
 *
 * Cuando no hay ruta —un 404, o un error antes del enrutador— se etiqueta como
 * `desconocida` en vez de con lo que pidio el cliente, que es justamente el
 * caso en el que un atacante podria inflar la cardinalidad a voluntad.
 */
function plantilla(req: Request): string {
  const ruta = (req.route as { path?: string } | undefined)?.path;
  if (ruta === undefined) return 'desconocida';
  return `${req.baseUrl}${ruta}` || '/';
}

export interface Metricas {
  /** Mide cada peticion. Se monta antes del enrutador. */
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  /** Handler de `GET /metrics`, en el formato de texto de Prometheus. */
  exponer: (req: Request, res: Response) => Promise<void>;
  registro: Registry;
}

/**
 * Metricas HTTP y del proceso para Prometheus (deuda AT-005, AT-007).
 *
 * El histograma lleva los cortes que exige la estrategia de pruebas: el umbral
 * es P95 < 300 ms, y un histograma solo puede responder por un percentil si
 * tiene un corte cerca. Con los cortes por defecto de prom-client el salto va
 * de 250 ms a 500 ms y el P95 sale interpolado entre los dos, que es precisamente
 * donde esta el umbral.
 *
 * `rutaDe` existe para el gateway. Alli no hay enrutador de Express —todo pasa
 * por un `app.use` que reenvia— asi que `req.route` no existe nunca y TODA
 * peticion proxy quedaria etiquetada como `desconocida`, que es justo donde hay
 * que medir el P95. El gateway pasa su propia funcion, que devuelve el prefijo
 * de la tabla de enrutado: un conjunto cerrado de valores, no lo que pida el
 * cliente.
 *
 * Cada servicio crea su propio `Registry` en vez de usar el global: los tests
 * levantan varias aplicaciones en el mismo proceso y el registro global lanza
 * «A metric with the name ... has already been registered».
 */
export function crearMetricas(
  servicio: string,
  rutaDe: (req: Request) => string = plantilla
): Metricas {
  const registro = new Registry();
  registro.setDefaultLabels({ service: servicio });
  collectDefaultMetrics({ register: registro });

  const duracion = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duracion de las peticiones HTTP en segundos.',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5],
    registers: [registro],
  });

  const errores = new Counter({
    name: 'http_requests_errors_total',
    help: 'Peticiones HTTP respondidas con 5xx.',
    labelNames: ['method', 'route'] as const,
    registers: [registro],
  });

  const middleware = (req: Request, res: Response, next: NextFunction): void => {
    // `finish` y no un envoltorio de `res.end`: se emite una sola vez y despues
    // de que Express haya resuelto la ruta, que es cuando `req.route` existe.
    const fin = duracion.startTimer();
    res.on('finish', () => {
      const etiquetas = { method: req.method, route: rutaDe(req) };
      fin({ ...etiquetas, status: String(res.statusCode) });
      if (res.statusCode >= 500) errores.inc(etiquetas);
    });
    next();
  };

  const exponer = async (_req: Request, res: Response): Promise<void> => {
    res.setHeader('content-type', registro.contentType);
    res.send(await registro.metrics());
  };

  return { middleware, exponer, registro };
}

/**
 * Una linea de registro por peticion servida (deuda AT-005).
 *
 * Lo que hace esto necesario y no redundante con las metricas: una metrica dice
 * que el 2 % de las peticiones a `/:id` fallo, un registro dice QUE peticion
 * fallo y con que identificador de correlacion buscarla en los otros servicios.
 *
 * No registra cuerpos ni cabeceras. El cuerpo de `/auth/login` lleva la
 * contrasena y el de `/auth/refresh` el token: un registro de acceso que los
 * copie convierte el fichero de log en un almacen de credenciales
 * (04-POLITICA-DATOS-PERSONALES.md).
 *
 * `/health` y `/metrics` quedan fuera: los consulta el orquestador cada pocos
 * segundos y ahogarian todo lo demas.
 */
export function accessLog(logger: Logger) {
  const SILENCIOSAS = new Set(['/health', '/metrics']);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (SILENCIOSAS.has(req.path)) {
      next();
      return;
    }

    const inicio = process.hrtime.bigint();
    res.on('finish', () => {
      logger.info('peticion', {
        correlationId: req.correlationId,
        method: req.method,
        path: req.path,
        route: plantilla(req),
        status: res.statusCode,
        ms: Number((process.hrtime.bigint() - inicio) / 1_000_000n),
        usuario: req.auth?.userId,
      });
    });
    next();
  };
}
