import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Knex } from 'knex';
import { AppError } from '@punto-amigo/shared';
import {
  correlationId,
  errorHandler,
  idDeRuta,
  notFoundHandler,
  requireGatewayIdentity,
  requireInternalCaller,
  runInTransaction,
  validateQuery,
  type Logger,
} from '@punto-amigo/service-kit';
import { ESTADOS_NOTIFICACION, TAMANO_PAGINA_MAXIMO, type EstadoNotificacion } from '../../domain';
import type { ManageInboxUseCase } from '../../application/use-cases/ManageInbox';

export interface AppDeps {
  knex: Knex;
  bandeja: ManageInboxUseCase;
  logger: Logger;
  config: {
    corsOrigin: string;
    bodyLimit: string;
    isProduction: boolean;
    internalSecret: string;
    rateLimit: { windowMs: number; maxPerIp: number };
  };
}

const bandejaSchema = z
  .object({
    estado: z.enum(ESTADOS_NOTIFICACION).optional(),
    pagina: z.coerce.number().int().min(1).max(10_000).optional(),
    tamano: z.coerce.number().int().min(1).max(TAMANO_PAGINA_MAXIMO).optional(),
  })
  .strict();

export function createApp(deps: AppDeps): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      hsts: deps.config.isProduction
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
      referrerPolicy: { policy: 'no-referrer' },
    })
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    const origen = req.header('origin');
    if (origen === deps.config.corsOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origen);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Correlation-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(express.json({ limit: deps.config.bodyLimit }));
  app.use(correlationId);
  app.use(requireInternalCaller(deps.config.internalSecret));
  app.use(
    rateLimit({
      windowMs: deps.config.rateLimit.windowMs,
      limit: deps.config.rateLimit.maxPerIp,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, _res, next) => next(AppError.rateLimited()),
    })
  );

  const autenticado = requireGatewayIdentity();

  const ruta =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction): void => {
      fn(req, res).catch(next);
    };

  app.get('/health', async (_req: Request, res: Response) => {
    try {
      await deps.knex.raw('SELECT 1');
      res.json({ status: 'ok', database: 'up' });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'down' });
    }
  });

  /**
   * NINGUNA ruta lleva el identificador del destinatario.
   *
   * Siempre sale del token. Si existiera `/notifications/users/:id`, alguien
   * acabaria llamandola con el identificador de otro, y el unico muro seria un
   * `if` que hay que recordar escribir en cada ruta nueva. Sin esa ruta, el
   * error no se puede cometer.
   */
  app.get(
    '/api/v1/notifications',
    autenticado,
    validateQuery(bandejaSchema),
    ruta(async (req, res) => {
      res.json(
        await deps.bandeja.listar({
          idUsuario: req.auth!.userId,
          estado: req.query['estado'] as EstadoNotificacion | undefined,
          pagina: req.query['pagina'] as number | undefined,
          tamano: req.query['tamano'] as number | undefined,
        })
      );
    })
  );

  /** Contador para el distintivo de la interfaz: va antes que `/:id`. */
  app.get(
    '/api/v1/notifications/unread-count',
    autenticado,
    ruta(async (req, res) => {
      res.json(await deps.bandeja.contarNoLeidas(req.auth!.userId));
    })
  );

  app.post(
    '/api/v1/notifications/read-all',
    autenticado,
    ruta(async (req, res) => {
      const salida = await runInTransaction(deps.knex, () =>
        deps.bandeja.marcarTodasLeidas(req.auth!.userId)
      );
      res.json(salida);
    })
  );

  /** Marcar una como leida. Marcar la de otro devuelve 404, nunca 403. */
  app.post(
    '/api/v1/notifications/:id/read',
    autenticado,
    ruta(async (req, res) => {
      await runInTransaction(deps.knex, () =>
        deps.bandeja.marcarLeida({
          idNotificacion: idDeRuta(req),
          idUsuario: req.auth!.userId,
        })
      );
      res.status(204).send();
    })
  );

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger, !deps.config.isProduction));

  return app;
}
