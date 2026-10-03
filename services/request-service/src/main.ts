import knexLib from 'knex';
import type { Express } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import { EventName, assertProductionSafety, baseEnvSchema, loadEnv } from '@punto-amigo/shared';
import { Broker, EventConsumer, OutboxRelay } from '@punto-amigo/messaging';
import { OutboxEventPublisher, SystemClock, useTransaction } from '@punto-amigo/service-kit';
import { ManageNeedsUseCase } from './application/use-cases/ManageNeeds';
import { ManageProposalsUseCase } from './application/use-cases/ManageProposals';
import { ManageRequestsUseCase } from './application/use-cases/ManageRequests';
import { CancelRequestUseCase } from './application/use-cases/CancelRequest';
import { SyncReplicasUseCase } from './application/use-cases/SyncReplicas';
import { KnexNecesidadRepository } from './infrastructure/persistence/KnexNecesidadRepository';
import { KnexPropuestaRepository } from './infrastructure/persistence/KnexPropuestaRepository';
import { KnexSolicitudRepository } from './infrastructure/persistence/KnexSolicitudRepository';
import {
  KnexCancelacionRepository,
  KnexHistorialRepository,
  KnexReplicaRepository,
} from './infrastructure/persistence/KnexSupportRepositories';
import { createApp } from './infrastructure/http/app';

const envSchema = baseEnvSchema.extend({
  REQUEST_PORT: z.coerce.number().int().min(1).max(65535).default(3004),
  DB_REQUEST_USER: z.string().min(1),
  DB_REQUEST_PASSWORD: z.string().min(1),

  // Limite anti-abuso (SRS RF125, RNF86). Es parametro y no constante porque
  // habra que recalibrarlo cuando se vea como se usa de verdad.
  NEEDS_MAX_ABIERTAS: z.coerce.number().int().min(1).max(100).default(5),
  NEEDS_DIAS_VIGENCIA: z.coerce.number().int().min(1).max(365).default(30),
  NEEDS_DIAS_REAPERTURA: z.coerce.number().int().min(1).max(365).default(15),

  // Politica de cancelacion (SRS 10.2.3). Tomada por analogia con el transporte
  // por aplicacion; se recalibra con datos reales, no son constantes medidas.
  CANCEL_GRACIA_HORAS: z.coerce.number().min(0).max(72).default(2),
  CANCEL_HOLGADA_HORAS: z.coerce.number().min(1).max(720).default(48),
  CANCEL_PESO_GRACIA: z.coerce.number().min(0).max(9.99).default(0),
  CANCEL_PESO_HOLGADA: z.coerce.number().min(0).max(9.99).default(0.5),
  CANCEL_PESO_AJUSTADA: z.coerce.number().min(0).max(9.99).default(1),
  CANCEL_PESO_TARDIA: z.coerce.number().min(0).max(9.99).default(1.5),

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
      JSON.stringify({ level: 'info', service: 'request-service', mensaje, ...contexto })
    );
  },
  error(mensaje: string, contexto: Record<string, unknown> = {}): void {
    console.error(
      JSON.stringify({ level: 'error', service: 'request-service', mensaje, ...contexto })
    );
  },
};

