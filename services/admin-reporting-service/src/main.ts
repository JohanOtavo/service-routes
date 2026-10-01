import knexLib from 'knex';
import { z } from 'zod';
import { EventName, assertProductionSafety, baseEnvSchema, loadEnv } from '@punto-amigo/shared';
import { Broker, EventConsumer } from '@punto-amigo/messaging';
import { SystemClock, useTransaction } from '@punto-amigo/service-kit';
import { QueryAuditTrailUseCase } from './application/use-cases/QueryAuditTrail';
import { RecordAuditTrailUseCase } from './application/use-cases/RecordAuditTrail';
import { ManageReportsUseCase } from './application/use-cases/ManageReports';
import { KnexAuditRepository } from './infrastructure/persistence/KnexAdminRepositories';
import {
  KnexBackupRepository,
  KnexParameterRepository,
  KnexStatisticsRepository,
} from './infrastructure/persistence/KnexSupportRepositories';
import { createApp } from './infrastructure/http/app';

const envSchema = baseEnvSchema.extend({
  ADMIN_PORT: z.coerce.number().int().min(1).max(65535).default(3007),
  DB_ADMIN_USER: z.string().min(1),
  DB_ADMIN_PASSWORD: z.string().min(1),

  RABBITMQ_HOST: z.string().min(1),
  RABBITMQ_PORT: z.coerce.number().int().min(1).max(65535).default(5672),
  RABBITMQ_USER: z.string().min(1),
  RABBITMQ_PASSWORD: z.string().min(1),
  RABBITMQ_EXCHANGE: z.string().min(1).default('punto-amigo.events'),
  BROKER_MAX_RETRIES: z.coerce.number().int().min(1).default(5),
  CONSUMER_PREFETCH: z.coerce.number().int().min(1).max(100).default(10),
});

const logger = {
  info(mensaje: string, contexto: Record<string, unknown> = {}): void {
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({ level: 'info', service: 'admin-reporting-service', mensaje, ...contexto })
    );
  },
  error(mensaje: string, contexto: Record<string, unknown> = {}): void {
    console.error(
      JSON.stringify({ level: 'error', service: 'admin-reporting-service', mensaje, ...contexto })
    );
  },
};

export function buildContainer(env: z.infer<typeof envSchema>) {
  const knex = knexLib({
    client: 'mysql2',
    connection: {
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      user: env.DB_ADMIN_USER,
      password: env.DB_ADMIN_PASSWORD,
      database: 'pa_admin',
      timezone: 'Z',
      charset: 'utf8mb4',
    },
    pool: { min: 2, max: 10 },
  });

  const auditoria = new KnexAuditRepository(knex);
  const parametros = new KnexParameterRepository(knex);
  const estadisticas = new KnexStatisticsRepository(knex);
  const respaldos = new KnexBackupRepository(knex);
  const clock = new SystemClock();

  const registrar = new RecordAuditTrailUseCase(auditoria);

  const app = createApp({
    knex,
    bitacora: new QueryAuditTrailUseCase(auditoria),
    informes: new ManageReportsUseCase(auditoria, parametros, estadisticas, respaldos, clock),
    logger,
    config: {
      corsOrigin: env.CORS_ORIGIN,
      bodyLimit: env.REQUEST_BODY_LIMIT,
      isProduction: env.NODE_ENV === 'production',
      internalSecret: env.INTERNAL_SERVICE_SECRET,
      rateLimit: { windowMs: env.RATE_LIMIT_WINDOW_MS, maxPerIp: env.RATE_LIMIT_MAX_PER_IP },
    },
  });

  return { app, knex, registrar };
}

async function main(): Promise<void> {
  const env = loadEnv(envSchema);
  assertProductionSafety(env);

  const { app, knex, registrar } = buildContainer(env);

  const broker = new Broker(
    {
      host: env.RABBITMQ_HOST,
      port: env.RABBITMQ_PORT,
      user: env.RABBITMQ_USER,
      password: env.RABBITMQ_PASSWORD,
      exchange: env.RABBITMQ_EXCHANGE,
      maxRetries: env.BROKER_MAX_RETRIES,
    },
    logger
  );

  /**
   * Este servicio no publica eventos, asi que no lleva relevo de outbox: la
   * auditoria es el final de una cadena, no el principio de otra.
   */
  const consumidor = new EventConsumer(
    knex,
    broker,
    {
      cola: 'admin-reporting-service.auditoria',
      patrones: ['iam.#', 'provider.#'],
      consumidor: 'admin-reporting-service',
      prefetch: env.CONSUMER_PREFETCH,
    },
    logger
  );

  consumidor.on(EventName.UserAccountSuspended, async (sobre, trx) => {
    await useTransaction(trx, () => registrar.alSuspenderCuenta(sobre));
  });

  consumidor.on(EventName.UserRoleAssigned, async (sobre, trx) => {
    await useTransaction(trx, () => registrar.alAsignarRol(sobre));
  });

  consumidor.on(EventName.ProviderStatusChanged, async (sobre, trx) => {
    await useTransaction(trx, () => registrar.alCambiarEstadoPrestador(sobre));
  });

  try {
    await broker.conectar();
    await consumidor.iniciar();
  } catch (error) {
    // Arranca igual: la bitacora ya escrita se puede consultar sin broker, y
    // los eventos nuevos esperan en su cola, que es duradera.
    logger.error('broker no disponible al arrancar; se reintenta en segundo plano', {
      mensaje: error instanceof Error ? error.message : String(error),
    });
  }

  const servidor = app.listen(env.ADMIN_PORT, () => {
    logger.info('admin-reporting-service escuchando', {
      puerto: env.ADMIN_PORT,
      entorno: env.NODE_ENV,
    });
  });

  const cerrar = (senal: string): void => {
    logger.info('cerrando', { senal });
    servidor.close(() => {
      void broker
        .cerrar()
        .then(() => knex.destroy())
        .then(() => process.exit(0));
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
