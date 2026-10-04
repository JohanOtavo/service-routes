import knexLib from 'knex';
import type { Express } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import { EventName, assertProductionSafety, baseEnvSchema, loadEnv } from '@punto-amigo/shared';
import { Broker, EventConsumer } from '@punto-amigo/messaging';
import { SystemClock, crearLogger, useTransaction } from '@punto-amigo/service-kit';
import { QueryAuditTrailUseCase } from './application/use-cases/QueryAuditTrail';
import { RecordAuditTrailUseCase } from './application/use-cases/RecordAuditTrail';
import { ManageReportsUseCase } from './application/use-cases/ManageReports';
import { KnexAuditRepository } from './infrastructure/persistence/KnexAdminRepositories';
import {
  KnexBackupRepository,
  KnexParameterRepository,
  KnexStatisticsRepository,
  KnexStatisticsSourceRepository,
} from './infrastructure/persistence/KnexSupportRepositories';
import { CalculateStatisticsUseCase } from './application/use-cases/CalculateStatistics';
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

  /**
   * Recalculo de `statistics_snapshot` (A-3).
   *
   * Cada hora por defecto, y no cada minuto: las series son diarias, asi que
   * recalcular mas a menudo no cambia ninguna cifra y solo agrega la tabla de
   * auditoria otra vez.
   *
   * La ventana es de 2 dias, no de 1. Un asiento con `ocurrido_at` de ayer que
   * se registre hoy —el campo es "cuando paso", no "cuando se registro"— solo
   * entra en la cifra si el dia de ayer se vuelve a mirar.
   */
  STATS_SWEEP_MS: z.coerce.number().int().min(60_000).default(3_600_000),
  STATS_WINDOW_DAYS: z.coerce.number().int().min(1).max(90).default(2),
});

const logger = crearLogger('admin-reporting-service');

export function buildContainer(env: z.infer<typeof envSchema>): {
  app: Express;
  knex: Knex;
  registrar: RecordAuditTrailUseCase;
  calcular: CalculateStatisticsUseCase;
} {
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
  const fuenteEstadisticas = new KnexStatisticsSourceRepository(knex);
  const respaldos = new KnexBackupRepository(knex);
  const clock = new SystemClock();

  const registrar = new RecordAuditTrailUseCase(auditoria);
  const calcular = new CalculateStatisticsUseCase(estadisticas, fuenteEstadisticas, clock);

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

  return { app, knex, registrar, calcular };
}

async function main(): Promise<void> {
  const env = loadEnv(envSchema);
  assertProductionSafety(env);

  const { app, knex, registrar, calcular } = buildContainer(env);

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

  /**
   * Recalculo periodico de las series (A-3).
   *
   * Vive en este proceso y no como tarea aparte por el mismo motivo que el
   * barrido de rating-service: es el unico que tiene credenciales sobre
   * `pa_admin`, y un cron externo necesitaria una segunda copia de ellas.
   *
   * `unref()` para que el temporizador no sea lo que mantenga vivo al proceso.
   * No hay guarda anti-solape porque el intervalo minimo es de un minuto y el
   * recalculo son dos agregados sobre indices; si eso dejara de ser cierto, el
   * patron a copiar es el `ejecutando` de `OutboxRelay`.
   */
  const recalcular = (): void => {
    void calcular
      .recalcular({ dias: env.STATS_WINDOW_DAYS })
      .then((puntos) => {
        if (puntos > 0) logger.info('series recalculadas', { puntos });
      })
      .catch((error: unknown) => {
        // Un fallo aqui no tumba el servicio: los informes se quedan con la
        // ultima cifra buena, que es mejor que no poder consultar la bitacora.
        logger.error('fallo el recalculo de series', {
          mensaje: error instanceof Error ? error.message : String(error),
        });
      });
  };

  // Una pasada al arrancar: si no, un despliegue reciente deja los informes
  // vacios hasta que venza el primer intervalo, que por defecto es una hora.
  recalcular();
  const barridoEstadisticas = setInterval(recalcular, env.STATS_SWEEP_MS);
  barridoEstadisticas.unref();

  const servidor = app.listen(env.ADMIN_PORT, () => {
    logger.info('admin-reporting-service escuchando', {
      puerto: env.ADMIN_PORT,
      entorno: env.NODE_ENV,
    });
  });

  const cerrar = (senal: string): void => {
    logger.info('cerrando', { senal });
    clearInterval(barridoEstadisticas);
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
