import knexLib from 'knex';
import type { Express } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import {
  EventName,
  assertProductionSafety,
  baseEnvSchema,
  enteroONulo,
  esVacio,
  loadEnv,
} from '@punto-amigo/shared';
import { Broker, EventConsumer, OutboxRelay } from '@punto-amigo/messaging';
import {
  OutboxEventPublisher,
  SystemClock,
  runInTransaction,
  useTransaction,
} from '@punto-amigo/service-kit';
import { PeriodoCiego, type Faceta } from './domain';
import { ReputationRecalculator } from './application/ReputationRecalculator';
import { SubmitRatingUseCase } from './application/use-cases/SubmitRating';
import { QueryReputationUseCase } from './application/use-cases/QueryReputation';
import { TrackCancellationRateUseCase } from './application/use-cases/TrackCancellationRate';
import { KnexCalificacionRepository } from './infrastructure/persistence/KnexCalificacionRepository';
import {
  KnexReputacionRepository,
  KnexSolicitudRefRepository,
  KnexTasaCancelacionRepository,
} from './infrastructure/persistence/KnexReputationRepositories';
import { createApp } from './infrastructure/http/app';

const envSchema = baseEnvSchema.extend({
  RATING_PORT: z.coerce.number().int().min(1).max(65535).default(3005),
  DB_RATING_USER: z.string().min(1),
  DB_RATING_PASSWORD: z.string().min(1),

  // Parametros del sistema (SRS RF105), no constantes de negocio: se
  // recalibran con datos reales.
  BLIND_PERIOD_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  CANCEL_WINDOW_DAYS: z.coerce.number().int().min(7).max(365).default(90),
  // Cada cuanto se levantan los periodos ciegos vencidos, y cuantos por vuelta.
  BLIND_SWEEP_MS: z.coerce.number().int().min(10_000).default(300_000),
  BLIND_SWEEP_BATCH: z.coerce.number().int().min(1).max(500).default(100),

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
    console.warn(
      JSON.stringify({ level: 'info', service: 'rating-service', mensaje, ...contexto })
    );
  },
  error(mensaje: string, contexto: Record<string, unknown> = {}): void {
    console.error(
      JSON.stringify({ level: 'error', service: 'rating-service', mensaje, ...contexto })
    );
  },
};

export function buildContainer(env: z.infer<typeof envSchema>): {
  app: Express;
  knex: Knex;
  calificar: SubmitRatingUseCase;
  cancelaciones: TrackCancellationRateUseCase;
  solicitudes: KnexSolicitudRefRepository;
} {
  const knex = knexLib({
    client: 'mysql2',
    connection: {
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      user: env.DB_RATING_USER,
      password: env.DB_RATING_PASSWORD,
      database: 'pa_rating',
      timezone: 'Z',
      charset: 'utf8mb4',
    },
    pool: { min: 2, max: 10 },
  });

  const calificaciones = new KnexCalificacionRepository(knex);
  const reputaciones = new KnexReputacionRepository(knex);
  const tasas = new KnexTasaCancelacionRepository(knex);
  const solicitudes = new KnexSolicitudRefRepository(knex);
  const eventos = new OutboxEventPublisher('rating-service');
  const clock = new SystemClock();

  const recalculador = new ReputationRecalculator(calificaciones, reputaciones, eventos, clock);
  const calificar = new SubmitRatingUseCase(
    calificaciones,
    recalculador,
    solicitudes,
    new PeriodoCiego(env.BLIND_PERIOD_DAYS),
    eventos,
    clock
  );
  const consultar = new QueryReputationUseCase(calificaciones, reputaciones, tasas, recalculador);
  const cancelaciones = new TrackCancellationRateUseCase(
    tasas,
    eventos,
    clock,
    env.CANCEL_WINDOW_DAYS
  );

  const app = createApp({
    knex,
    calificar,
    consultar,
    logger,
    config: {
      corsOrigin: env.CORS_ORIGIN,
      bodyLimit: env.REQUEST_BODY_LIMIT,
      isProduction: env.NODE_ENV === 'production',
      internalSecret: env.INTERNAL_SERVICE_SECRET,
      rateLimit: { windowMs: env.RATE_LIMIT_WINDOW_MS, maxPerIp: env.RATE_LIMIT_MAX_PER_IP },
    },
  });

  return { app, knex, calificar, cancelaciones, solicitudes };
}

