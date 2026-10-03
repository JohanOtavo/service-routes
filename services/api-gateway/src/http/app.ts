import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { AppError, ErrorCode, toErrorResponse } from '@punto-amigo/shared';
import { esPublica, resolverRuta } from '../config/routes';
import { limpiarCabecerasDeCliente, reenviar } from '../proxy/forward';
import type { CircuitBreaker } from '../proxy/CircuitBreaker';
import type { TokenVerifier } from '../security/TokenVerifier';
import type {} from './expresion';

export interface Logger {
  info(mensaje: string, contexto?: Record<string, unknown>): void;
  error(mensaje: string, contexto?: Record<string, unknown>): void;
}

export interface GatewayDeps {
  verifier: TokenVerifier;
  breaker: CircuitBreaker;
  logger: Logger;
  upstreams: Record<string, string>;
  config: {
    corsOrigin: string;
    bodyLimit: string;
    isProduction: boolean;
    secretoInterno: string;
    timeoutMs: number;
    rateLimit: { windowMs: number; maxPerIp: number; maxPerUser: number; authMax: number };
  };
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function createGateway(deps: GatewayDeps): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
      },
      hsts: deps.config.isProduction
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
      referrerPolicy: { policy: 'no-referrer' },
    })
  );

  /**
   * Primer middleware de todos: borrar las cabeceras internas que traiga el
   * cliente.
   *
   * Va antes que nada porque los servicios confian en `x-internal-user-id` por
   * el mero hecho de recibirla. Si una peticion externa pudiera colarla,
   * cualquiera se haria pasar por administrador sin token (SRS-GW-04, RNF23).
   */
  app.use((req: Request, _res: Response, next: NextFunction) => {
    limpiarCabecerasDeCliente(req);
    next();
  });

  // En produccion se rechaza el trafico sin cifrar (SRS-GW-07). Se consulta la
  // cabecera del terminador TLS, que es quien lo sabe.
  if (deps.config.isProduction) {
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.header('x-forwarded-proto') === 'http') {
        res.status(426).json({ code: 'UPGRADE_REQUIRED', message: 'Use HTTPS.' });
        return;
      }
      next();
    });
  }

  app.use((req: Request, res: Response, next: NextFunction) => {
    const entrante = req.header('x-correlation-id');
    req.correlationId = entrante !== undefined && UUID_V4.test(entrante) ? entrante : randomUUID();
    res.setHeader('x-correlation-id', req.correlationId);
    next();
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origen = req.header('origin');
    if (origen === deps.config.corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origen);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Correlation-Id, Idempotency-Key'
      );
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  /**
   * El cuerpo se recoge como Buffer sin interpretar.
   *
   * El gateway no necesita entender el JSON que transporta, y no analizarlo
   * evita dos problemas: gastar CPU en algo que el destino repetira, y
   * reserializar de forma distinta a como llego.
   */
  app.use(express.raw({ type: () => true, limit: deps.config.bodyLimit }));

  const limitePorIp = rateLimit({
    windowMs: deps.config.rateLimit.windowMs,
    limit: deps.config.rateLimit.maxPerIp,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(AppError.rateLimited()),
  });

  /**
   * Limite por usuario, ademas del que hay por direccion (SRS-GW-06).
   *
   * Son dos ataques distintos: el limite por IP frena a un solo origen, y el de
   * usuario frena a una misma cuenta que llegue desde muchas direcciones. Quien
   * no esta autenticado cae solo bajo el primero.
   */
  const limitePorUsuario = rateLimit({
    windowMs: deps.config.rateLimit.windowMs,
    limit: deps.config.rateLimit.maxPerUser,
    standardHeaders: false,
    legacyHeaders: false,
    keyGenerator: (req: Request) => req.identidad?.userId ?? `anon:${req.ip}`,
    skip: (req: Request) => req.identidad === undefined,
    handler: (_req, _res, next) => next(AppError.rateLimited()),
  });

  const limiteAuth = rateLimit({
    windowMs: deps.config.rateLimit.windowMs,
    limit: deps.config.rateLimit.authMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(AppError.rateLimited()),
  });

  app.use(limitePorIp);

  /** Estado agregado de los servicios que enruta (SRS-GW-08). */
  app.get('/health', async (_req: Request, res: Response) => {
    const entradas = Object.entries(deps.upstreams);

    const resultados = await Promise.all(
      entradas.map(async ([servicio, baseUrl]) => {
        if (!deps.breaker.permite(servicio)) return [servicio, 'circuito-abierto'] as const;
        try {
          const abort = new AbortController();
          const t = setTimeout(() => abort.abort(), 2000);
          const r = await fetch(`${baseUrl}/health`, { signal: abort.signal });
          clearTimeout(t);
          return [servicio, r.ok ? 'up' : 'degraded'] as const;
        } catch {
          return [servicio, 'down'] as const;
        }
      })
    );

    const servicios = Object.fromEntries(resultados);
    const todosArriba = resultados.every(([, estado]) => estado === 'up');

    res.status(todosArriba ? 200 : 503).json({
      status: todosArriba ? 'ok' : 'degraded',
      servicios,
      circuitos: deps.breaker.resumen(),
    });
  });

  // Todo lo demas se enruta segun la tabla.
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ruta = resolverRuta(req.path);
      if (ruta === null) {
        throw AppError.notFound('No existe esa ruta.');
      }

      const baseUrl = deps.upstreams[ruta.servicio];
      if (baseUrl === undefined) {
        throw AppError.upstreamUnavailable(ruta.servicio);
      }

      // Denegacion por defecto: solo pasa sin token lo que la tabla declara
      // publico de forma explicita (SRS-GW-03).
      const publica = esPublica(ruta, req.method, req.path);
      const identidad = publica ? null : await deps.verifier.verificar(req.header('authorization'));

      if (identidad !== null) req.identidad = identidad;

      const aplicarLimites = (): Promise<void> =>
        new Promise((resolve, reject) => {
          const siguiente = (error?: unknown): void =>
            error === undefined ? resolve() : reject(error);
          if (req.path.startsWith('/api/v1/auth')) {
            limiteAuth(req, res, (e?: unknown) =>
              e === undefined ? limitePorUsuario(req, res, siguiente) : siguiente(e)
            );
          } else {
            limitePorUsuario(req, res, siguiente);
          }
        });

      await aplicarLimites();

      await reenviar(req, res, { servicio: ruta.servicio, baseUrl }, identidad, {
        breaker: deps.breaker,
        secretoInterno: deps.config.secretoInterno,
        timeoutMs: deps.config.timeoutMs,
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    const appError = error instanceof AppError ? error : AppError.internal(error);

    if (appError.code === ErrorCode.INTERNAL) {
      deps.logger.error('error no controlado en el gateway', {
        correlationId: req.correlationId,
        path: req.path,
        stack: error instanceof Error ? error.stack : String(error),
      });
    }

    if (appError.code === ErrorCode.UPSTREAM_UNAVAILABLE) {
      deps.logger.error('servicio no disponible', {
        correlationId: req.correlationId,
        path: req.path,
        ...appError.context,
      });
      // Indica al cliente cuando reintentar en lugar de dejarlo adivinar.
      res.setHeader('Retry-After', '15');
    }

    res.status(appError.httpStatus).json(toErrorResponse(appError, req.correlationId));
  });

  return app;
}