export function buildContainer(env: z.infer<typeof envSchema>): {
  app: Express;
  knex: Knex;
  sincronizacion: SyncReplicasUseCase;
} {
  const knex = knexLib({
    client: 'mysql2',
    connection: {
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      user: env.DB_REQUEST_USER,
      password: env.DB_REQUEST_PASSWORD,
      database: 'pa_request',
      timezone: 'Z',
      charset: 'utf8mb4',
    },
    pool: { min: 2, max: 10 },
  });

  const necesidadesRepo = new KnexNecesidadRepository(knex);
  const propuestasRepo = new KnexPropuestaRepository(knex);
  const solicitudesRepo = new KnexSolicitudRepository(knex);
  const historial = new KnexHistorialRepository(knex);
  const cancelaciones = new KnexCancelacionRepository(knex);
  const replicas = new KnexReplicaRepository(knex);
  const eventos = new OutboxEventPublisher('request-service');
  const clock = new SystemClock();

  const sincronizacion = new SyncReplicasUseCase(replicas);

  const app = createApp({
    knex,
    necesidades: new ManageNeedsUseCase(necesidadesRepo, replicas, eventos, clock, {
      maximoAbiertas: env.NEEDS_MAX_ABIERTAS,
      diasVigencia: env.NEEDS_DIAS_VIGENCIA,
    }),
    propuestas: new ManageProposalsUseCase(
      propuestasRepo,
      necesidadesRepo,
      replicas,
      eventos,
      clock
    ),
    solicitudes: new ManageRequestsUseCase(
      solicitudesRepo,
      necesidadesRepo,
      propuestasRepo,
      historial,
      replicas,
      eventos,
      clock
    ),
    cancelacion: new CancelRequestUseCase(
      solicitudesRepo,
      necesidadesRepo,
      cancelaciones,
      historial,
      replicas,
      eventos,
      clock,
      {
        parametros: {
          graciaHoras: env.CANCEL_GRACIA_HORAS,
          holgadaHoras: env.CANCEL_HOLGADA_HORAS,
          pesoGracia: env.CANCEL_PESO_GRACIA,
          pesoHolgada: env.CANCEL_PESO_HOLGADA,
          pesoAjustada: env.CANCEL_PESO_AJUSTADA,
          pesoTardia: env.CANCEL_PESO_TARDIA,
        },
        diasReapertura: env.NEEDS_DIAS_REAPERTURA,
      }
    ),
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
      contexto: 'request',
    },
    logger
  );

  /**
   * Consumidor de las replicas.
   *
   * Se suscribe a los eventos de prestador y de catalogo que cambian lo que
   * este servicio necesita saber de ellos. Los manejadores NO abren transaccion
   * propia: usan la del consumidor, que es la que tambien escribe la marca de
   * "ya procesado". Separarlas haria que una reentrega volviera a aplicarlo.
   */
  const consumidor = new EventConsumer(
    knex,
    broker,
    {
      cola: 'request-service.replicas',
      patrones: [
        'iam.usuario.*',
        'provider.prestador.*',
        'catalog.servicio.*',
        'catalog.categoria.*',
      ],
      consumidor: 'request-service',
      prefetch: env.CONSUMER_PREFETCH,
    },
    logger
  );

  /**
   * Usuarios. Alimenta `usuario_ref`, que es la clave foranea de `necesidad` y
   * de `solicitud_servicio`, y de donde sale el contacto que se revela cuando
   * hay acuerdo (SRS RF156).
   *
   * `UserRegistered` trae nombre y correo. El TELEFONO no viaja en ese evento, y
   * es deliberado: un evento se replica en varios servicios y solo debe llevar
   * lo que sus consumidores necesitan (SRS-MSG-06). La consecuencia es que el
   * contacto revelado aqui es nombre y correo, no telefono. Queda pendiente
   * decidir si el telefono se replica por un camino propio.
   */
  consumidor.on(EventName.UserRegistered, async (sobre, trx) => {
    const p = sobre.payload;
    await useTransaction(trx, () =>
      sincronizacion.alCambiarUsuario({
        idUsuario: Number(p['userId']),
        nombre: p['nombre'] === undefined ? null : String(p['nombre']),
        correo: p['correo'] === undefined ? null : String(p['correo']),
        estado: 'ACTIVO',
      })
    );
  });

  /**
   * Suspension y eliminacion llegan las dos como `UserAccountSuspended`; las
   * distingue el motivo. Ninguna trae nombre ni correo, asi que el caso de uso
   * conserva los que ya habia: tomarlos como ausentes borraria el contacto de
   * una contratacion ya acordada.
   */
  consumidor.on(EventName.UserAccountSuspended, async (sobre, trx) => {
    const p = sobre.payload;
    await useTransaction(trx, () =>
      sincronizacion.alCambiarUsuario({
        idUsuario: Number(p['userId']),
        estado: p['reason'] === 'ELIMINACION_LOGICA' ? 'ELIMINADO' : 'SUSPENDIDO',
      })
    );
  });

  consumidor.on(EventName.UserProfileUpdated, async (sobre, trx) => {
    const p = sobre.payload;
    // Solo la reactivacion cambia el estado; el resto de actualizaciones de
    // perfil no tocan nada que esta replica necesite.
    if (p['accion'] !== 'CUENTA_REACTIVADA') return;

    await useTransaction(trx, () =>
      sincronizacion.alCambiarUsuario({ idUsuario: Number(p['userId']), estado: 'ACTIVO' })
    );
  });

  const prestadorDesde = (
    p: Record<string, unknown>
  ): Parameters<SyncReplicasUseCase['alCambiarPrestador']>[0] => ({
    idPrestador: Number(p['idPrestador']),
    idUsuario: Number(p['idUsuario']),
    nombre: p['nombre'] === undefined ? null : String(p['nombre']),
    especialidad: p['especialidad'] === undefined ? null : String(p['especialidad']),
    estado: String(p['estado']),
  });

  for (const evento of [
    EventName.ServiceProviderProfileCreated,
    EventName.ServiceProviderProfileUpdated,
    EventName.ProviderStatusChanged,
  ]) {
    consumidor.on(evento, async (sobre, trx) => {
      await useTransaction(trx, () =>
        sincronizacion.alCambiarPrestador(prestadorDesde(sobre.payload))
      );
    });
  }

  /**
   * `ServiceProviderProfileValidated` no trae el estado, porque validar siempre
   * deja el perfil en ACTIVE. Se escribe aqui en lugar de asumir que el payload
   * lo traiga: dar por hecho un campo que el emisor no envia produciria
   * `estado: "undefined"` en la replica.
   */
  consumidor.on(EventName.ServiceProviderProfileValidated, async (sobre, trx) => {
    await useTransaction(trx, () =>
      sincronizacion.alCambiarPrestador({ ...prestadorDesde(sobre.payload), estado: 'ACTIVE' })
    );
  });

  for (const evento of [
    EventName.ServicePublished,
    EventName.ServiceUpdated,
    EventName.ServiceDeactivated,
  ]) {
    consumidor.on(evento, async (sobre, trx) => {
      const p = sobre.payload;
      await useTransaction(trx, () =>
        sincronizacion.alCambiarServicio({
          idServicio: Number(p['idServicio']),
          idPrestador: Number(p['idPrestador']),
          idCategoria: Number(p['idCategoria']),
          nombreServicio: p['nombreServicio'] === undefined ? null : String(p['nombreServicio']),
          estado: String(p['estado'] ?? 'ACTIVE'),
        })
      );
    });
  }

  for (const evento of [EventName.CategoryCreated, EventName.CategoryUpdated]) {
    consumidor.on(evento, async (sobre, trx) => {
      const p = sobre.payload;
      await useTransaction(trx, () =>
        sincronizacion.alCambiarCategoria({
          idCategoria: Number(p['idCategoria']),
          nombreCategoria: String(p['nombreCategoria'] ?? ''),
          activa: p['activa'] !== false,
        })
      );
    });
  }

  /**
   * Que el broker no este disponible NO impide arrancar: los eventos propios se
   * acumulan en el outbox y los ajenos esperan en su cola, que es duradera.
   * Negarse a levantar convertiria una caida del broker en la imposibilidad de
   * consultar contrataciones ya cerradas.
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

  const servidor = app.listen(env.REQUEST_PORT, () => {
    logger.info('request-service escuchando', { puerto: env.REQUEST_PORT, entorno: env.NODE_ENV });
  });

  const cerrar = (senal: string): void => {
    logger.info('cerrando', { senal });
    servidor.close(() => {
      // El relevo se detiene antes que la base: cortarlo a la mitad dejaria
      // eventos publicados sin marcar, que luego se reenviarian.
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