async function main(): Promise<void> {
  const env = loadEnv(envSchema);
  assertProductionSafety(env);

  const { app, knex, calificar, cancelaciones, solicitudes } = buildContainer(env);

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
      contexto: 'rating',
    },
    logger
  );

  const consumidor = new EventConsumer(
    knex,
    broker,
    {
      cola: 'rating-service.solicitudes',
      patrones: ['request.solicitud.*'],
      consumidor: 'rating-service',
      prefetch: env.CONSUMER_PREFETCH,
    },
    logger
  );

  /** Replica de la solicitud, con el estado que traiga el evento. */
  const replicar = async (
    sobre: { payload: Record<string, unknown> },
    estado: string,
    completadaAt: Date | null
  ): Promise<void> => {
    const p = sobre.payload;
    await solicitudes.upsert(
      {
        idSolicitud: Number(p['idSolicitud']),
        idUsuario: Number(p['idUsuario']),
        idUsuarioPrestador: Number(p['idUsuarioPrestador']),
        idServicio: enteroONulo(p['idServicio']),
        estado,
        completadaAt,
      },
      Number(p['idPrestador'] ?? 0)
    );
  };

  for (const evento of [
    EventName.ServiceRequestCreated,
    EventName.ServiceRequestAccepted,
    EventName.ServiceRequestRejected,
  ]) {
    consumidor.on(evento, async (sobre, trx) => {
      await useTransaction(trx, () =>
        replicar(sobre, String(sobre.payload['estado'] ?? 'PENDIENTE'), null)
      );
    });
  }

  /**
   * Completada: habilita calificar y suma al DENOMINADOR de la tasa.
   *
   * Recalcular aqui es lo que permite que la tasa BAJE. Sin este camino, quien
   * cruzo un umbral se quedaria marcado hasta su siguiente cancelacion, y el
   * unico modo de mejorar seria cancelar otra vez.
   */
  consumidor.on(EventName.ServiceRequestCompleted, async (sobre, trx) => {
    const p = sobre.payload;
    await useTransaction(trx, async () => {
      await replicar(sobre, 'COMPLETADA', new Date(sobre.occurredAt));

      for (const [idUsuario, faceta] of [
        [Number(p['idUsuarioPrestador']), 'COMO_OFERENTE'],
        [Number(p['idUsuario']), 'COMO_SOLICITANTE'],
      ] as [number, Faceta][]) {
        await cancelaciones.alCerrarContratacion({
          idUsuario,
          faceta,
          correlationId: sobre.correlationId,
        });
      }
    });
  });

  /**
   * Cancelada: el peso y a quien se le carga llegan YA RESUELTOS.
   *
   * Este servicio no vuelve a clasificar. La politica vive en request-service,
   * que es dueno del hecho; recalcularla aqui crearia dos copias que divergirian
   * en cuanto alguien ajustara un umbral.
   */
  consumidor.on(EventName.ServiceRequestCancelled, async (sobre, trx) => {
    const p = sobre.payload;
    const imputado = p['idUsuarioImputado'];

    await useTransaction(trx, async () => {
      await replicar(sobre, 'CANCELADA', null);

      // Sin imputado no hay a quien cargarle nada: cancelacion en gracia,
      // excusada o pendiente de revision. Se sale sin tocar la tasa.
      if (esVacio(imputado)) return;

      await cancelaciones.alCancelar({
        cancelacion: {
          idCancelacion: Number(p['idCancelacion']),
          idSolicitud: Number(p['idSolicitud']),
          idUsuarioImputado: Number(imputado),
          faceta: String(p['faceta']) as Faceta,
          peso: Number(p['peso'] ?? 0),
          computa: p['computa'] === true,
          canceladaAt: new Date(String(p['canceladaAt'] ?? sobre.occurredAt)),
        },
        correlationId: sobre.correlationId,
      });
    });
  });

  try {
    await broker.conectar();
    await consumidor.iniciar();
  } catch (error) {
    logger.error('broker no disponible al arrancar; se reintenta en segundo plano', {
      mensaje: error instanceof Error ? error.message : String(error),
    });
  }
  relevo.iniciar();

  /**
   * Barrido de periodos ciegos vencidos (SRS RF166).
   *
   * Vive dentro del proceso y no como tarea aparte: necesita el mismo dominio y
   * la misma base, y separarlo anadiria un despliegue mas sin desacoplar nada.
   * `unref` evita que el temporizador mantenga vivo el proceso al cerrar.
   */
  const barrido = setInterval(() => {
    void runInTransaction(knex, () =>
      calificar.vencerPeriodosCiegos({
        lote: env.BLIND_SWEEP_BATCH,
        correlationId: '00000000-0000-4000-8000-000000000000',
      })
    )
      .then((cuantas) => {
        if (cuantas > 0) logger.info('periodos ciegos vencidos', { cuantas });
      })
      .catch((error: unknown) => {
        logger.error('fallo al vencer periodos ciegos', {
          mensaje: error instanceof Error ? error.message : String(error),
        });
      });
  }, env.BLIND_SWEEP_MS);
  barrido.unref();

  const servidor = app.listen(env.RATING_PORT, () => {
    logger.info('rating-service escuchando', { puerto: env.RATING_PORT, entorno: env.NODE_ENV });
  });

  const cerrar = (senal: string): void => {
    logger.info('cerrando', { senal });
    clearInterval(barrido);
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

if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error('fallo al arrancar', {
      mensaje: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}

export { envSchema };
