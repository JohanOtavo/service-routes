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
import { TAMANO_PAGINA_MAXIMO } from '../../domain';
import type { ManageNeedsUseCase } from '../../application/use-cases/ManageNeeds';
import type { ManageProposalsUseCase } from '../../application/use-cases/ManageProposals';
import type { ManageRequestsUseCase } from '../../application/use-cases/ManageRequests';
import type { CancelRequestUseCase } from '../../application/use-cases/CancelRequest';

export interface AppDeps {
  knex: Knex;
  necesidades: ManageNeedsUseCase;
  propuestas: ManageProposalsUseCase;
  solicitudes: ManageRequestsUseCase;
  cancelacion: CancelRequestUseCase;
  logger: Logger;
  config: {
    corsOrigin: string;
    bodyLimit: string;
    isProduction: boolean;
    internalSecret: string;
    rateLimit: { windowMs: number; maxPerIp: number };
  };
}

/** Importe como cadena: DECIMAL no cabe en un double sin perder precision. */
const importe = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,2})?$/u, 'Use un numero con hasta dos decimales.');

const necesidadSchema = z
  .object({
    titulo: z.string().min(5).max(150),
    descripcion: z.string().min(20).max(5000),
    idCategoria: z.number().int().positive(),
    presupuestoEstimado: importe.nullable().optional(),
    fechaDeseada: z.string().datetime().nullable().optional(),
    // Zona, no direccion. El tope de longitud es parte de esa decision: una
    // cadena larga invita a escribir la direccion exacta (SRS 10.5).
    ubicacionAproximada: z.string().max(150).nullable().optional(),
  })
  .strict();

