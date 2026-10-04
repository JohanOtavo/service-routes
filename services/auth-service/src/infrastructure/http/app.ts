import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { Knex } from 'knex';
import { AppError } from '@punto-amigo/shared';
import type { RegisterUserUseCase } from '../../application/use-cases/RegisterUser';
import type { AuthenticateUserUseCase } from '../../application/use-cases/AuthenticateUser';
import type { RefreshSessionUseCase } from '../../application/use-cases/RefreshSession';
import type { PasswordRecoveryUseCase } from '../../application/use-cases/PasswordRecovery';
import type { ManageAccountsUseCase } from '../../application/use-cases/ManageAccounts';
import type { KnexSessionRepository } from '../persistence/KnexSessionRepository';
import type { JwtTokenService } from '../security/JwtTokenService';
import { runInTransaction } from '../persistence/transaction';
import {
  correlationId,
  errorHandler,
  notFoundHandler,
  requireAuth,
  requireRole,
  requireInternalCaller,
  validateBody,
  type Logger,
} from './middleware';

export interface AppDeps {
  knex: Knex;
  registrar: RegisterUserUseCase;
  autenticar: AuthenticateUserUseCase;
  renovar: RefreshSessionUseCase;
  recuperacion: PasswordRecoveryUseCase;
  cuentas: ManageAccountsUseCase;
  sesiones: KnexSessionRepository;
  tokens: JwtTokenService;
  logger: Logger;
  config: {
    corsOrigin: string;
    bodyLimit: string;
    isProduction: boolean;
    internalSecret: string;
    rateLimit: { windowMs: number; maxPerIp: number; authMax: number };
    refreshCookie: { name: string; secure: boolean; maxAgeMs: number };
  };
}

const registroSchema = z
  .object({
    nombre: z.string().min(2).max(100),
    correo: z.string().min(3).max(150),
    contrasena: z.string().min(1).max(128),
    confirmacionContrasena: z.string().min(1).max(128),
    telefono: z.string().max(20).optional(),
  })
  // Cualquier campo no declarado se rechaza en vez de ignorarse: una peticion
  // que intente enviar "roles" o "estado" debe fallar de forma visible, no
  // pasar como si nada.
  .strict();

const recuperacionSchema = z.object({ correo: z.string().min(3).max(150) }).strict();

const restablecerSchema = z
  .object({
    token: z.string().min(20).max(200),
    contrasena: z.string().min(1).max(128),
    confirmacionContrasena: z.string().min(1).max(128),
  })
  .strict();

const rolSchema = z.object({ rol: z.enum(['ADMINISTRADOR', 'OFERENTE', 'SOLICITANTE']) }).strict();

const suspenderSchema = z.object({ motivo: z.string().min(3).max(255) }).strict();

const loginSchema = z
  .object({
    correo: z.string().min(3).max(150),
    contrasena: z.string().min(1).max(128),
  })
  .strict();

