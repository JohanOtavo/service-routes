import { crearLogger, type Metricas } from '@punto-amigo/service-kit';
import Redis from 'ioredis';
import express, { type Express } from 'express';
import { z } from 'zod';
import { baseEnvSchema, loadEnv, assertProductionSafety } from '@punto-amigo/shared';
import { createGateway } from './http/app';
import { CircuitBreaker } from './proxy/CircuitBreaker';
import { RedisDenylist, TokenVerifier } from './security/TokenVerifier';
import { RUTAS } from './config/routes';

const envSchema = baseEnvSchema.extend({
  GATEWAY_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  /**
   * Puerto de las metricas, que NO se publica.
   *
   * Las metricas van en su propio puerto porque el 8080 si esta publicado:
   * servirlas ahi dejaria ver el inventario de rutas, su frecuencia de uso y el
   * estado del proceso a cualquiera. Los otros ocho servicios no necesitan esto
   * porque ninguno publica su puerto.
   */
  GATEWAY_METRICS_PORT: z.coerce.number().int().min(1).max(65535).default(9090),

  // Solo la clave PUBLICA. El gateway verifica; no emite.
  JWT_PUBLIC_KEY: z.string().min(1),

  UPSTREAM_AUTH_URL: z.string().url(),
  UPSTREAM_PROVIDER_URL: z.string().url().optional(),
  UPSTREAM_CATALOG_URL: z.string().url().optional(),
  UPSTREAM_REQUEST_URL: z.string().url().optional(),
  UPSTREAM_RATING_URL: z.string().url().optional(),
  UPSTREAM_NOTIFICATION_URL: z.string().url().optional(),
  UPSTREAM_ADMIN_URL: z.string().url().optional(),

  GATEWAY_UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(100).max(30000).default(2000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).default(10),
});

const logger = crearLogger('api-gateway');

export function buildGateway(env: z.infer<typeof envSchema>): {
  app: Express;
  redis: Redis;
  metricas: Metricas;
} {
  const redis = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    // Sin reintentos infinitos: la lista de denegacion falla cerrado, asi que
    // es preferible un error rapido a una peticion colgada.
    maxRetriesPerRequest: 2,
    lazyConnect: false,
  });
  redis.on('error', (error: Error) => {
    logger.error('redis no disponible', { mensaje: error.message });
  });

  const verifier = new TokenVerifier(
    {
      publicKey: env.JWT_PUBLIC_KEY.replace(/\\n/gu, '\n'),
      issuer: 'punto-amigo/auth',
      audience: 'punto-amigo',
    },
    new RedisDenylist(redis)
  );

  /**
   * Se registran solo los servicios cuya URL esta configurada.
   *
   * Los que aun no existen quedan fuera del mapa, y una peticion a su prefijo
   * responde 503 con un mensaje claro en lugar de fallar al arrancar. Asi el
   * gateway puede desplegarse antes que el resto (SRS-GW-09).
   */
  const upstreams: Record<string, string> = {};
  for (const ruta of RUTAS) {
    const url = (env as unknown as Record<string, string | undefined>)[ruta.variableUrl];
    if (url !== undefined) upstreams[ruta.servicio] = url;
  }

  const configurados = Object.keys(upstreams);
  const pendientes = [...new Set(RUTAS.map((r) => r.servicio))].filter(
    (s) => !configurados.includes(s)
  );
  if (pendientes.length > 0) {
    logger.info('servicios sin configurar; sus rutas responderan 503', { pendientes });
  }

  const { app, metricas } = createGateway({
    verifier,
    breaker: new CircuitBreaker(),
    logger,
    upstreams,
    config: {
      corsOrigin: env.CORS_ORIGIN,
      bodyLimit: env.REQUEST_BODY_LIMIT,
      isProduction: env.NODE_ENV === 'production',
      secretoInterno: env.INTERNAL_SERVICE_SECRET,
      timeoutMs: env.GATEWAY_UPSTREAM_TIMEOUT_MS,
      rateLimit: {
        windowMs: env.RATE_LIMIT_WINDOW_MS,
        maxPerIp: env.RATE_LIMIT_MAX_PER_IP,
        maxPerUser: env.RATE_LIMIT_MAX_PER_USER,
        authMax: env.RATE_LIMIT_AUTH_MAX,
      },
    },
  });

  return { app, redis, metricas };
}

async function main(): Promise<void> {
  const env = loadEnv(envSchema);
  assertProductionSafety(env);

  const { app, redis, metricas } = buildGateway(env);

  const servidor = app.listen(env.GATEWAY_PORT, () => {
    logger.info('api-gateway escuchando', { puerto: env.GATEWAY_PORT, entorno: env.NODE_ENV });
  });

  // Servidor aparte, en un puerto que no se publica: ver GATEWAY_METRICS_PORT.
  const metricasApp = express();
  metricasApp.get('/metrics', (req, res) => void metricas.exponer(req, res));
  const servidorMetricas = metricasApp.listen(env.GATEWAY_METRICS_PORT, () => {
    logger.info('metricas del gateway escuchando', { puerto: env.GATEWAY_METRICS_PORT });
  });

  const cerrar = (senal: string): void => {
    logger.info('cerrando', { senal });
    servidorMetricas.close();
    servidor.close(() => {
      void redis.quit().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => cerrar('SIGTERM'));
  process.on('SIGINT', () => cerrar('SIGINT'));
}

if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error('fallo al arrancar', {
      mensaje: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}

export { envSchema };
