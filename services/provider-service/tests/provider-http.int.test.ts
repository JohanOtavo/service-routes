/**
 * Pruebas de integracion de provider-service contra MySQL real.
 *
 *   docker compose up -d
 *   npx jest --selectProjects integration
 *
 * Se salta sola si no hay base disponible, para que `npm test` en una maquina
 * sin Docker no falle por algo que no es un defecto del codigo. Con
 * REQUIRE_INTEGRATION=1 el fallo se propaga en lugar de disfrazarse de exito.
 */
import supertest from 'supertest';
import type { Express } from 'express';
import type { Knex } from 'knex';
import { buildContainer, envSchema } from '../src/main';

const SECRETO_INTERNO = 'solo-para-pruebas-de-integracion';

const OFERENTE = 9001;
const OTRO_OFERENTE = 9002;
const ADMIN = 9003;

let app: Express;
let knex: Knex;
let disponible = false;
let motivoNoDisponible = '';

const env = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  CORS_ORIGIN: 'http://localhost:5173',
  MYSQL_HOST: process.env['MYSQL_HOST'] ?? '127.0.0.1',
  MYSQL_PORT: process.env['MYSQL_PORT'] ?? '3306',
  DB_PROVIDER_USER: process.env['DB_PROVIDER_USER'] ?? 'pa_provider_svc',
  DB_PROVIDER_PASSWORD: process.env['DB_PROVIDER_PASSWORD'] ?? '',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  INTERNAL_SERVICE_SECRET: SECRETO_INTERNO,
  RATE_LIMIT_MAX_PER_IP: '1000',
  RABBITMQ_HOST: process.env['RABBITMQ_HOST'] ?? '127.0.0.1',
  RABBITMQ_PORT: process.env['RABBITMQ_PORT'] ?? '5672',
  RABBITMQ_USER: process.env['RABBITMQ_USER'] ?? 'pa_dev',
  RABBITMQ_PASSWORD: process.env['RABBITMQ_PASSWORD'] ?? 'local',
};

/**
 * Cliente que imita al gateway: secreto interno mas identidad en cabeceras.
 *
 * Estas pruebas llaman a la aplicacion sin gateway delante. Envolverlo aqui
 * evita repetir las cabeceras y, sobre todo, evita la tentacion de desactivar
 * la comprobacion durante las pruebas (SRS RNF24).
 */
const como = (
  userId: number | null,
  roles: string[] = []
): {
  get: (ruta: string) => supertest.Test;
  post: (ruta: string) => supertest.Test;
  patch: (ruta: string) => supertest.Test;
  delete: (ruta: string) => supertest.Test;
} => {
  const agente = supertest(app);
  const preparar = (m: 'get' | 'post' | 'patch' | 'delete') => (ruta: string) => {
    let p = agente[m](ruta).set('x-internal-secret', SECRETO_INTERNO);
    if (userId !== null) {
      p = p.set('x-internal-user-id', String(userId)).set('x-internal-roles', roles.join(','));
    }
    return p;
  };
  return {
    get: preparar('get'),
    post: preparar('post'),
    patch: preparar('patch'),
    delete: preparar('delete'),
  };
};

const oferente = (): ReturnType<typeof como> => como(OFERENTE, ['OFERENTE']);
const otroOferente = (): ReturnType<typeof como> => como(OTRO_OFERENTE, ['OFERENTE']);
const admin = (): ReturnType<typeof como> => como(ADMIN, ['ADMINISTRADOR']);
const anonimo = (): ReturnType<typeof como> => como(null);

const PERFIL = {
  nombre: 'Pedro Plomero',
  especialidad: 'Plomeria y redes de agua',
  telefono: '3001112233',
  correo: 'pedro@puntoamigo.local',
};

beforeAll(async () => {
  if (env.DB_PROVIDER_PASSWORD === '') {
    motivoNoDisponible = 'falta DB_PROVIDER_PASSWORD en el entorno';
    return;
  }

  try {
    const contenedor = buildContainer(envSchema.parse(env));
    app = contenedor.app;
    knex = contenedor.knex;
    await knex.raw('SELECT 1');
    disponible = true;
  } catch (error) {
    // El motivo se conserva y se imprime. Tragarlo convierte un error de
    // configuracion en una suite que "pasa" sin haber ejecutado nada.
    motivoNoDisponible = error instanceof Error ? error.message : String(error);
    disponible = false;
  }
});

async function limpiar(): Promise<void> {
  const filas = await knex('prestador')
    .whereIn('id_usuario', [OFERENTE, OTRO_OFERENTE, ADMIN])
    .select('id_prestador');

  for (const fila of filas) {
    const id = Number(fila.id_prestador);
    await knex('provider_validation_log').where('id_prestador', id).delete();
    await knex('outbox_event').where('aggregate_id', String(id)).delete();
  }
  await knex('prestador').whereIn('id_usuario', [OFERENTE, OTRO_OFERENTE, ADMIN]).delete();
}

