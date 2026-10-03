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
  requireRole,
  runInTransaction,
  validateBody,
  validateQuery,
  type Logger,
} from '@punto-amigo/service-kit';
import { ESTADOS_PRESTADOR, TAMANO_PAGINA_MAXIMO } from '../../domain';
import type { ManageProviderProfileUseCase } from '../../application/use-cases/ManageProviderProfile';
import type { ReviewProviderProfileUseCase } from '../../application/use-cases/ReviewProviderProfile';

export interface AppDeps {
  knex: Knex;
  perfiles: ManageProviderProfileUseCase;
  revision: ReviewProviderProfileUseCase;
  logger: Logger;
  config: {
    corsOrigin: string;
    bodyLimit: string;
    isProduction: boolean;
    internalSecret: string;
    rateLimit: { windowMs: number; maxPerIp: number };
  };
}

/**
 * Datos del perfil (SRS RF22).
 *
 * `.strict()` rechaza lo que no este declarado en lugar de ignorarlo: una
 * peticion que intente enviar `"estado": "ACTIVE"` debe fallar de forma visible
 * y no colarse como si nada. Es la misma razon por la que el dominio no acepta
 * el estado como parametro.
 */
const perfilSchema = z
  .object({
    nombre: z.string().min(2).max(100),
    especialidad: z.string().min(2).max(150),
    experiencia: z.string().max(500).nullable().optional(),
    telefono: z.string().max(20).nullable().optional(),
    correo: z.string().max(150).nullable().optional(),
    disponibilidad: z.string().max(255).nullable().optional(),
  })
  .strict();

// En la edicion todo es opcional, pero un cuerpo vacio no es una edicion: sin
// este minimo, un PATCH sin campos emitiria un evento sin que nada cambiara.
const cambiosSchema = perfilSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Indique al menos un campo a modificar.' });

const rechazoSchema = z.object({ motivo: z.string().min(10).max(500) }).strict();

const estadoSchema = z
  .object({
    destino: z.enum(ESTADOS_PRESTADOR),
    motivo: z.string().min(3).max(500).nullable().optional(),
  })
  .strict();

const paginacionSchema = z
  .object({
    pagina: z.coerce.number().int().min(1).max(10_000).optional(),
    tamano: z.coerce.number().int().min(1).max(TAMANO_PAGINA_MAXIMO).optional(),
    especialidad: z.string().min(1).max(150).optional(),
  })
  .strict();

