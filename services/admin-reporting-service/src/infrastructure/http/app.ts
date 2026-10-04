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
  CAMPOS_ORDEN_AUDITORIA,
  RESULTADOS_AUDITORIA,
  SENTIDOS_ORDEN,
  TAMANO_PAGINA_MAXIMO,
  TIPOS_PARAMETRO,
} from '../../domain';
import type { QueryAuditTrailUseCase } from '../../application/use-cases/QueryAuditTrail';
import type { ManageReportsUseCase } from '../../application/use-cases/ManageReports';

export interface AppDeps {
  knex: Knex;
  bitacora: QueryAuditTrailUseCase;
  informes: ManageReportsUseCase;
  logger: Logger;
  config: {
    corsOrigin: string;
    bodyLimit: string;
    isProduction: boolean;
    internalSecret: string;
    rateLimit: { windowMs: number; maxPerIp: number };
  };
}

const fecha = z.coerce.date();

const paginaSchema = z.object({
  pagina: z.coerce.number().int().min(1).max(10_000).optional(),
  tamano: z.coerce.number().int().min(1).max(TAMANO_PAGINA_MAXIMO).optional(),
});

const bitacoraSchema = paginaSchema
  .extend({
    desde: fecha.optional(),
    hasta: fecha.optional(),
    idActor: z.coerce.number().int().positive().optional(),
    accion: z.string().min(1).max(80).optional(),
    recursoTipo: z.string().min(1).max(40).optional(),
    recursoId: z.string().min(1).max(64).optional(),
    resultado: z.enum(RESULTADOS_AUDITORIA).optional(),
    correlationId: z.string().uuid().optional(),
    // Lista blanca: ORDER BY no admite parametros, asi que el nombre de columna
    // acaba concatenado al SQL y esto es lo unico que lo separa de una inyeccion.
    campoOrden: z.enum(CAMPOS_ORDEN_AUDITORIA).optional(),
    sentidoOrden: z.enum(SENTIDOS_ORDEN).optional(),
  })
  .strict();

const actividadSchema = z.object({ desde: fecha.optional(), hasta: fecha.optional() }).strict();

const serieSchema = paginaSchema
  .extend({
    metrica: z.string().min(1).max(60),
    dimension: z.string().min(1).max(60).optional(),
    desde: fecha.optional(),
    hasta: fecha.optional(),
  })
  .strict();

const respaldosSchema = paginaSchema
  .extend({
    esquema: z.string().min(1).max(60).optional(),
    desde: fecha.optional(),
    hasta: fecha.optional(),
  })
  .strict();

const parametroSchema = z
  .object({
    clave: z.string().min(2).max(80),
    valor: z.string().min(1).max(500),
    descripcion: z.string().max(255).nullable().optional(),
    tipoDato: z.enum(TIPOS_PARAMETRO),
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
  const metricas = crearMetricas('admin-reporting-service');
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
   * TODO lo que sigue exige ADMINISTRADOR.
   *
   * Se aplica con dos middlewares de ambito, antes de declarar ninguna ruta, en
   * lugar de repetirlos en cada una. La diferencia importa: una ruta nueva
   * queda protegida por omision, mientras que repetir el guardia depende de que
   * nadie se olvide. Aqui se consultan bitacoras de auditoria y parametros que
   * gobiernan el sistema entero: olvidarlo una vez seria caro.
   */
  app.use('/api/v1/admin', requireGatewayIdentity(), requireRole('ADMINISTRADOR'));

  app.get(
    '/api/v1/admin/audit',
    validateQuery(bitacoraSchema),
    ruta(async (req, res) => {
      const q = req.query as Record<string, unknown>;
      res.json(
        await deps.bitacora.consultar({
          filtros: {
            desde: q['desde'] as Date | undefined,
            hasta: q['hasta'] as Date | undefined,
            idActor: q['idActor'] as number | undefined,
            accion: q['accion'] as string | undefined,
            recursoTipo: q['recursoTipo'] as string | undefined,
            recursoId: q['recursoId'] as string | undefined,
            resultado: q['resultado'] as never,
            correlationId: q['correlationId'] as string | undefined,
          },
          campoOrden: q['campoOrden'] as never,
          sentidoOrden: q['sentidoOrden'] as never,
          pagina: q['pagina'] as number | undefined,
          tamano: q['tamano'] as number | undefined,
        })
      );
    })
  );

  app.get(
    '/api/v1/admin/reports/activity',
    validateQuery(actividadSchema),
    ruta(async (req, res) => {
      const q = req.query as Record<string, unknown>;
      res.json(
        await deps.informes.actividad({
          desde: q['desde'] as Date | undefined,
          hasta: q['hasta'] as Date | undefined,
        })
      );
    })
  );

  /** Metricas disponibles: va ANTES de la serie para no casar como metrica. */
  app.get(
    '/api/v1/admin/reports/metrics',
    ruta(async (_req, res) => {
      res.json(await deps.informes.metricas());
    })
  );

  app.get(
    '/api/v1/admin/reports/series',
    validateQuery(serieSchema),
    ruta(async (req, res) => {
      const q = req.query as Record<string, unknown>;
      res.json(
        await deps.informes.serie({
          metrica: q['metrica'] as string,
          dimension: q['dimension'] as string | undefined,
          desde: q['desde'] as Date | undefined,
          hasta: q['hasta'] as Date | undefined,
          pagina: q['pagina'] as number | undefined,
          tamano: q['tamano'] as number | undefined,
        })
      );
    })
  );

  app.get(
    '/api/v1/admin/backups',
    validateQuery(respaldosSchema),
    ruta(async (req, res) => {
      const q = req.query as Record<string, unknown>;
      res.json(
        await deps.informes.listarRespaldos({
          esquema: q['esquema'] as string | undefined,
          desde: q['desde'] as Date | undefined,
          hasta: q['hasta'] as Date | undefined,
          pagina: q['pagina'] as number | undefined,
          tamano: q['tamano'] as number | undefined,
        })
      );
    })
  );

  app.get(
    '/api/v1/admin/parameters',
    validateQuery(paginaSchema.strict()),
    ruta(async (req, res) => {
      const q = req.query as Record<string, unknown>;
      res.json(
        await deps.informes.listarParametros({
          pagina: q['pagina'] as number | undefined,
          tamano: q['tamano'] as number | undefined,
        })
      );
    })
  );

  app.get(
    '/api/v1/admin/parameters/:clave',
    ruta(async (req, res) => {
      res.json(await deps.informes.verParametro(String(req.params['clave'])));
    })
  );

  /** Alta o cambio de un parametro: el asiento va en la misma transaccion. */
  app.put(
    '/api/v1/admin/parameters',
    validateBody(parametroSchema),
    ruta(async (req, res) => {
      const salida = await runInTransaction(deps.knex, () =>
        deps.informes.guardarParametro({
          clave: req.body.clave,
          valor: req.body.valor,
          descripcion: req.body.descripcion ?? null,
          tipoDato: req.body.tipoDato,
          idAdministrador: req.auth!.userId,
          correlationId: req.correlationId,
          ipOrigen: req.ip ?? null,
        })
      );
      res.json(salida);
    })
  );

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger, !deps.config.isProduction));

  return app;
}
