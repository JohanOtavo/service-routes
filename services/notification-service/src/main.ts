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
import {
  SendRecoveryEmailUseCase,
  registrarCorreoDeRecuperacion,
} from './application/use-cases/SendRecoveryEmail';
import {
  EnviadorCorreoRegistrado,
  EnviadorCorreoSmtp,
} from './infrastructure/correo/EnviadorCorreo';

/**
 * En un `.env`, una clave vacia significa "sin valor".
 *
 * `SMTP_HOST=` no es una cadena vacia que haya que validar: es la forma que
 * tiene un fichero de entorno de decir que no hay servidor de correo. Sin esto,
 * `z.string().min(1).optional()` la rechazaba —la clave ESTA, aunque no tenga
 * valor— y el servicio no arrancaba.
 *
 * Se descubrio porque `.env.example` trae esas claves vacias, asi que cualquiera
 * que copiara el ejemplo se encontraba notification-service sin levantar. En la
 * maquina de desarrollo no se veia: alli las claves no existian y `optional`
 * hacia su trabajo.
 */
const vacioEsAusente = <T extends z.ZodTypeAny>(esquema: T): z.ZodEffects<T> =>
  z.preprocess((v) => (v === '' ? undefined : v), esquema) as unknown as z.ZodEffects<T>;

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

  /**
   * Correo transaccional (C-1). Solo la recuperacion de contrasena.
   *
   * Todo opcional: sin SMTP el servicio arranca igual y deja el enlace en el
   * registro, que es lo que permite probar la recuperacion en una maquina de
   * desarrollo. `exigirCorreoEnProduccion` impide que eso llegue a produccion.
   */
  SMTP_HOST: vacioEsAusente(z.string().min(1).optional()),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  // 465 es SMTPS (TLS desde el primer byte); 587 negocia con STARTTLS.
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  SMTP_USER: vacioEsAusente(z.string().optional()),
  SMTP_PASSWORD: vacioEsAusente(z.string().optional()),
  SMTP_FROM: z.string().min(1).default('Punto Amigo <no-responder@puntoamigo.local>'),

  /**
   * URL publica del cliente, para construir el enlace del correo.
   *
   * Cae a `CORS_ORIGIN` porque es la unica URL del cliente que este servicio ya
   * conocia, y en desarrollo es la correcta. En produccion conviene declararla
   * aparte: `CORS_ORIGIN` puede llevar varios origenes y de ahi no se puede
   * sacar uno solo con el que construir un enlace.
   */
  WEB_PUBLIC_URL: vacioEsAusente(z.string().url().optional()),
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
  recuperacion: SendRecoveryEmailUseCase;
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

  /**
   * SMTP si esta configurado; si no, el que deja el enlace en el registro.
   *
   * La condicion es `SMTP_HOST`: sin servidor no hay nada que intentar, y el
   * resto de claves tienen valor por omision.
   */
  const enviadorCorreo =
    env.SMTP_HOST === undefined
      ? new EnviadorCorreoRegistrado(logger)
      : new EnviadorCorreoSmtp(
          {
            host: env.SMTP_HOST,
            puerto: env.SMTP_PORT,
            seguro: env.SMTP_SECURE,
            usuario: env.SMTP_USER ?? '',
            contrasena: env.SMTP_PASSWORD ?? '',
            remitente: env.SMTP_FROM,
          },
          logger
        );

  const recuperacion = new SendRecoveryEmailUseCase(enviadorCorreo, logger, {
    urlBaseCliente: env.WEB_PUBLIC_URL ?? env.CORS_ORIGIN,
  });

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

  return { app, knex, desdeEvento, clock, recuperacion };
}

/**
 * En produccion, SMTP no es opcional (C-1).
 *
 * Sin el, `EnviadorCorreoRegistrado` escribiria el enlace de recuperacion
 * —token incluido— en el registro del servidor, y la recuperacion de
 * contrasena no funcionaria para nadie. Las dos cosas son graves y ninguna
 * falla de forma visible, asi que el arranque se niega en lugar de descubrirse
 * cuando alguien no pueda entrar.
 *
 * `assertProductionSafety` de `@punto-amigo/shared` no cubre esto: no conoce la
 * configuracion de correo, que es propia de este servicio.
 */
function exigirCorreoEnProduccion(env: z.infer<typeof envSchema>): void {
  if (env.NODE_ENV !== 'production') return;
  if (env.SMTP_HOST !== undefined) return;

  throw new Error(
    'Falta SMTP_HOST. En produccion el correo de recuperacion no se puede dejar sin enviar, ' +
      'y el enviador de reserva escribiria el token en el registro.'
  );
}

async function main(): Promise<void> {
  const env = loadEnv(envSchema);
  assertProductionSafety(env);
  exigirCorreoEnProduccion(env);

  const { app, knex, desdeEvento, clock, recuperacion } = buildContainer(env);

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

  /**
   * El evento que hasta ahora se descartaba (C-1).
   *
   * `auth-service` lo emite con el token de recuperacion dentro. Llegaba a esta
   * cola —`iam.usuario.user_profile_updated` encaja con el patron `iam.#`— y al
   * no haber manejador el consumidor hacia `ack` y lo tiraba. El token se
   * generaba, se guardaba, se publicaba y no llegaba a ningun sitio.
   *
   * No se crea ningun aviso en la bandeja: quien olvido su contrasena no puede
   * iniciar sesion para leerla. Por eso este canal tiene que ser el correo.
   *
   * Sin `useTransaction`: no escribe en la base. Envolverlo mantendria abierta
   * una transaccion durante una llamada de red a un servidor SMTP.
   */
  registrarCorreoDeRecuperacion(consumidor, recuperacion, EventName.UserProfileUpdated);

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