export function createApp(deps: AppDeps): Express {
  const app = express();

  // Para que req.ip sea el cliente y no el gateway. Solo el primer salto:
  // confiar en toda la cadena permite falsear la IP con una cabecera y esquivar
  // el limite por direccion.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    helmet({
      // Este servicio solo devuelve JSON: no carga scripts, estilos ni imagenes.
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

  /**
   * Identidad inyectada por el gateway, no un JWT verificado aqui otra vez.
   * Lo que la sostiene es que el gateway borra estas cabeceras de la entrada y
   * que `requireInternalCaller` ya exigio el secreto compartido.
   */
  const autenticado = requireGatewayIdentity();

  app.get('/health', async (_req: Request, res: Response) => {
    try {
      await deps.knex.raw('SELECT 1');
      res.json({ status: 'ok', database: 'up' });
    } catch {
      // No se expone el error: revelaria host, puerto o usuario de la base.
      res.status(503).json({ status: 'degraded', database: 'down' });
    }
  });

  /**
   * El orden de las rutas importa.
   *
   * Express case la primera que coincida, asi que `/me` y `/pending` van ANTES
   * de `/:id`. Al reves, `/api/v1/providers/me` entraria por `/:id` con el
   * identificador "me" y acabaria en un 404 confuso.
   */

  // ─── Perfil propio (rol OFERENTE) ───────────────────────────────────────

  app.post(
    '/api/v1/providers',
    autenticado,
    requireRole('OFERENTE'),
    validateBody(perfilSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // El perfil y su evento se confirman juntos o no se confirma ninguno.
        const salida = await runInTransaction(deps.knex, () =>
          deps.perfiles.crear({
            // El dueno sale del token, NUNCA del cuerpo: aceptarlo del cuerpo
            // permitiria crear un perfil a nombre de otra persona.
            idUsuario: req.auth!.userId,
            datos: req.body,
            correlationId: req.correlationId,
          })
        );
        res.status(201).json(salida);
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    '/api/v1/providers/me',
    autenticado,
    requireRole('OFERENTE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        res.json(await deps.perfiles.verPropio(req.auth!.userId));
      } catch (error) {
        next(error);
      }
    }
  );

  // ─── Cola de revision (rol ADMINISTRADOR) ───────────────────────────────

  app.get(
    '/api/v1/providers/pending',
    autenticado,
    requireRole('ADMINISTRADOR'),
    validateQuery(paginacionSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        res.json(
          await deps.revision.listarPendientes({
            pagina: req.query['pagina'] as number | undefined,
            tamano: req.query['tamano'] as number | undefined,
          })
        );
      } catch (error) {
        next(error);
      }
    }
  );

  // ─── Directorio y ficha publica ─────────────────────────────────────────

  app.get(
    '/api/v1/providers',
    autenticado,
    validateQuery(paginacionSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        res.json(
          await deps.perfiles.listarPublicos({
            especialidad: req.query['especialidad'] as string | undefined,
            pagina: req.query['pagina'] as number | undefined,
            tamano: req.query['tamano'] as number | undefined,
          })
        );
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * Ficha publica. Es la unica ruta del servicio que llega SIN token: el
   * gateway la tiene en su lista blanca (SRS RF31), asi que aqui no se exige
   * sesion. No devuelve telefono ni correo; eso se revela cuando hay acuerdo y
   * de eso es dueno request-service.
   */
  app.get('/api/v1/providers/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await deps.perfiles.verPublico(idDeRuta(req)));
    } catch (error) {
      next(error);
    }
  });

  app.patch(
    '/api/v1/providers/:id',
    autenticado,
    requireRole('OFERENTE'),
    validateBody(cambiosSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const salida = await runInTransaction(deps.knex, () =>
          deps.perfiles.editar({
            idPrestador: idDeRuta(req),
            // La propiedad la decide el dominio comparando con este valor. El
            // rol OFERENTE dice que puede tener un perfil, no que este sea suyo.
            idUsuario: req.auth!.userId,
            cambios: req.body,
            correlationId: req.correlationId,
          })
        );
        res.json(salida);
      } catch (error) {
        next(error);
      }
    }
  );

  /** Retirada voluntaria: pasa a INACTIVE, no borra nada (SRS RF29). */
  app.delete(
    '/api/v1/providers/:id',
    autenticado,
    requireRole('OFERENTE'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await runInTransaction(deps.knex, () =>
          deps.perfiles.retirar({
            idPrestador: idDeRuta(req),
            idUsuario: req.auth!.userId,
            correlationId: req.correlationId,
          })
        );
        res.status(204).send();
      } catch (error) {
        next(error);
      }
    }
  );

  // ─── Revision administrativa ────────────────────────────────────────────

  /** Ficha completa para revisar, con datos de contacto. Solo administradores. */
  app.get(
    '/api/v1/providers/:id/full',
    autenticado,
    requireRole('ADMINISTRADOR'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        res.json(await deps.revision.ver(idDeRuta(req)));
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/api/v1/providers/:id/validate',
    autenticado,
    requireRole('ADMINISTRADOR'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const salida = await runInTransaction(deps.knex, () =>
          deps.revision.validar({
            idPrestador: idDeRuta(req),
            idAdministrador: req.auth!.userId,
            correlationId: req.correlationId,
          })
        );
        res.json(salida);
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/api/v1/providers/:id/reject',
    autenticado,
    requireRole('ADMINISTRADOR'),
    validateBody(rechazoSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const salida = await runInTransaction(deps.knex, () =>
          deps.revision.rechazar({
            idPrestador: idDeRuta(req),
            motivo: req.body.motivo,
            idAdministrador: req.auth!.userId,
            correlationId: req.correlationId,
          })
        );
        res.json(salida);
      } catch (error) {
        next(error);
      }
    }
  );

  app.patch(
    '/api/v1/providers/:id/status',
    autenticado,
    requireRole('ADMINISTRADOR'),
    validateBody(estadoSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const salida = await runInTransaction(deps.knex, () =>
          deps.revision.cambiarEstado({
            idPrestador: idDeRuta(req),
            destino: req.body.destino,
            motivo: req.body.motivo ?? null,
            idAdministrador: req.auth!.userId,
            correlationId: req.correlationId,
          })
        );
        res.json(salida);
      } catch (error) {
        next(error);
      }
    }
  );

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger, !deps.config.isProduction));

  return app;
}