beforeEach(async () => {
  if (disponible) await limpiar();
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

/** Crea el perfil del oferente y devuelve su identificador. */
async function crearPerfil(): Promise<number> {
  const r = await oferente().post('/api/v1/providers').send(PERFIL);
  expect(r.status).toBe(201);
  return r.body.id as number;
}

describe('alta del perfil', () => {
  it('nace PENDING_VALIDATION y escribe su evento en el mismo commit', async () => {
    if (saltar()) return;

    const id = await crearPerfil();

    const fila = await knex('prestador').where('id_prestador', id).first();
    expect(fila.estado).toBe('PENDING_VALIDATION');
    expect(Number(fila.id_usuario)).toBe(OFERENTE);

    // El outbox es la prueba de que el evento viaja en la misma transaccion.
    const eventos = await knex('outbox_event').where('aggregate_id', String(id));
    expect(eventos.map((e) => e.event_name)).toContain('ServiceProviderProfileCreated');

    const asientos = await knex('provider_validation_log').where('id_prestador', id);
    expect(asientos).toHaveLength(1);
    expect(asientos[0].estado_nuevo).toBe('PENDING_VALIDATION');
  });

  /** Un segundo perfil choca con el UNIQUE y eso es un 409, no un 500. */
  it('un usuario no tiene dos perfiles', async () => {
    if (saltar()) return;
    await crearPerfil();

    const r = await oferente().post('/api/v1/providers').send(PERFIL);
    expect(r.status).toBe(409);
  });

  /** El estado no es parametro: enviarlo debe fallar, no colarse. */
  it('rechaza un cuerpo con campos no declarados', async () => {
    if (saltar()) return;

    const r = await oferente()
      .post('/api/v1/providers')
      .send({ ...PERFIL, estado: 'ACTIVE' });
    expect(r.status).toBe(422);
  });

  it('un solicitante no crea perfil de prestador', async () => {
    if (saltar()) return;

    const r = await como(OFERENTE, ['SOLICITANTE']).post('/api/v1/providers').send(PERFIL);
    expect(r.status).toBe(403);
  });

  it('sin secreto interno no se entra', async () => {
    if (saltar()) return;

    const r = await supertest(app).post('/api/v1/providers').send(PERFIL);
    expect(r.status).toBe(403);
  });

  it('con secreto pero sin identidad tampoco', async () => {
    if (saltar()) return;

    const r = await anonimo().post('/api/v1/providers').send(PERFIL);
    expect(r.status).toBe(401);
  });
});

describe('propiedad del perfil (IDOR)', () => {
  it('otro oferente no edita un perfil ajeno, y recibe 404 en vez de 403', async () => {
    if (saltar()) return;
    const id = await crearPerfil();

    const r = await otroOferente()
      .patch(`/api/v1/providers/${id}`)
      .send({ nombre: 'Secuestrado por otro' });

    expect(r.status).toBe(404);

    // Y no cambio nada: un 404 que ya escribio seria peor que un 403.
    const fila = await knex('prestador').where('id_prestador', id).first();
    expect(fila.nombre).toBe(PERFIL.nombre);
  });

  it('otro oferente no retira un perfil ajeno', async () => {
    if (saltar()) return;
    const id = await crearPerfil();

    expect((await otroOferente().delete(`/api/v1/providers/${id}`)).status).toBe(404);

    const fila = await knex('prestador').where('id_prestador', id).first();
    expect(fila.estado).toBe('PENDING_VALIDATION');
  });

  it('su dueno si edita, y el cambio sale como evento', async () => {
    if (saltar()) return;
    const id = await crearPerfil();

    const r = await oferente()
      .patch(`/api/v1/providers/${id}`)
      .send({ especialidad: 'Plomeria, gas y redes' });

    expect(r.status).toBe(200);
    expect(r.body.especialidad).toBe('Plomeria, gas y redes');

    const eventos = await knex('outbox_event').where('aggregate_id', String(id));
    expect(eventos.map((e) => e.event_name)).toContain('ServiceProviderProfileUpdated');
  });

  it('un PATCH sin campos no es una edicion', async () => {
    if (saltar()) return;
    const id = await crearPerfil();

    expect((await oferente().patch(`/api/v1/providers/${id}`).send({})).status).toBe(422);
  });
});

describe('visibilidad publica (SRS RF25, RF31)', () => {
  it('un perfil sin validar no se ve, y da 404 y no 403', async () => {
    if (saltar()) return;
    const id = await crearPerfil();

    expect((await anonimo().get(`/api/v1/providers/${id}`)).status).toBe(404);
  });

  /**
   * Lo que mas importa de esta prueba: validado tampoco publica el contacto.
   * El telefono y el correo se revelan cuando hay acuerdo, y de eso es dueno
   * request-service (RF31, RF156, RNF84).
   */
  it('validado se ve, pero sin telefono ni correo', async () => {
    if (saltar()) return;
    const id = await crearPerfil();
    expect((await admin().post(`/api/v1/providers/${id}/validate`)).status).toBe(200);

    const r = await anonimo().get(`/api/v1/providers/${id}`);
    expect(r.status).toBe(200);
    expect(r.body.validado).toBe(true);

    const cuerpo = JSON.stringify(r.body);
    expect(cuerpo).not.toContain(PERFIL.telefono);
    expect(cuerpo).not.toContain(PERFIL.correo);
    // Tampoco el identificador de la cuenta: cruzarlo entre modulos es interno.
    expect(r.body.idUsuario).toBeUndefined();
  });

  it('el directorio acota el tamano de pagina aunque se pida mas', async () => {
    if (saltar()) return;

    expect((await oferente().get('/api/v1/providers?tamano=10000')).status).toBe(422);
    expect((await oferente().get('/api/v1/providers?tamano=50')).status).toBe(200);
  });
});

describe('revision administrativa (SRS RF26, RF27, RF29, RF30)', () => {
  it('un oferente no valida su propio perfil', async () => {
    if (saltar()) return;
    const id = await crearPerfil();

    expect((await oferente().post(`/api/v1/providers/${id}/validate`)).status).toBe(403);

    const fila = await knex('prestador').where('id_prestador', id).first();
    expect(fila.estado).toBe('PENDING_VALIDATION');
  });

  it('validar deja asiento con el administrador responsable', async () => {
    if (saltar()) return;
    const id = await crearPerfil();

    await admin().post(`/api/v1/providers/${id}/validate`);

    const asientos = await knex('provider_validation_log')
      .where('id_prestador', id)
      .orderBy('id_validacion', 'asc');

    expect(asientos).toHaveLength(2);
    expect(asientos[1].estado_anterior).toBe('PENDING_VALIDATION');
    expect(asientos[1].estado_nuevo).toBe('ACTIVE');
    expect(Number(asientos[1].validado_por)).toBe(ADMIN);
  });

  it('rechazar exige un motivo utilizable', async () => {
    if (saltar()) return;
    const id = await crearPerfil();

    expect(
      (await admin().post(`/api/v1/providers/${id}/reject`).send({ motivo: 'no' })).status
    ).toBe(422);

    const r = await admin()
      .post(`/api/v1/providers/${id}/reject`)
      .send({ motivo: 'La especialidad declarada no corresponde con los documentos aportados.' });

    expect(r.status).toBe(200);
    expect(r.body.estado).toBe('INACTIVE');

    const asientos = await knex('provider_validation_log').where('id_prestador', id);
    expect(asientos[asientos.length - 1].motivo).toContain('documentos');
  });

  /**
   * Un perfil rechazado vuelve por la cola de validacion, no directo a ACTIVE.
   * Reactivarlo de golpe saltaria la revision por la puerta de atras.
   */
  it('un perfil retirado no se reactiva de un salto', async () => {
    if (saltar()) return;
    const id = await crearPerfil();
    await admin()
      .post(`/api/v1/providers/${id}/reject`)
      .send({ motivo: 'Los datos aportados no se pudieron verificar en esta revision.' });

    const salto = await admin().patch(`/api/v1/providers/${id}/status`).send({ destino: 'ACTIVE' });
    expect(salto.status).toBe(409);

    const vuelta = await admin()
      .patch(`/api/v1/providers/${id}/status`)
      .send({ destino: 'PENDING_VALIDATION' });
    expect(vuelta.status).toBe(200);
    expect(vuelta.body.estado).toBe('PENDING_VALIDATION');
  });

  it('la cola de pendientes solo la ve un administrador', async () => {
    if (saltar()) return;
    await crearPerfil();

    expect((await oferente().get('/api/v1/providers/pending')).status).toBe(403);

    const r = await admin().get('/api/v1/providers/pending');
    expect(r.status).toBe(200);
    expect(r.body.total).toBeGreaterThanOrEqual(1);
  });

  it('la ficha completa con contacto solo la ve un administrador', async () => {
    if (saltar()) return;
    const id = await crearPerfil();

    expect((await otroOferente().get(`/api/v1/providers/${id}/full`)).status).toBe(403);

    const r = await admin().get(`/api/v1/providers/${id}/full`);
    expect(r.status).toBe(200);
    expect(r.body.telefono).toBe(PERFIL.telefono);
  });

  it('un identificador que no es un numero da 404 sin tocar la base', async () => {
    if (saltar()) return;

    expect((await admin().get('/api/v1/providers/abc/full')).status).toBe(404);
    expect((await admin().post('/api/v1/providers/0/validate')).status).toBe(404);
  });
});