export function createApp(deps: AppDeps): Express {
  const app = express();

  // Necesario para que req.ip refleje al cliente y no al gateway. Se confia
  // solo en el primer salto: confiar en toda la cadena permite falsear la IP
  // con una cabecera y esquivar el limite por direccion.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  /**
   * Cabeceras de seguridad (SRS RNF26 y security-rules.md).
   *
   * La politica de contenido es restrictiva porque este servicio solo devuelve
   * JSON: no carga scripts, ni estilos, ni imagenes.
   */
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

  // CORS acotado a un origen concreto. Nunca comodin: el navegador enviaria la
  // cookie de refresco a cualquier sitio que lo pidiera.
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

  // Limite de tamano del cuerpo: sin el, una peticion enorme consume memoria
  // antes de que ninguna validacion llegue a ejecutarse.
  app.use(express.json({ limit: deps.config.bodyLimit }));
  app.use(cookieParser());
  app.use(correlationId);

  const limiteGeneral = rateLimit({
    windowMs: deps.config.rateLimit.windowMs,
    limit: deps.config.rateLimit.maxPerIp,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(AppError.rateLimited()),
  });

  /**
   * Limite mas estricto en los endpoints de autenticacion (SRS RNF31).
   *
   * Es una defensa distinta del bloqueo por cuenta: aquel protege una cuenta
   * concreta, este protege contra probar una contrasena comun contra miles de
   * correos distintos, donde ninguna cuenta acumula fallos suficientes.
   */
  const limiteAuth = rateLimit({
    windowMs: deps.config.rateLimit.windowMs,
    limit: deps.config.rateLimit.authMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(AppError.rateLimited()),
  });

  app.use(requireInternalCaller(deps.config.internalSecret));
  app.use(limiteGeneral);

  app.get('/health', async (_req: Request, res: Response) => {
    try {
      await deps.knex.raw('SELECT 1');
      res.json({ status: 'ok', database: 'up' });
    } catch {
      // No se expone el error de conexion: revelaria host, puerto o usuario.
      res.status(503).json({ status: 'degraded', database: 'down' });
    }
  });

  app.post(
    '/api/v1/auth/register',
    limiteAuth,
    validateBody(registroSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // El alta y su evento se confirman juntos o no se confirma ninguno.
        const salida = await runInTransaction(deps.knex, () =>
          deps.registrar.execute({ ...req.body, correlationId: req.correlationId })
        );
        res.status(201).json(salida);
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/api/v1/auth/login',
    limiteAuth,
    validateBody(loginSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const salida = await runInTransaction(deps.knex, () =>
          deps.autenticar.execute({
            correo: req.body.correo,
            contrasena: req.body.contrasena,
            correlationId: req.correlationId,
            ip: req.ip ?? null,
            userAgent: req.header('user-agent') ?? null,
          })
        );

        /**
         * El refresh token viaja en cookie httpOnly y nunca en el cuerpo.
         *
         * httpOnly impide que un script lo lea, que es lo que convierte un XSS
         * en un robo de sesion permanente. SameSite=Strict evita que se envie
         * desde otro sitio. El access token si va en el cuerpo: vive 15 minutos
         * y el cliente lo guarda en memoria, nunca en localStorage.
         */
        res.cookie(deps.config.refreshCookie.name, salida.refreshToken, {
          httpOnly: true,
          secure: deps.config.refreshCookie.secure,
          sameSite: 'strict',
          path: '/api/v1/auth',
          maxAge: deps.config.refreshCookie.maxAgeMs,
        });

        res.json({
          accessToken: salida.accessToken,
          expiresAt: salida.accessExpiresAt.toISOString(),
          usuario: salida.usuario,
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/api/v1/auth/logout',
    limiteAuth,
    requireAuth(deps.tokens, deps.sesiones),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await runInTransaction(deps.knex, async () => {
          const cookie = req.cookies?.[deps.config.refreshCookie.name] as string | undefined;

          if (cookie !== undefined) {
            const sesion = await deps.sesiones.buscarPorHash(deps.tokens.hashRefreshToken(cookie));
            if (sesion !== null) await deps.sesiones.revocar(sesion.id, 'LOGOUT');
          }

          // El access token en curso pasa a la lista de denegacion: sin esto
          // seguiria sirviendo hasta expirar pese al cierre de sesion.
          if (req.auth !== undefined) {
            await deps.sesiones.denegarAccessToken(
              req.auth.jti,
              req.auth.userId,
              new Date(Date.now() + 900_000)
            );
          }
        });

        res.clearCookie(deps.config.refreshCookie.name, { path: '/api/v1/auth' });
        res.status(204).send();
      } catch (error) {
        next(error);
      }
    }
  );

  app.get(
    '/api/v1/auth/me',
    requireAuth(deps.tokens, deps.sesiones),
    (req: Request, res: Response) => {
      res.json({ userId: req.auth?.userId, roles: req.auth?.roles });
    }
  );

  app.post(
    '/api/v1/auth/refresh',
    limiteAuth,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const salida = await runInTransaction(deps.knex, () =>
          deps.renovar.execute({
            refreshToken: req.cookies?.[deps.config.refreshCookie.name] as string | undefined,
            ip: req.ip ?? null,
            userAgent: req.header('user-agent') ?? null,
          })
        );

        // La cookie se sustituye por la del token rotado; la anterior ya no vale.
        res.cookie(deps.config.refreshCookie.name, salida.refreshToken, {
          httpOnly: true,
          secure: deps.config.refreshCookie.secure,
          sameSite: 'strict',
          path: '/api/v1/auth',
          maxAge: deps.config.refreshCookie.maxAgeMs,
        });

        res.json({
          accessToken: salida.accessToken,
          expiresAt: salida.accessExpiresAt.toISOString(),
          // El usuario viaja tambien en la renovacion, igual que en el inicio
          // de sesion: en una carga en frio es la UNICA respuesta con la que el
          // cliente puede reconstruir la sesion, y sin esto se quedaba sin roles.
          usuario: salida.usuario,
        });
      } catch (error) {
        // Una renovacion fallida limpia la cookie: conservarla solo produce
        // reintentos que van a fallar igual.
        res.clearCookie(deps.config.refreshCookie.name, { path: '/api/v1/auth' });
        next(error);
      }
    }
  );

  app.post(
    '/api/v1/auth/password-recovery',
    limiteAuth,
    validateBody(recuperacionSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await runInTransaction(deps.knex, () =>
          deps.recuperacion.solicitar({
            correo: req.body.correo,
            correlationId: req.correlationId,
          })
        );
        // 202 siempre, exista o no la cuenta: distinguirlo convertiria esto en
        // un verificador de correos registrados.
        res.status(202).json({
          mensaje: 'Si el correo esta registrado, recibira instrucciones para continuar.',
        });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/api/v1/auth/password-reset',
    limiteAuth,
    validateBody(restablecerSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await runInTransaction(deps.knex, () =>
          deps.recuperacion.restablecer({ ...req.body, correlationId: req.correlationId })
        );
        res.status(204).send();
      } catch (error) {
        next(error);
      }
    }
  );

  // ─── Administracion de cuentas ──────────────────────────────────────────
  // Todas exigen rol ADMINISTRADOR, verificado en el servidor y no en la
  // interfaz (SRS RNF23).

  app.patch(
    '/api/v1/users/:id/roles',
    requireAuth(deps.tokens, deps.sesiones),
    requireRole('ADMINISTRADOR'),
    validateBody(rolSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const roles = await runInTransaction(deps.knex, () =>
          deps.cuentas.asignarRol({
            idUsuario: Number(req.params['id']),
            rol: req.body.rol,
            ejecutadaPor: req.auth!.userId,
            correlationId: req.correlationId,
          })
        );
        res.json({ roles });
      } catch (error) {
        next(error);
      }
    }
  );

  app.delete(
    '/api/v1/users/:id/roles/:rol',
    requireAuth(deps.tokens, deps.sesiones),
    requireRole('ADMINISTRADOR'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const roles = await runInTransaction(deps.knex, () =>
          deps.cuentas.retirarRol({
            idUsuario: Number(req.params['id']),
            rol: String(req.params['rol']),
            ejecutadaPor: req.auth!.userId,
            correlationId: req.correlationId,
          })
        );
        res.json({ roles });
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/api/v1/users/:id/suspend',
    requireAuth(deps.tokens, deps.sesiones),
    requireRole('ADMINISTRADOR'),
    validateBody(suspenderSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await runInTransaction(deps.knex, () =>
          deps.cuentas.suspender({
            idUsuario: Number(req.params['id']),
            motivo: req.body.motivo,
            ejecutadaPor: req.auth!.userId,
            correlationId: req.correlationId,
          })
        );
        res.status(204).send();
      } catch (error) {
        next(error);
      }
    }
  );

  app.post(
    '/api/v1/users/:id/reactivate',
    requireAuth(deps.tokens, deps.sesiones),
    requireRole('ADMINISTRADOR'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await runInTransaction(deps.knex, () =>
          deps.cuentas.reactivar({
            idUsuario: Number(req.params['id']),
            ejecutadaPor: req.auth!.userId,
            correlationId: req.correlationId,
          })
        );
        res.status(204).send();
      } catch (error) {
        next(error);
      }
    }
  );

  app.delete(
    '/api/v1/users/:id',
    requireAuth(deps.tokens, deps.sesiones),
    requireRole('ADMINISTRADOR'),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        await runInTransaction(deps.knex, () =>
          deps.cuentas.eliminar({
            idUsuario: Number(req.params['id']),
            ejecutadaPor: req.auth!.userId,
            correlationId: req.correlationId,
          })
        );
        res.status(204).send();
      } catch (error) {
        next(error);
      }
    }
  );

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger, !deps.config.isProduction));

  return app;
}
