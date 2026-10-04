import knexLib from 'knex';
import type { Express } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import {
  EventName,
  assertProductionSafety,
  baseEnvSchema,
  enteroONulo,
  loadEnv,
} from '@punto-amigo/shared';
import { Broker, EventConsumer, OutboxRelay } from '@punto-amigo/messaging';
import { OutboxEventPublisher, crearLogger, useTransaction } from '@punto-amigo/service-kit';
import { ManageServiceCatalogUseCase } from './application/use-cases/ManageServiceCatalog';
import { ManageCategoriesUseCase } from './application/use-cases/ManageCategories';
import { SearchCatalogUseCase } from './application/use-cases/SearchCatalog';
import { SyncProviderRefUseCase } from './application/use-cases/SyncProviderRef';
import { SyncRatingSummaryUseCase } from './application/use-cases/SyncRatingSummary';
import { KnexServicioRepository } from './infrastructure/persistence/KnexServicioRepository';
import { KnexCategoriaRepository } from './infrastructure/persistence/KnexCategoriaRepository';
import { KnexPrestadorRefRepository } from './infrastructure/persistence/KnexPrestadorRefRepository';
import { KnexRatingSummaryRepository } from './infrastructure/persistence/KnexRatingSummaryRepository';
import { createApp } from './infrastructure/http/app';
import type { EstadoPrestador } from './domain';

const envSchema = baseEnvSchema.extend({
  CATALOG_PORT: z.coerce.number().int().min(1).max(65535).default(3003),
  DB_CATALOG_USER: z.string().min(1),
  DB_CATALOG_PASSWORD: z.string().min(1),

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

const logger = crearLogger('catalog-service');

export function buildContainer(env: z.infer<typeof envSchema>): {
  app: Express;
  knex: Knex;
  sincronizarPrestador: SyncProviderRefUseCase;
  sincronizarResumen: SyncRatingSummaryUseCase;
} {
  const knex = knexLib({
    client: 'mysql2',
    connection: {
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      user: env.DB_CATALOG_USER,
      password: env.DB_CATALOG_PASSWORD,
      database: 'pa_catalog',
      timezone: 'Z',
      charset: 'utf8mb4',
    },
    pool: { min: 2, max: 10 },
  });

  const servicios = new KnexServicioRepository(knex);
  const categorias = new KnexCategoriaRepository(knex);
  const prestadores = new KnexPrestadorRefRepository(knex);
  const resumenes = new KnexRatingSummaryRepository(knex);
  const eventos = new OutboxEventPublisher('catalog-service');

  const sincronizarPrestador = new SyncProviderRefUseCase(prestadores);
  const sincronizarResumen = new SyncRatingSummaryUseCase(resumenes);

  const app = createApp({
    knex,
    catalogo: new ManageServiceCatalogUseCase(servicios, categorias, prestadores, eventos),
    categorias: new ManageCategoriesUseCase(categorias, eventos),
    busqueda: new SearchCatalogUseCase(servicios),
    logger,
    config: {
      corsOrigin: env.CORS_ORIGIN,
      bodyLimit: env.REQUEST_BODY_LIMIT,
      isProduction: env.NODE_ENV === 'production',
      internalSecret: env.INTERNAL_SERVICE_SECRET,
      rateLimit: { windowMs: env.RATE_LIMIT_WINDOW_MS, maxPerIp: env.RATE_LIMIT_MAX_PER_IP },
    },
  });

  return { app, knex, sincronizarPrestador, sincronizarResumen };
}

async function main(): Promise<void> {
  const env = loadEnv(envSchema);
  assertProductionSafety(env);

  const { app, knex, sincronizarPrestador, sincronizarResumen } = buildContainer(env);

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
      contexto: 'catalog',
    },
    logger
  );

  const consumidor = new EventConsumer(
    knex,
    broker,
    {
      cola: 'catalog-service.replicas',
      patrones: ['provider.prestador.*', 'rating.calificacion.*', 'rating.reputacion.*'],
      consumidor: 'catalog-service',
      prefetch: env.CONSUMER_PREFETCH,
    },
    logger
  );

  /**
   * Alta y edicion del perfil traen nombre y especialidad, asi que refrescan la
   * replica entera.
   */
  for (const evento of [
    EventName.ServiceProviderProfileCreated,
    EventName.ServiceProviderProfileUpdated,
    EventName.ServiceProviderProfileValidated,
  ]) {
    consumidor.on(evento, async (sobre, trx) => {
      const p = sobre.payload;
      await useTransaction(trx, () =>
        sincronizarPrestador.alRefrescarPerfil({
          idPrestador: Number(p['idPrestador']),
          idUsuario: Number(p['idUsuario']),
          nombre: String(p['nombre'] ?? ''),
          especialidad: p['especialidad'] === undefined ? null : String(p['especialidad']),
          // Validar deja el perfil en ACTIVE; ese evento no lleva estado.
          estado: String(
            p['estado'] ??
              (sobre.eventName === EventName.ServiceProviderProfileValidated
                ? 'ACTIVE'
                : 'PENDING_VALIDATION')
          ) as EstadoPrestador,
          ocurridoAt: new Date(sobre.occurredAt),
        })
      );
    });
  }

  /**
   * `ProviderStatusChanged` solo trae el estado, por eso tiene su propio camino:
   * un refresco completo con nombre vacio dejaria el catalogo mostrando fichas
   * sin nombre cada vez que un administrador suspendiera a alguien.
   */
  consumidor.on(EventName.ProviderStatusChanged, async (sobre, trx) => {
    const p = sobre.payload;
    await useTransaction(trx, () =>
      sincronizarPrestador.alCambiarEstado({
        idPrestador: Number(p['idPrestador']),
        estado: String(p['estado']) as EstadoPrestador,
        ocurridoAt: new Date(sobre.occurredAt),
      })
    );
  });

  consumidor.on(EventName.RatingSubmitted, async (sobre, trx) => {
    const p = sobre.payload;
    await useTransaction(trx, () =>
      sincronizarResumen.alCalificar({
        idServicio: enteroONulo(p['idServicio']),
        puntuacion: enteroONulo(p['puntuacion']),
        ocurridoAt: new Date(sobre.occurredAt),
      })
    );
  });

  /** Correccion de deriva: el valor que rating-service considera verdadero. */
  consumidor.on(EventName.ReputationRecalculated, async (sobre, trx) => {
    const p = sobre.payload;
    await useTransaction(trx, () =>
      sincronizarResumen.alRecalcular({
        idServicio: enteroONulo(p['idServicio']),
        puntuacionMedia: enteroONulo(p['puntuacionMedia']),
        totalCalificaciones: enteroONulo(p['totalCalificaciones']),
        ocurridoAt: new Date(sobre.occurredAt),
      })
    );
  });

  /**
   * Que el broker no este disponible NO impide arrancar: la busqueda del
   * catalogo es lo primero que ve quien llega, y no necesita eventos para
   * funcionar.
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

  const servidor = app.listen(env.CATALOG_PORT, () => {
    logger.info('catalog-service escuchando', { puerto: env.CATALOG_PORT, entorno: env.NODE_ENV });
  });

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

if (require.main === module) {
  main().catch((error: unknown) => {
    logger.error('fallo al arrancar', {
      mensaje: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}

export { envSchema };
