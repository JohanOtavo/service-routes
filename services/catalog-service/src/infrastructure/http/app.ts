import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Knex } from 'knex';
import { AppError } from '@punto-amigo/shared';
import {
  accessLog,
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
import { TAMANO_PAGINA_MAXIMO } from '../../domain';
import type { ManageServiceCatalogUseCase } from '../../application/use-cases/ManageServiceCatalog';
import type { ManageCategoriesUseCase } from '../../application/use-cases/ManageCategories';
import type { SearchCatalogUseCase } from '../../application/use-cases/SearchCatalog';

export interface AppDeps {
  knex: Knex;
  catalogo: ManageServiceCatalogUseCase;
  categorias: ManageCategoriesUseCase;
  busqueda: SearchCatalogUseCase;
  logger: Logger;
  config: {
    corsOrigin: string;
    bodyLimit: string;
    isProduction: boolean;
    internalSecret: string;
    rateLimit: { windowMs: number; maxPerIp: number };
  };
}

const servicioSchema = z
  .object({
    nombre: z.string().min(3).max(150),
    descripcion: z.string().min(10).max(5000),
    idCategoria: z.number().int().positive(),
  })
  .strict();

const cambiosServicioSchema = servicioSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Indique al menos un campo.' });

const categoriaSchema = z
  .object({
    nombre: z.string().min(3).max(100),
    descripcion: z.string().max(255).nullable().optional(),
  })
  .strict();

const cambiosCategoriaSchema = z
  .object({ nombre: z.string().min(3).max(100).optional(), activa: z.boolean().optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Indique al menos un campo.' });

const paginaSchema = z
  .object({
    pagina: z.coerce.number().int().min(1).max(10_000).optional(),
    tamano: z.coerce.number().int().min(1).max(TAMANO_PAGINA_MAXIMO).optional(),
  })
  .strict();

const busquedaSchema = paginaSchema.extend({
  texto: z.string().min(2).max(100).optional(),
  idCategoria: z.coerce.number().int().positive().optional(),
  idPrestador: z.coerce.number().int().positive().optional(),
});

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
  const metricas = crearMetricas('catalog-service');
  app.use(metricas.middleware);
  app.use(accessLog(deps.logger));
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

  // ─── Catalogo propio del oferente ───────────────────────────────────────
  //
  // `/mine` va ANTES de `/:id`: al reves, Express casaria "mine" como
  // identificador. El gateway tampoco lo deja pasar por la entrada publica de
  // `/:id`, porque alli `:id` solo case con digitos.

  app.get(
    '/api/v1/services/mine',
    autenticado,
    requireRole('OFERENTE'),
    validateQuery(paginaSchema),
    ruta(async (req, res) => {
      res.json(
        await deps.catalogo.listarPropios({
          idUsuario: req.auth!.userId,
          pagina: req.query['pagina'] as number | undefined,
          tamano: req.query['tamano'] as number | undefined,
        })
      );
    })
  );

  app.post(
    '/api/v1/services',
    autenticado,
    requireRole('OFERENTE'),
    validateBody(servicioSchema),
    ruta(async (req, res) => {
      const salida = await runInTransaction(deps.knex, () =>
        deps.catalogo.publicar({
          // El dueno sale del token. Aceptarlo del cuerpo permitiria publicar
          // un servicio a nombre de otro oferente.
          idUsuario: req.auth!.userId,
          datos: req.body,
          correlationId: req.correlationId,
        })
      );
      res.status(201).json(salida);
    })
  );

  /**
   * Busqueda publica (SRS RF45 a RF49).
   *
   * El gateway la deja pasar sin token: sin ella, quien llega por primera vez
   * no puede ver que ofrece la plataforma. Por eso aqui tampoco se exige
   * sesion, y por eso el repositorio filtra a servicios ACTIVE de prestadores
   * ACTIVE y no devuelve datos de contacto.
   */
  app.get(
    '/api/v1/services',
    validateQuery(busquedaSchema),
    ruta(async (req, res) => {
      res.json(
        await deps.busqueda.buscar({
          ...(req.query['texto'] === undefined ? {} : { texto: req.query['texto'] as string }),
          ...(req.query['idCategoria'] === undefined
            ? {}
            : { idCategoria: req.query['idCategoria'] as unknown as number }),
          ...(req.query['idPrestador'] === undefined
            ? {}
            : { idPrestador: req.query['idPrestador'] as unknown as number }),
          ...(req.query['pagina'] === undefined
            ? {}
            : { pagina: req.query['pagina'] as unknown as number }),
          ...(req.query['tamano'] === undefined
            ? {}
            : { tamano: req.query['tamano'] as unknown as number }),
        })
      );
    })
  );

  app.get(
    '/api/v1/services/:id',
    ruta(async (req, res) => {
      res.json(await deps.busqueda.verPublico(idDeRuta(req)));
    })
  );

  app.patch(
    '/api/v1/services/:id',
    autenticado,
    requireRole('OFERENTE'),
    validateBody(cambiosServicioSchema),
    ruta(async (req, res) => {
      const salida = await runInTransaction(deps.knex, () =>
        deps.catalogo.editar({
          idServicio: idDeRuta(req),
          idUsuario: req.auth!.userId,
          cambios: req.body,
          correlationId: req.correlationId,
        })
      );
      res.json(salida);
    })
  );

  /** Baja del escaparate: pasa a INACTIVE, no borra (SRS RF51). */
  app.delete(
    '/api/v1/services/:id',
    autenticado,
    requireRole('OFERENTE'),
    ruta(async (req, res) => {
      await runInTransaction(deps.knex, () =>
        deps.catalogo.desactivar({
          idServicio: idDeRuta(req),
          idUsuario: req.auth!.userId,
          correlationId: req.correlationId,
        })
      );
      res.status(204).send();
    })
  );

  // ─── Categorias ─────────────────────────────────────────────────────────

  /** Publica: hace falta para filtrar la busqueda sin haber iniciado sesion. */
  app.get(
    '/api/v1/categories',
    ruta(async (_req, res) => {
      res.json(await deps.categorias.listar());
    })
  );

  app.post(
    '/api/v1/categories',
    autenticado,
    requireRole('ADMINISTRADOR'),
    validateBody(categoriaSchema),
    ruta(async (req, res) => {
      const salida = await runInTransaction(deps.knex, () =>
        deps.categorias.crear({
          idAdministrador: req.auth!.userId,
          datos: req.body,
          correlationId: req.correlationId,
        })
      );
      res.status(201).json(salida);
    })
  );

  app.patch(
    '/api/v1/categories/:id',
    autenticado,
    requireRole('ADMINISTRADOR'),
    validateBody(cambiosCategoriaSchema),
    ruta(async (req, res) => {
      const salida = await runInTransaction(deps.knex, () =>
        deps.categorias.editar({
          idCategoria: idDeRuta(req),
          idAdministrador: req.auth!.userId,
          cambios: req.body,
          correlationId: req.correlationId,
        })
      );
      res.json(salida);
    })
  );

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger, !deps.config.isProduction));

  return app;
}
