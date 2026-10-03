/**
 * Pruebas de integracion de notification-service contra MySQL real.
 *
 *   docker compose up -d
 *   npx jest --selectProjects integration
 */
import supertest from 'supertest';
import type { Express } from 'express';
import type { Knex } from 'knex';
import { runInTransaction } from '@punto-amigo/service-kit';
import { buildContainer, envSchema } from '../src/main';

const SECRETO_INTERNO = 'solo-para-pruebas-de-integracion';

const DUENO = 9401;
const AJENO = 9402;
const DESCONOCIDO = 9403;

let app: Express;
let knex: Knex;
let desdeEvento: ReturnType<typeof buildContainer>['desdeEvento'];
let disponible = false;
let motivoNoDisponible = '';

const env = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  CORS_ORIGIN: 'http://localhost:5173',
  MYSQL_HOST: process.env['MYSQL_HOST'] ?? '127.0.0.1',
  MYSQL_PORT: process.env['MYSQL_PORT'] ?? '3306',
  DB_NOTIFICATION_USER: process.env['DB_NOTIFICATION_USER'] ?? 'pa_notification_svc',
  DB_NOTIFICATION_PASSWORD: process.env['DB_NOTIFICATION_PASSWORD'] ?? '',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  INTERNAL_SERVICE_SECRET: SECRETO_INTERNO,
  RATE_LIMIT_MAX_PER_IP: '2000',
  RABBITMQ_HOST: process.env['RABBITMQ_HOST'] ?? '127.0.0.1',
  RABBITMQ_PORT: process.env['RABBITMQ_PORT'] ?? '5672',
  RABBITMQ_USER: process.env['RABBITMQ_USER'] ?? 'pa_dev',
  RABBITMQ_PASSWORD: process.env['RABBITMQ_PASSWORD'] ?? 'local',
};

const como = (
  userId: number | null
): {
  get: (ruta: string) => supertest.Test;
  post: (ruta: string) => supertest.Test;
} => {
  const agente = supertest(app);
  const preparar = (m: 'get' | 'post') => (ruta: string) => {
    let p = agente[m](ruta).set('x-internal-secret', SECRETO_INTERNO);
    if (userId !== null) {
      p = p.set('x-internal-user-id', String(userId)).set('x-internal-roles', 'SOLICITANTE');
    }
    return p;
  };
  return { get: preparar('get'), post: preparar('post') };
};

beforeAll(async () => {
  if (env.DB_NOTIFICATION_PASSWORD === '') {
    motivoNoDisponible = 'falta DB_NOTIFICATION_PASSWORD en el entorno';
    return;
  }

  try {
    const contenedor = buildContainer(envSchema.parse(env));
    app = contenedor.app;
    knex = contenedor.knex;
    desdeEvento = contenedor.desdeEvento;
    await knex.raw('SELECT 1');
    disponible = true;
  } catch (error) {
    motivoNoDisponible = error instanceof Error ? error.message : String(error);
    disponible = false;
  }
});

async function limpiar(): Promise<void> {
  await knex('notificacion').whereIn('id_usuario', [DUENO, AJENO, DESCONOCIDO]).delete();
  await knex('usuario_ref').whereIn('id_usuario', [DUENO, AJENO, DESCONOCIDO]).delete();
}

/** Siembra las replicas: la clave foranea exige que el destinatario exista. */
async function sembrar(): Promise<void> {
  for (const idUsuario of [DUENO, AJENO]) {
    await knex('usuario_ref')
      .insert({ id_usuario: idUsuario, nombre: `Usuario ${idUsuario}`, estado: 'ACTIVO' })
      .onConflict('id_usuario')
      .merge();
  }
}

beforeEach(async () => {
  if (!disponible) return;
  await limpiar();
  await sembrar();
});

afterAll(async () => {
  if (!disponible) return;
  await limpiar();
  await knex.destroy();
});

const saltar = (): boolean => {
  if (!disponible) {
    if (process.env['REQUIRE_INTEGRATION'] === '1') {
      throw new Error(`Las pruebas de integracion no pudieron arrancar: ${motivoNoDisponible}`);
    }
    console.warn(`pruebas de integracion omitidas: ${motivoNoDisponible}`);
    return true;
  }
  return false;
};

/** Crea un aviso por el mismo camino que usa un consumidor de eventos. */
const avisar = (idUsuario: number, titulo = 'Aviso de prueba'): Promise<boolean> =>
  runInTransaction(knex, () =>
    desdeEvento.crear({
      idUsuario,
      tipo: 'BIENVENIDA',
      titulo,
      mensaje: 'Mensaje de prueba suficientemente largo.',
      fecha: new Date(),
    })
  );

