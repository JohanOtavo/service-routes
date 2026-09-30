import knexLib from 'knex';
import { z } from 'zod';
import { baseEnvSchema, loadEnv, assertProductionSafety } from '@punto-amigo/shared';
import { RegisterUserUseCase } from './application/use-cases/RegisterUser';
import { AuthenticateUserUseCase } from './application/use-cases/AuthenticateUser';
import { KnexUsuarioRepository } from './infrastructure/persistence/KnexUsuarioRepository';
import { KnexSessionRepository } from './infrastructure/persistence/KnexSessionRepository';
import { KnexLockoutPolicy } from './infrastructure/persistence/KnexLockoutPolicy';
import { OutboxEventPublisher } from './infrastructure/persistence/OutboxEventPublisher';
import { Argon2PasswordHasher } from './infrastructure/security/Argon2PasswordHasher';
import { JwtTokenService } from './infrastructure/security/JwtTokenService';
import { SystemClock } from './infrastructure/SystemClock';
import { createApp } from './infrastructure/http/app';

/**
 * Configuracion propia del servicio, sobre la base comun.
 *
 * Todo se valida al arrancar: un servicio debe negarse a levantar si le falta
 * una variable, no descubrirlo cuando la necesite (SRS-DIST-10).
 */
const envSchema = baseEnvSchema.extend({
  AUTH_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DB_AUTH_USER: z.string().min(1),
  DB_AUTH_PASSWORD: z.string().min(1),

  ARGON2_MEMORY_COST: z.coerce.number().int().min(19456).default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().min(2).default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).default(1),

  JWT_PRIVATE_KEY: z.string().min(1),
  JWT_PUBLIC_KEY: z.string().min(1),
  // Tope de 15 minutos: el brief lo exige y el esquema lo hace cumplir, para
  // que nadie lo alargue por comodidad en una variable de entorno.
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).default(604800),
  REFRESH_COOKIE_NAME: z.string().min(1).default('pa_refresh'),
  REFRESH_COOKIE_SECURE: z.enum(['true', 'false']).default('true'),

  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
  LOGIN_LOCKOUT_BASE_SECONDS: z.coerce.number().int().min(1).default(30),
  LOGIN_LOCKOUT_MAX_SECONDS: z.coerce.number().int().min(1).default(3600),
  LOGIN_ATTEMPT_WINDOW_SECONDS: z.coerce.number().int().min(60).default(900),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).default(10),
});

/** Registro estructurado en JSON, con el identificador de correlacion (RNF77). */
const logger = {
  info(mensaje: string, contexto: Record<string, unknown> = {}): void {
    // eslint-disable-next-line no-console
    console.warn(JSON.stringify({ level: 'info', service: 'auth-service', mensaje, ...contexto }));
  },
  error(mensaje: string, contexto: Record<string, unknown> = {}): void {
    console.error(JSON.stringify({ level: 'error', service: 'auth-service', mensaje, ...contexto }));
  },
};

export function buildContainer(env: z.infer<typeof envSchema>) {
  const knex = knexLib({
    client: 'mysql2',
    connection: {
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      user: env.DB_AUTH_USER,
      password: env.DB_AUTH_PASSWORD,
      database: 'pa_auth',
      timezone: 'Z',
      charset: 'utf8mb4',
    },
    pool: { min: 2, max: 10 },
  });

  const usuarios = new KnexUsuarioRepository(knex);
  const sesiones = new KnexSessionRepository(knex);
  const hasher = new Argon2PasswordHasher({
    memoryCost: env.ARGON2_MEMORY_COST,
    timeCost: env.ARGON2_TIME_COST,
    parallelism: env.ARGON2_PARALLELISM,
  });
  const tokens = new JwtTokenService({
    // Las claves llegan del entorno con \n escapado; hay que restituirlos o
    // el formato PEM no es valido.
    privateKey: env.JWT_PRIVATE_KEY.replace(/\\n/gu, '\n'),
    publicKey: env.JWT_PUBLIC_KEY.replace(/\\n/gu, '\n'),
    accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
    refreshTtlSeconds: env.REFRESH_TOKEN_TTL_SECONDS,
    issuer: 'punto-amigo/auth',
    audience: 'punto-amigo',
  });
  const lockout = new KnexLockoutPolicy(knex, {
    maxAttempts: env.LOGIN_MAX_ATTEMPTS,
    baseSeconds: env.LOGIN_LOCKOUT_BASE_SECONDS,
    maxSeconds: env.LOGIN_LOCKOUT_MAX_SECONDS,
    windowSeconds: env.LOGIN_ATTEMPT_WINDOW_SECONDS,
  });
  const eventos = new OutboxEventPublisher('auth-service');
  const clock = new SystemClock();

  const app = createApp({
    knex,
    registrar: new RegisterUserUseCase(usuarios, hasher, eventos, clock),
    autenticar: new AuthenticateUserUseCase(
      usuarios,
      hasher,
      tokens,
      sesiones,
      lockout,
      eventos,
      clock
    ),
    sesiones,
    tokens,
    logger,
    config: {
      corsOrigin: env.CORS_ORIGIN,
      bodyLimit: env.REQUEST_BODY_LIMIT,
      isProduction: env.NODE_ENV === 'production',
      rateLimit: {
        windowMs: env.RATE_LIMIT_WINDOW_MS,
        maxPerIp: env.RATE_LIMIT_MAX_PER_IP,
        authMax: env.RATE_LIMIT_AUTH_MAX,
      },
      refreshCookie: {
        name: env.REFRESH_COOKIE_NAME,
        secure: env.REFRESH_COOKIE_SECURE === 'true',
        maxAgeMs: env.REFRESH_TOKEN_TTL_SECONDS * 1000,
      },
    },
  });

  return { app, knex };
}

async function main(): Promise<void> {
  const env = loadEnv(envSchema);
  assertProductionSafety(env);

  const { app, knex } = buildContainer(env);

  const servidor = app.listen(env.AUTH_PORT, () => {
    logger.info('auth-service escuchando', { puerto: env.AUTH_PORT, entorno: env.NODE_ENV });
  });

  /**
   * Cierre ordenado: deja de aceptar conexiones, termina las que estan en curso
   * y cierra el pool. Sin esto, un redespliegue corta peticiones a medias y
   * puede dejar transacciones abiertas.
   */
  const cerrar = (senal: string): void => {
    logger.info('cerrando', { senal });
    servidor.close(() => {
      void knex.destroy().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => cerrar('SIGTERM'));
  process.on('SIGINT', () => cerrar('SIGINT'));
}

// Solo arranca cuando se ejecuta directamente: importarlo desde una prueba no
// debe levantar un servidor.
if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error('fallo al arrancar', {
      mensaje: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}

export { envSchema };
