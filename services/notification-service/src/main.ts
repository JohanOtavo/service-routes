import knexLib from 'knex';
import type { Express } from 'express';
import type { Knex } from 'knex';
import { z } from 'zod';
import {
  EventName,
  assertProductionSafety,
  baseEnvSchema,
  esReemision,
  esVacio,
  loadEnv,
} from '@punto-amigo/shared';
import { Broker, EventConsumer } from '@punto-amigo/messaging';
import { SystemClock, useTransaction } from '@punto-amigo/service-kit';
import { ManageInboxUseCase } from './application/use-cases/ManageInbox';
import { CreateFromEventUseCase } from './application/use-cases/CreateFromEvent';
import {
  KnexNotificacionRepository,
  KnexUsuarioRefRepository,
} from './infrastructure/persistence/KnexNotificationRepositories';
import { createApp } from './infrastructure/http/app';

const envSchema = baseEnvSchema.extend({
  NOTIFICATION_PORT: z.coerce.number().int().min(1).max(65535).default(3006),
  DB_NOTIFICATION_USER: z.string().min(1),
  DB_NOTIFICATION_PASSWORD: z.string().min(1),

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
    console.warn(
      JSON.stringify({ level: 'info', service: 'notification-service', mensaje, ...contexto })
    );
  },
  error(mensaje: string, contexto: Record<string, unknown> = {}): void {
    console.error(
      JSON.stringify({ level: 'error', service: 'notification-service', mensaje, ...contexto })
    );
  },
};

export function buildContainer(env: z.infer<typeof envSchema>): {
  app: Express;
  knex: Knex;
  desdeEvento: CreateFromEventUseCase;
  clock: SystemClock;
} {
  const knex = knexLib({
    client: 'mysql2',
    connection: {
      host: env.MYSQL_HOST,
      port: env.MYSQL_PORT,
      user: env.DB_NOTIFICATION_USER,
      password: env.DB_NOTIFICATION_PASSWORD,
      database: 'pa_notification',
      timezone: 'Z',
      charset: 'utf8mb4',
    },
    pool: { min: 2, max: 10 },
  });

  const notificaciones = new KnexNotificacionRepository(knex);
  const usuarios = new KnexUsuarioRefRepository(knex);
  const clock = new SystemClock();

  const desdeEvento = new CreateFromEventUseCase(notificaciones, usuarios);

  const app = createApp({
    knex,
    bandeja: new ManageInboxUseCase(notificaciones, clock),
    logger,
    config: {
      corsOrigin: env.CORS_ORIGIN,
      bodyLimit: env.REQUEST_BODY_LIMIT,
      isProduction: env.NODE_ENV === 'production',
      internalSecret: env.INTERNAL_SERVICE_SECRET,
      rateLimit: { windowMs: env.RATE_LIMIT_WINDOW_MS, maxPerIp: env.RATE_LIMIT_MAX_PER_IP },
    },
  });

  return { app, knex, desdeEvento, clock };
}

