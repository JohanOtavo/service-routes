import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Knex } from 'knex';
import { AppError } from '@punto-amigo/shared';
import {
  accessLog,
  claveDeLimite,
  correlationId,
  crearMetricas,
  errorHandler,
  idDeRuta,
  notFoundHandler,
  requireGatewayIdentity,
  requireInternalCaller,
  requireRole,
  runInTransaction,
  type Logger,
  validateBody,
  validateQuery,
} from '@punto-amigo/service-kit';
import {
  COMENTARIO_MAXIMO,
  FACETAS,
  PUNTUACION_MAXIMA,
  PUNTUACION_MINIMA,
  TAMANO_PAGINA_MAXIMO,
  type Faceta,
} from '../../domain';
import type { SubmitRatingUseCase } from '../../application/use-cases/SubmitRating';
import type { QueryReputationUseCase } from '../../application/use-cases/QueryReputation';

export interface AppDeps {
  knex: Knex;
  calificar: SubmitRatingUseCase;
  consultar: QueryReputationUseCase;
  logger: Logger;
  config: {
    corsOrigin: string;
    bodyLimit: string;
    isProduction: boolean;
    internalSecret: string;
    rateLimit: { windowMs: number; maxPerIp: number };
  };
}

const calificacionSchema = z
  .object({
    idSolicitud: z.number().int().positive(),
    puntuacion: z.number().int().min(PUNTUACION_MINIMA).max(PUNTUACION_MAXIMA),
    comentario: z.string().max(COMENTARIO_MAXIMO).nullable().optional(),
  })
  .strict();

const paginaSchema = z
  .object({
    pagina: z.coerce.number().int().min(1).max(10_000).optional(),
    tamano: z.coerce.number().int().min(1).max(TAMANO_PAGINA_MAXIMO).optional(),
  })
  .strict();

const porFacetaSchema = paginaSchema.extend({ faceta: z.enum(FACETAS).optional() });

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
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-Correlation-Id'
      );
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

  /**
   * Observabilidad (deuda AT-005).
   *
   * Las metricas van antes del enrutador para medir TODA peticion,
   * incluidas las que acaban en 404 o en el limitador. El registro de
   * acceso va detras, para que su linea lleve el identificador de
   * correlacion que acaba de asignarse.
   */
  const metricas = crearMetricas('rating-service');
  app.use(metricas.middleware);
  app.use(accessLog(deps.logger));
  app.use(requireInternalCaller(deps.config.internalSecret));
  app.use(
    rateLimit({
      windowMs: deps.config.rateLimit.windowMs,
      limit: deps.config.rateLimit.maxPerIp,
      // Por identidad, no por IP: a este lado todas las peticiones vienen del
      // gateway y un limite por IP seria un techo para todo el sistema (J-1).
      keyGenerator: claveDeLimite,
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

  /**
   * Metricas para Prometheus (deuda AT-005).
   *
   * Sin secreto, igual que `/health`: este puerto no se publica, asi que la
   * ruta solo es alcanzable desde la red interna, que es donde vive Prometheus.
   * El gateway, que si esta publicado, sirve las suyas en otro puerto.
   */
  app.get('/metrics', (req: Request, res: Response) => void metricas.exponer(req, res));

  app.get('/health', async (_req: Request, res: Response) => {
    try {
      await deps.knex.raw('SELECT 1');
      res.json({ status: 'ok', database: 'up' });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'down' });
    }
  });

  /**
   * Registrar una calificacion (SRS RF78 a RF82, RF164).
   *
   * No exige un rol concreto: califican las DOS partes, y quien contrata hoy
   * puede ser quien atiende manana. Quien decide si puede es el dominio, que
   * comprueba que esta persona fue parte de ESA solicitud; un guardia de rol
   * aqui dejaria fuera al oferente calificando al solicitante (RF164).
   */
  app.post(
    '/api/v1/ratings',
    autenticado,
    validateBody(calificacionSchema),
    ruta(async (req, res) => {
      const salida = await runInTransaction(deps.knex, () =>
        deps.calificar.registrar({
          idSolicitud: req.body.idSolicitud,
          // El emisor sale del token. Aceptarlo del cuerpo permitiria calificar
          // en nombre de otro.
          idEmisor: req.auth!.userId,
          puntuacion: req.body.puntuacion,
          comentario: req.body.comentario ?? null,
          correlationId: req.correlationId,
        })
      );
      res.status(201).json(salida);
    })
  );

  /** Reputacion publica de una persona, por faceta (SRS RF167). */
  app.get(
    '/api/v1/ratings/users/:id',
    autenticado,
    ruta(async (req, res) => {
      res.json(await deps.consultar.deUsuario(idDeRuta(req)));
    })
  );

  /** Calificaciones que recibio una persona en una faceta (SRS RF83). */
  app.get(
    '/api/v1/ratings/users/:id/received',
    autenticado,
    validateQuery(porFacetaSchema),
    ruta(async (req, res) => {
      res.json(
        await deps.consultar.listarDeUsuario({
          idUsuario: idDeRuta(req),
          // Por omision, como oferente: es la faceta que mira quien va a
          // contratar, que es el caso que trae a casi todo el mundo aqui.
          faceta: (req.query['faceta'] as Faceta | undefined) ?? 'COMO_OFERENTE',
          pagina: req.query['pagina'] as number | undefined,
          tamano: req.query['tamano'] as number | undefined,
        })
      );
    })
  );

  /** Calificaciones y promedio de un servicio (SRS RF83, RF84). */
  app.get(
    '/api/v1/ratings/services/:id',
    autenticado,
    validateQuery(paginaSchema),
    ruta(async (req, res) => {
      res.json(
        await deps.consultar.deServicio({
          idServicio: idDeRuta(req),
          pagina: req.query['pagina'] as number | undefined,
          tamano: req.query['tamano'] as number | undefined,
        })
      );
    })
  );

  /**
   * Retirada por moderacion (SRS RF85).
   *
   * Solo ADMINISTRADOR. Si el autor pudiera retirar la suya, bastaria hacerlo
   * cada vez que la contraparte respondiera mal, y la reputacion solo guardaria
   * elogios.
   */
  app.delete(
    '/api/v1/ratings/:id',
    autenticado,
    requireRole('ADMINISTRADOR'),
    ruta(async (req, res) => {
      await runInTransaction(deps.knex, () =>
        deps.consultar.ocultarPorModeracion({
          idCalificacion: idDeRuta(req),
          correlationId: req.correlationId,
        })
      );
      res.status(204).send();
    })
  );

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger, !deps.config.isProduction));

  return app;
}