const cambiosNecesidadSchema = z
  .object({
    titulo: z.string().min(5).max(150).optional(),
    descripcion: z.string().min(20).max(5000).optional(),
    presupuestoEstimado: importe.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Indique al menos un campo.' });

const cierreSchema = z
  .object({
    estado: z.enum(['CERRADA', 'CANCELADA']),
    motivo: z.string().min(3).max(255).nullable().optional(),
  })
  .strict();

const propuestaSchema = z
  .object({
    precio: importe,
    tiempoEstimado: z.number().int().positive().max(3650),
    mensaje: z.string().min(10).max(2000),
    idServicio: z.number().int().positive().nullable().optional(),
  })
  .strict();

const cambiosPropuestaSchema = propuestaSchema
  .partial()
  .omit({ idServicio: true })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Indique al menos un campo.' });

const solicitudDirectaSchema = z
  .object({
    idServicio: z.number().int().positive(),
    descripcionProblema: z.string().min(10).max(5000),
  })
  .strict();

const adjudicacionSchema = z.object({ idPropuesta: z.number().int().positive() }).strict();

// CANCELADA no entra aqui: cancelar tiene su propia ruta porque exige motivo del
// catalogo y produce una clasificacion. Permitirlo por este camino saltaria toda
// la politica de cancelacion.
const estadoSchema = z
  .object({
    destino: z.enum(['ACEPTADA', 'RECHAZADA', 'COMPLETADA']),
    motivo: z.string().min(3).max(255).nullable().optional(),
  })
  .strict();

const cancelacionSchema = z
  .object({
    codigoMotivo: z.string().min(2).max(40),
    detalle: z.string().max(500).nullable().optional(),
    fechaAcordada: z.string().datetime().nullable().optional(),
  })
  .strict();

const paginaSchema = z
  .object({
    pagina: z.coerce.number().int().min(1).max(10_000).optional(),
    tamano: z.coerce.number().int().min(1).max(TAMANO_PAGINA_MAXIMO).optional(),
  })
  .strict();

const busquedaSchema = paginaSchema.extend({
  idCategoria: z.coerce.number().int().positive().optional(),
  texto: z.string().min(2).max(100).optional(),
});

const misSolicitudesSchema = paginaSchema.extend({
  como: z.enum(['SOLICITANTE', 'OFERENTE']).optional(),
});

export function createApp(deps: AppDeps): Express {
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // Solo devuelve JSON: no carga scripts, estilos ni imagenes.
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
    // Nunca comodin: el navegador enviaria credenciales a cualquier sitio.
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
  const metricas = crearMetricas('request-service');
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

  /** Envuelve un manejador: captura el error y lo pasa al manejador central. */
  const ruta =
    (fn: (req: Request, res: Response) => Promise<void>) =>
    (req: Request, res: Response, next: NextFunction): void => {
      fn(req, res).catch(next);
    };

  // ─── Necesidades (SRS RF120 a RF136) ────────────────────────────────────
  //
  // NINGUNA ruta de necesidades es publica. El gateway no las tiene en su lista
  // blanca y aqui tampoco: una necesidad describe un problema concreto en una
  // zona concreta, y publicarla sin sesion la convertiria en material para
  // quien busque casas vacias o personas vulnerables.

  app.post(
    '/api/v1/needs',
    autenticado,
    requireRole('SOLICITANTE'),
    validateBody(necesidadSchema),
    ruta(async (req, res) => {
      const salida = await runInTransaction(deps.knex, () =>
        deps.necesidades.publicar({
          // El autor sale del token, nunca del cuerpo.
          idUsuario: req.auth!.userId,
          datos: req.body,
          correlationId: req.correlationId,
        })
      );
      res.status(201).json(salida);
    })
  );

  /** Las mias: va antes de /:id para que "mine" no entre como identificador. */
  app.get(
    '/api/v1/needs/mine',
    autenticado,
    requireRole('SOLICITANTE'),
    validateQuery(paginaSchema),
    ruta(async (req, res) => {
      res.json(
        await deps.necesidades.misNecesidades({
          idUsuario: req.auth!.userId,
          pagina: req.query['pagina'] as number | undefined,
          tamano: req.query['tamano'] as number | undefined,
        })
      );
    })
  );

  /** Listado para oferentes: solo abiertas y sin datos de contacto (RF130, RF136). */
  app.get(
    '/api/v1/needs',
    autenticado,
    requireRole('OFERENTE'),
    validateQuery(busquedaSchema),
    ruta(async (req, res) => {
      res.json(
        await deps.necesidades.listarAbiertas({
          filtros: {
            idCategoria: req.query['idCategoria'] as number | undefined,
            texto: req.query['texto'] as string | undefined,
          },
          pagina: req.query['pagina'] as number | undefined,
          tamano: req.query['tamano'] as number | undefined,
        })
      );
    })
  );

  app.get(
    '/api/v1/needs/:id',
    autenticado,
    requireRole('OFERENTE'),
    ruta(async (req, res) => {
      res.json(await deps.necesidades.verPublica(idDeRuta(req)));
    })
  );

  app.patch(
    '/api/v1/needs/:id',
    autenticado,
    requireRole('SOLICITANTE'),
    validateBody(cambiosNecesidadSchema),
    ruta(async (req, res) => {
      const salida = await runInTransaction(deps.knex, () =>
        deps.necesidades.editar({
          idNecesidad: idDeRuta(req),
          idUsuario: req.auth!.userId,
          cambios: req.body,
          correlationId: req.correlationId,
        })
      );
      res.json(salida);
    })
  );

  app.post(
    '/api/v1/needs/:id/close',
    autenticado,
    requireRole('SOLICITANTE'),
    validateBody(cierreSchema),
    ruta(async (req, res) => {
      await runInTransaction(deps.knex, () =>
        deps.necesidades.cerrar({
          idNecesidad: idDeRuta(req),
          idUsuario: req.auth!.userId,
          estado: req.body.estado,
          motivo: req.body.motivo ?? null,
          correlationId: req.correlationId,
        })
      );
      res.status(204).send();
    })
  );

  // ─── Propuestas (SRS RF137 a RF153) ─────────────────────────────────────

  app.post(
    '/api/v1/needs/:id/proposals',
    autenticado,
    requireRole('OFERENTE'),
    validateBody(propuestaSchema),
    ruta(async (req, res) => {
      const salida = await runInTransaction(deps.knex, () =>
        deps.propuestas.enviar({
          idNecesidad: idDeRuta(req),
          // El prestador se resuelve desde este usuario, no desde el cuerpo.
          idUsuario: req.auth!.userId,
          datos: req.body,
          correlationId: req.correlationId,
        })
      );
      res.status(201).json(salida);
    })
  );

  /**
   * Propuestas de una necesidad: SOLO su autor (SRS RF146, RF148).
   *
   * Exige SOLICITANTE y ademas comprueba la propiedad en el caso de uso. Si
   * cualquier oferente pudiera verlas, sabria contra que precios compite y la
   * puja dejaria de ser ciega.
   */
  app.get(
    '/api/v1/needs/:id/proposals',
    autenticado,
    requireRole('SOLICITANTE'),
    ruta(async (req, res) => {
      res.json(
        await deps.propuestas.listarDeNecesidad({
          idNecesidad: idDeRuta(req),
          idUsuario: req.auth!.userId,
        })
      );
    })
  );

  /** Adjudicacion: cierra la necesidad y crea la contratacion de una vez. */
  app.post(
    '/api/v1/needs/:id/award',
    autenticado,
    requireRole('SOLICITANTE'),
    validateBody(adjudicacionSchema),
    ruta(async (req, res) => {
      const salida = await runInTransaction(deps.knex, () =>
        deps.solicitudes.adjudicar({
          idNecesidad: idDeRuta(req),
          idPropuesta: req.body.idPropuesta,
          idUsuario: req.auth!.userId,
          correlationId: req.correlationId,
        })
      );
      res.status(201).json(salida);
    })
  );

  app.get(
    '/api/v1/proposals/mine',
    autenticado,
    requireRole('OFERENTE'),
    validateQuery(paginaSchema),
    ruta(async (req, res) => {
      res.json(
        await deps.propuestas.misPropuestas({
          idUsuario: req.auth!.userId,
          pagina: req.query['pagina'] as number | undefined,
          tamano: req.query['tamano'] as number | undefined,
        })
      );
    })
  );

  app.patch(
    '/api/v1/proposals/:id',
    autenticado,
    requireRole('OFERENTE'),
    validateBody(cambiosPropuestaSchema),
    ruta(async (req, res) => {
      const salida = await runInTransaction(deps.knex, () =>
        deps.propuestas.modificar({
          idPropuesta: idDeRuta(req),
          idUsuario: req.auth!.userId,
          cambios: req.body,
        })
      );
      res.json(salida);
    })
  );

  app.delete(
    '/api/v1/proposals/:id',
    autenticado,
    requireRole('OFERENTE'),
    ruta(async (req, res) => {
      await runInTransaction(deps.knex, () =>
        deps.propuestas.retirar({
          idPropuesta: idDeRuta(req),
          idUsuario: req.auth!.userId,
          correlationId: req.correlationId,
        })
      );
      res.status(204).send();
    })
  );

  // ─── Contrataciones (SRS RF60 a RF70, RF154 a RF157) ────────────────────

  app.post(
    '/api/v1/requests',
    autenticado,
    requireRole('SOLICITANTE'),
    validateBody(solicitudDirectaSchema),
    ruta(async (req, res) => {
      const salida = await runInTransaction(deps.knex, () =>
        deps.solicitudes.crearDirecta({
          idUsuario: req.auth!.userId,
          idServicio: req.body.idServicio,
          descripcionProblema: req.body.descripcionProblema,
          correlationId: req.correlationId,
        })
      );
      res.status(201).json(salida);
    })
  );

  /**
   * Catalogo de motivos de cancelacion.
   *
   * Lo necesita el cliente para ofrecer la lista. Va antes de `/:id` porque
   * "cancellation-reasons" no es un identificador, y exige sesion: no hay
   * razon para que un visitante anonimo recorra los motivos de la plataforma.
   */
  app.get(
    '/api/v1/requests/cancellation-reasons',
    autenticado,
    ruta(async (_req, res) => {
      res.json(await deps.cancelacion.motivosDisponibles());
    })
  );

  /**
   * Las mias, como solicitante o como oferente.
   *
   * El papel es un parametro porque la MISMA persona puede ser las dos cosas
   * (SRS RF165). Deducirlo del rol no funcionaria: quien tiene ambos roles
   * veria siempre una sola de sus dos bandejas.
   */
  app.get(
    '/api/v1/requests/mine',
    autenticado,
    validateQuery(misSolicitudesSchema),
    ruta(async (req, res) => {
      res.json(
        await deps.solicitudes.mias({
          idUsuario: req.auth!.userId,
          como: (req.query['como'] as 'SOLICITANTE' | 'OFERENTE' | undefined) ?? 'SOLICITANTE',
          pagina: req.query['pagina'] as number | undefined,
          tamano: req.query['tamano'] as number | undefined,
        })
      );
    })
  );

  /** Detalle. Revela el contacto SOLO si ya hay acuerdo (RF156, RNF84). */
  app.get(
    '/api/v1/requests/:id',
    autenticado,
    ruta(async (req, res) => {
      res.json(
        await deps.solicitudes.ver({
          idSolicitud: idDeRuta(req),
          idUsuario: req.auth!.userId,
        })
      );
    })
  );

  app.patch(
    '/api/v1/requests/:id/status',
    autenticado,
    validateBody(estadoSchema),
    ruta(async (req, res) => {
      const salida = await runInTransaction(deps.knex, () =>
        deps.solicitudes.cambiarEstado({
          idSolicitud: idDeRuta(req),
          idUsuario: req.auth!.userId,
          destino: req.body.destino,
          motivo: req.body.motivo ?? null,
          correlationId: req.correlationId,
        })
      );
      res.json(salida);
    })
  );

  /**
   * Cancelacion, con su propia ruta (SRS 10.2).
   *
   * No entra por `/status` porque no es un cambio de estado mas: exige un motivo
   * del catalogo, clasifica segun cuanto aviso se dio y decide a quien se le
   * carga. Permitir CANCELADA por `/status` seria una puerta trasera que salta
   * toda la politica.
   */
  app.post(
    '/api/v1/requests/:id/cancel',
    autenticado,
    validateBody(cancelacionSchema),
    ruta(async (req, res) => {
      const salida = await runInTransaction(deps.knex, () =>
        deps.cancelacion.cancelar({
          idSolicitud: idDeRuta(req),
          idUsuario: req.auth!.userId,
          codigoMotivo: req.body.codigoMotivo,
          detalle: req.body.detalle ?? null,
          fechaAcordada: req.body.fechaAcordada ?? null,
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