describe('bandeja propia (SRS RF93 a RF95)', () => {
  it('cada quien ve solo sus avisos', async () => {
    if (saltar()) return;
    await avisar(DUENO, 'Para el dueno');
    await avisar(AJENO, 'Para el otro');

    const mia = await como(DUENO).get('/api/v1/notifications');
    expect(mia.status).toBe(200);
    expect(mia.body.total).toBe(1);
    expect(mia.body.elementos[0].titulo).toBe('Para el dueno');

    const otra = await como(AJENO).get('/api/v1/notifications');
    expect(otra.body.total).toBe(1);
    expect(otra.body.elementos[0].titulo).toBe('Para el otro');
  });

  /**
   * El aviso sale sin `idUsuario`: quien lee su bandeja ya sabe quien es, y
   * repetirlo solo daria algo que correlacionar a quien capture la respuesta.
   */
  it('la vista no repite el identificador del destinatario', async () => {
    if (saltar()) return;
    await avisar(DUENO);

    const r = await como(DUENO).get('/api/v1/notifications');
    expect(r.body.elementos[0].idUsuario).toBeUndefined();
  });

  it('sin identidad no hay bandeja', async () => {
    if (saltar()) return;
    expect((await como(null).get('/api/v1/notifications')).status).toBe(401);
  });

  it('el contador de no leidas cuenta solo las propias', async () => {
    if (saltar()) return;
    await avisar(DUENO);
    await avisar(DUENO);
    await avisar(AJENO);

    expect((await como(DUENO).get('/api/v1/notifications/unread-count')).body.noLeidas).toBe(2);
    expect((await como(AJENO).get('/api/v1/notifications/unread-count')).body.noLeidas).toBe(1);
  });
});

describe('marcar como leida (IDOR)', () => {
  const idDe = async (idUsuario: number): Promise<number> =>
    Number((await knex('notificacion').where('id_usuario', idUsuario).first()).id_notificacion);

  it('el dueno la marca y el contador baja', async () => {
    if (saltar()) return;
    await avisar(DUENO);
    const id = await idDe(DUENO);

    expect((await como(DUENO).post(`/api/v1/notifications/${id}/read`)).status).toBe(204);

    const fila = await knex('notificacion').where('id_notificacion', id).first();
    expect(fila.estado).toBe('LEIDA');
    expect(fila.leida_at).not.toBeNull();
    expect((await como(DUENO).get('/api/v1/notifications/unread-count')).body.noLeidas).toBe(0);
  });

  /** Marcar el aviso de otro devuelve 404, nunca 403. */
  it('otro usuario no marca un aviso ajeno', async () => {
    if (saltar()) return;
    await avisar(DUENO);
    const id = await idDe(DUENO);

    expect((await como(AJENO).post(`/api/v1/notifications/${id}/read`)).status).toBe(404);

    const fila = await knex('notificacion').where('id_notificacion', id).first();
    expect(fila.estado).toBe('NO_LEIDA');
  });

  it('marcarla dos veces no es un error', async () => {
    if (saltar()) return;
    await avisar(DUENO);
    const id = await idDe(DUENO);

    expect((await como(DUENO).post(`/api/v1/notifications/${id}/read`)).status).toBe(204);
    expect((await como(DUENO).post(`/api/v1/notifications/${id}/read`)).status).toBe(204);
  });

  it('marcar todas afecta solo a la bandeja propia', async () => {
    if (saltar()) return;
    await avisar(DUENO);
    await avisar(DUENO);
    await avisar(AJENO);

    const r = await como(DUENO).post('/api/v1/notifications/read-all');
    expect(r.body.marcadas).toBe(2);

    expect((await como(AJENO).get('/api/v1/notifications/unread-count')).body.noLeidas).toBe(1);
  });

  it('un identificador que no es numero da 404', async () => {
    if (saltar()) return;
    expect((await como(DUENO).post('/api/v1/notifications/abc/read')).status).toBe(404);
  });
});

describe('creacion desde eventos', () => {
  /**
   * Un destinatario desconocido NO es un error: puede ser una cuenta anterior a
   * este servicio, o un evento que llego antes que el alta. Lanzar mandaria a
   * la cola de fallidos algo que no se arregla reintentando.
   */
  it('un destinatario que no esta replicado se descarta sin fallar', async () => {
    if (saltar()) return;

    const creada = await avisar(DESCONOCIDO);
    expect(creada).toBe(false);

    const filas = await knex('notificacion').where('id_usuario', DESCONOCIDO);
    expect(filas).toHaveLength(0);
  });

  it('un destinatario replicado si recibe el aviso', async () => {
    if (saltar()) return;
    expect(await avisar(DUENO)).toBe(true);
  });

  /** La replica guarda lo justo: ni correo ni telefono (fuera de alcance). */
  it('la replica de usuario no guarda datos de contacto', async () => {
    if (saltar()) return;
    await runInTransaction(knex, () =>
      desdeEvento.registrarUsuario({
        idUsuario: DUENO,
        nombre: 'Nombre Replicado',
        estado: 'ACTIVO',
        syncedAt: new Date(),
      })
    );

    const fila = await knex('usuario_ref').where('id_usuario', DUENO).first();
    expect(fila.nombre).toBe('Nombre Replicado');
    expect(fila.correo).toBeNull();
    expect(fila.telefono).toBeNull();
  });
});
