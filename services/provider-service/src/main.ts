import knexLib from 'knex';
import { z } from 'zod';
import {
  EventName,
  assertProductionSafety,
  baseEnvSchema,
  loadEnv,
} from '@punto-amigo/shared';
import { Broker, EventConsumer, OutboxRelay } from '@punto-amigo/messaging';
import { OutboxEventPublisher, SystemClock, useTransaction } from '@punto-amigo/service-kit';
import { ManageProviderProfileUseCase } from './application/use-cases/ManageProviderProfile';
import { ReviewProviderProfileUseCase } from './application/use-cases/ReviewProviderProfile';
import { SyncAccountStateUseCase } from './application/use-cases/SyncAccountState';
import { KnexPrestadorRepository } from './infrastructure/persistence/KnexPrestadorRepository';
import { KnexValidationLogRepository } from './infrastructure/persistence/KnexValidationLogRepository';
import { createApp } from './infrastructure/http/app';

/**
 * Configuracion del servicio, sobre la base comun.
 *
 * Todo se valida al arrancar: un servicio debe negarse a levantar si le falta
 * una variable, no descubrirlo cuando la necesite (SRS-DIST-10).
 */
const envSchema = baseEnvSchema.extend({
  PROVIDER_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
  DB_PROVIDER_USER: z.string().min(1),
  DB_PROVIDER_PASSWORD: z.string().min(1),

  RABBITMQ_HOST: z.string().min(1),
  RABBITMQ_PORT: z.coerce.number().int().min(1).max(65535).default(5672),
  RABBITMQ_USER: z.string().min(1),
  RABBITMQ_PASSWORD: z.string().min(1),
  RABBITMQ_EXCHANGE: z.string().min(1).default('punto-amigo.events'),
  BROKER_MAX_RETRIES: z.coerce.number().int().min(1).default(5),
  OUTBOX_POLL_MS: z.coerce.number().int().min(100).default(1000),
  OUTBOX_BATCH: z.coerce.number().int().min(1).max(500).default(50),
  CONSUMER_PREFETCH: z.coerce.number().int().min(1).max(100).default(10),
});

const logger = {
  info(mensaje: string, contexto: Record<string, unknown> = {}): void {
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({ level: 'info', service: 'provider-service', mensaje, ...contexto })
    );
  },
  error(mensaje: string, contexto: Record<string, unknown> = {}): void {
    console.error(
      JSON.stringify({ level: 'error', service: 'provider-service', mensaje, ...contexto })
    );
  },
};

export function buildContainer(env: z.infer<typeof envSchema>) {
  const knex = knexLib({
    client: 'mysql2',
    connection: {
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      user: env.DB_PROVIDER_USER,
      password: env.DB_PROVIDER_PASSWORD,
      database: 'pa_provider',
      timezone: 'Z',
      charset: 'utf8mb4',
    },
    pool: { min: 2, max: 10 },
  });

  const prestadores = new KnexPrestadorRepository(knex);
  const bitacora = new KnexValidationLogRepository(knex);
  const eventos = new OutboxEventPublisher('provider-service');
  const clock = new SystemClock();

  const perfiles = new ManageProviderProfileUseCase(prestadores, bitacora, eventos, clock);
  const revision = new ReviewProviderProfileUseCase(prestadores, bitacora, eventos, clock);
  const sincronizacion = new SyncAccountStateUseCase(prestadores, bitacora, eventos, clock);

  const app = createApp({
    knex,
    perfiles,
    revision,
    logger,
    config: {
      corsOrigin: env.CORS_ORIGIN,
      bodyLimit: env.REQUEST_BODY_LIMIT,
      isProduction: env.NODE_ENV === 'production',
      internalSecret: env.INTERNAL_SERVICE_SECRET,
      rateLimit: { windowMs: env.RATE_LIMIT_WINDOW_MS, maxPerIp: env.RATE_LIMIT_MAX_PER_IP },
    },
  });

  return { app, knex, sincronizacion };
}

async function main(): Promise<void> {
  const env = loadEnv(envSchema);
  assertProductionSafety(env);

  const { app, knex, sincronizacion } = buildContainer(env);

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

  const relevo = new OutboxRelay(
    knex,
    broker,
    {
      intervaloMs: env.OUTBOX_POLL_MS,
      lote: env.OUTBOX_BATCH,
      maxIntentos: env.BROKER_MAX_RETRIES,
      contexto: 'provider',
    },
    logger
  );

  /**
   * Consumidor de la suspension de cuentas (SRS RF32).
   *
   * Se suscribe solo al patron que necesita y no a `iam.#`: una cola que recibe
   * todos los eventos de identidad tendria que descartar la mayoria, y cada
   * descarte es trabajo y una entrada en la cola de fallidos si algo falla.
   *
   * El manejador NO abre su propia transaccion: recibe la del consumidor, que
   * es la que tambien escribe la marca de "ya procesado". Separarlas haria que
   * un fallo entre ambas dejara el efecto sin marca, y se repetiria.
   */
  const consumidor = new EventConsumer(
    knex,
    broker,
    {
      cola: 'provider-service.iam',
      patrones: ['iam.usuario.user_account_suspended'],
      consumidor: 'provider-service',
      prefetch: env.CONSUMER_PREFETCH,
    },
    logger
  );

  consumidor.on(EventName.UserAccountSuspended, async (sobre, trx) => {
    await useTransaction(trx, () =>
      sincronizacion.alSuspenderCuenta({
        idUsuario: Number(sobre.payload['userId']),
        motivo: String(sobre.payload['reason'] ?? 'CUENTA_SUSPENDIDA'),
        correlationId: sobre.correlationId,
      })
    );
  });

  /**
   * Que el broker no este disponible NO impide arrancar.
   *
   * Los eventos que este servicio produce se acumulan en el outbox y salen
   * cuando vuelva. Los que consume se quedan en la cola de RabbitMQ, que es
   * duradera. Negarse a levantar convertiria una caida del broker en una caida
   * del catalogo de prestadores, que se consulta sin necesitar eventos.
   */
  try {
    await broker.conectar();
    await consumidor.iniciar();
  } catch (error) {
    logger.error('broker no disponible al arrancar; se reintenta en segundo plano', {
      mensaje: error instanceof Error ? error.message : String(error),
    });
  }
  relevo.iniciar();

  const servidor = app.listen(env.PROVIDER_PORT, () => {
    logger.info('provider-service escuchando', {
      puerto: env.PROVIDER_PORT,
      entorno: env.NODE_ENV,
    });
  });

  /**
   * Cierre ordenado. El relevo se detiene antes que la base: cortarlo a la
   * mitad dejaria eventos publicados sin marcar, que luego se reenviarian.
   */
  const cerrar = (senal: string): void => {
    logger.info('cerrando', { senal });
    servidor.close(() => {
      void relevo
        .detener()
        .then(() => broker.cerrar())
        .then(() => knex.destroy())
        .then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => cerrar('SIGTERM'));
  process.on('SIGINT', () => cerrar('SIGINT'));
}

// Importarlo desde una prueba no debe levantar un servidor.
if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error('fallo al arrancar', {
      mensaje: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}

export { envSchema };