async function main(): Promise<void> {
  const env = loadEnv(envSchema);
  assertProductionSafety(env);

  const { app, knex, desdeEvento, clock } = buildContainer(env);

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
   * Este servicio NO publica eventos, asi que no tiene relevo de outbox.
   *
   * La tabla existe en su esquema porque el helper comun la crea para todos,
   * pero nada escribe en ella: un aviso es el final de una cadena, no el
   * principio de otra.
   */
  const consumidor = new EventConsumer(
    knex,
    broker,
    {
      cola: 'notification-service.avisos',
      patrones: ['iam.#', 'provider.#', 'request.#', 'rating.#'],
      consumidor: 'notification-service',
      prefetch: env.CONSUMER_PREFETCH,
    },
    logger
  );

  /** Atajo: crea el aviso dentro de la transaccion del consumidor. */
  const avisar = (
    trx: Parameters<Parameters<typeof consumidor.on>[1]>[1],
    datos: Parameters<typeof desdeEvento.crear>[0]
  ): Promise<boolean> => useTransaction(trx, () => desdeEvento.crear(datos));

  // â”€â”€â”€ Identidad â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  consumidor.on(EventName.UserRegistered, async (sobre, trx) => {
    const p = sobre.payload;
    await useTransaction(trx, async () => {
      // El alta de la replica va PRIMERO: la clave foranea de `notificacion`
      // exige que el destinatario exista.
      await desdeEvento.registrarUsuario({
        idUsuario: Number(p['userId']),
        nombre: String(p['nombre'] ?? ''),
        estado: 'ACTIVO',
        syncedAt: clock.now(),
      });

      /**
       * El aviso NO se crea si el evento es una re-emision.
       *
       * La replica de arriba si se refresca —es justo para lo que se re-emite—,
       * pero el saludo de bienvenida es un hecho que ya ocurrio una vez.
       * Reconstruir `usuario_ref` con `db/cli.js reemit` mandaria una
       * bienvenida duplicada a cada usuario que ya existe, y la idempotencia
       * por `event_id` no puede evitarlo: la re-emision usa identificadores
       * nuevos a proposito, porque si no, nada se reconstruiria.
       */
      if (esReemision(p)) return;

      await desdeEvento.crear({
        idUsuario: Number(p['userId']),
        tipo: 'BIENVENIDA',
        titulo: 'Bienvenido a Punto Amigo',
        mensaje:
          'Su cuenta esta activa. Complete su perfil para empezar a ofrecer o a contratar servicios.',
        fecha: new Date(sobre.occurredAt),
      });
    });
  });

  consumidor.on(EventName.UserAccountSuspended, async (sobre, trx) => {
    const p = sobre.payload;
    await useTransaction(trx, () =>
      desdeEvento.cambiarEstadoUsuario({
        idUsuario: Number(p['userId']),
        estado: p['reason'] === 'ELIMINACION_LOGICA' ? 'INACTIVO' : 'SUSPENDIDO',
        syncedAt: clock.now(),
      })
    );
  });

  // â”€â”€â”€ Perfil de prestador â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  consumidor.on(EventName.ServiceProviderProfileValidated, async (sobre, trx) => {
    const p = sobre.payload;
    await useTransaction(trx, async () => {
      // La especialidad dirige el aviso de necesidades afines (SRS RF172).
      await desdeEvento.registrarEspecialidad({
        idUsuario: Number(p['idUsuario']),
        especialidad: String(p['especialidad'] ?? ''),
        syncedAt: clock.now(),
      });

      await desdeEvento.crear({
        idUsuario: Number(p['idUsuario']),
        tipo: 'PERFIL_VALIDADO',
        titulo: 'Su perfil fue validado',
        mensaje: 'Ya puede publicar servicios y recibir solicitudes.',
        recursoTipo: 'PRESTADOR',
        recursoId: Number(p['idPrestador']),
        fecha: new Date(sobre.occurredAt),
      });
    });
  });

  /**
   * El MOTIVO del cambio de estado no se copia al aviso.
   *
   * Viaja en el evento porque la notificacion podria necesitarlo, pero es texto
   * que escribio un administrador sobre una persona y puede contener datos de
   * terceros o juicios. El aviso dice que paso y donde mirar; el detalle se
   * consulta en el perfil, que exige sesion.
   */
  consumidor.on(EventName.ProviderStatusChanged, async (sobre, trx) => {
    const p = sobre.payload;
    const estado = String(p['estado']);
    if (estado === 'ACTIVE') return; // ya lo cuenta ServiceProviderProfileValidated

    await avisar(trx, {
      idUsuario: Number(p['idUsuario']),
      tipo: 'PERFIL_ESTADO_CAMBIADO',
      titulo: 'Su perfil cambio de estado',
      mensaje: `Su perfil de prestador paso a ${estado}. Consulte el detalle en su perfil.`,
      recursoTipo: 'PRESTADOR',
      recursoId: Number(p['idPrestador']),
      fecha: new Date(sobre.occurredAt),
    });
  });

  // â”€â”€â”€ Demanda y contratacion â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  consumidor.on(EventName.ProposalSubmitted, async (sobre, trx) => {
    const p = sobre.payload;
    await avisar(trx, {
      idUsuario: Number(p['idUsuarioDestinatario']),
      tipo: 'PROPUESTA_RECIBIDA',
      titulo: 'Recibio una propuesta nueva',
      // Sin precio ni nombre del oferente: para eso esta la pantalla de
      // propuestas, que comprueba que quien mira es el autor de la necesidad.
      mensaje: 'Un oferente respondio a una de sus necesidades.',
      recursoTipo: 'NECESIDAD',
      recursoId: Number(p['idNecesidad']),
      fecha: new Date(sobre.occurredAt),
    });
  });

  consumidor.on(EventName.ProposalAwarded, async (sobre, trx) => {
    const p = sobre.payload;
    const destinatario = p['idUsuarioPrestador'];
    if (esVacio(destinatario)) return;

    await avisar(trx, {
      idUsuario: Number(destinatario),
      tipo: 'PROPUESTA_ADJUDICADA',
      titulo: 'Le adjudicaron su propuesta',
      mensaje: 'Su propuesta fue elegida. La contratacion ya esta en curso.',
      recursoTipo: 'SOLICITUD',
      recursoId: Number(p['idSolicitud']),
      fecha: new Date(sobre.occurredAt),
    });
  });

  consumidor.on(EventName.ServiceRequestCreated, async (sobre, trx) => {
    const p = sobre.payload;
    // Una re-emision reconstruye `solicitud_ref` en rating; aqui no hay replica
    // que refrescar, solo el aviso, y ese hecho ya se anuncio en su dia.
    if (esReemision(p)) return;
    // La adjudicacion ya avisa por su propio camino; avisar otra vez aqui
    // mandaria dos notificaciones por el mismo hecho.
    if (p['origen'] === 'ADJUDICACION') return;

    const destinatario = p['idUsuarioPrestador'];
    if (esVacio(destinatario)) return;

    await avisar(trx, {
      idUsuario: Number(destinatario),
      tipo: 'SOLICITUD_RECIBIDA',
      titulo: 'Tiene una solicitud nueva',
      mensaje: 'Alguien solicito uno de sus servicios. Acepte o rechace desde la solicitud.',
      recursoTipo: 'SOLICITUD',
      recursoId: Number(p['idSolicitud']),
      fecha: new Date(sobre.occurredAt),
    });
  });

  for (const [evento, tipo, titulo, mensaje] of [
    [
      EventName.ServiceRequestAccepted,
      'SOLICITUD_ACEPTADA',
      'Su solicitud fue aceptada',
      'Ya puede ver los datos de contacto para coordinar el trabajo.',
    ],
    [
      EventName.ServiceRequestRejected,
      'SOLICITUD_RECHAZADA',
      'Su solicitud fue rechazada',
      'Puede buscar otro servicio o publicar una necesidad.',
    ],
    [
      EventName.ServiceRequestCompleted,
      'SOLICITUD_COMPLETADA',
      'La contratacion se completo',
      'Ya puede calificar a la otra parte.',
    ],
  ] as const) {
    consumidor.on(evento, async (sobre, trx) => {
      const p = sobre.payload;
      await avisar(trx, {
        idUsuario: Number(p['idUsuario']),
        tipo,
        titulo,
        mensaje,
        recursoTipo: 'SOLICITUD',
        recursoId: Number(p['idSolicitud']),
        fecha: new Date(sobre.occurredAt),
      });
    });
  }

  /**
   * Cancelacion: se avisa a la parte AFECTADA, no a quien cancelo.
   *
   * Quien cancela ya sabe que cancelo; recibir un aviso de su propio acto solo
   * ensucia la bandeja. El aviso no lleva el motivo ni el peso: el motivo es
   * texto de la otra parte y el peso es un dato de reputacion que no se le
   * comunica a quien no lo carga.
   */
  consumidor.on(EventName.ServiceRequestCancelled, async (sobre, trx) => {
    const p = sobre.payload;
    const canceloElSolicitante = p['parteCanceladora'] === 'SOLICITANTE';
    const afectado = canceloElSolicitante ? p['idUsuarioPrestador'] : p['idUsuario'];
    if (esVacio(afectado)) return;

    await avisar(trx, {
      idUsuario: Number(afectado),
      tipo: 'SOLICITUD_CANCELADA',
      titulo: 'Una contratacion fue cancelada',
      mensaje: 'La otra parte cancelo la contratacion. Consulte el detalle en la solicitud.',
      recursoTipo: 'SOLICITUD',
      recursoId: Number(p['idSolicitud']),
      fecha: new Date(sobre.occurredAt),
    });
  });

  // â”€â”€â”€ Reputacion â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /**
   * Solo cuando la calificacion YA es publica.
   *
   * Avisar antes delataria que existe una calificacion pendiente y, con ella,
   * que la contraparte ya escribio: justo lo que el periodo ciego oculta.
   */
  consumidor.on(EventName.RatingSubmitted, async (sobre, trx) => {
    const p = sobre.payload;
    if (p['publica'] !== true) return;

    await avisar(trx, {
      idUsuario: Number(p['idReceptor']),
      tipo: 'CALIFICACION_RECIBIDA',
      titulo: 'Recibio una calificacion',
      mensaje: 'Ya puede verla en su perfil.',
      fecha: new Date(sobre.occurredAt),
    });
  });

  /** Aviso al propio afectado: es lo que le da ocasion de corregir el rumbo. */
  consumidor.on(EventName.CancellationThresholdReached, async (sobre, trx) => {
    const p = sobre.payload;
    await avisar(trx, {
      idUsuario: Number(p['idUsuario']),
      tipo: 'UMBRAL_CANCELACION',
      titulo: 'Su tasa de cancelacion subio',
      mensaje:
        'Sus cancelaciones recientes alcanzaron un umbral. Las contrataciones que complete la haran bajar.',
      fecha: new Date(sobre.occurredAt),
    });
  });

  try {
    await broker.conectar();
    await consumidor.iniciar();
  } catch (error) {
    // Arranca igual: la bandeja se puede consultar sin broker, y los eventos
    // esperan en su cola, que es duradera.
    logger.error('broker no disponible al arrancar; se reintenta en segundo plano', {
      mensaje: error instanceof Error ? error.message : String(error),
    });
  }

  const servidor = app.listen(env.NOTIFICATION_PORT, () => {
    logger.info('notification-service escuchando', {
      puerto: env.NOTIFICATION_PORT,
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
