/**
 * Pruebas de integracion de auth-service contra MySQL real.
 *
 *   docker compose up -d
 *   npx jest --selectProjects integration
 *
 * Se salta sola si no hay base de datos disponible, para que `npm test` en una
 * maquina sin Docker no falle por algo que no es un defecto del codigo.
 */
import supertest from 'supertest';
import type { Express } from 'express';

const SECRETO_INTERNO = 'solo-para-pruebas-de-integracion';

/**
 * Cliente que adjunta el secreto interno en cada peticion.
 *
 * Estas pruebas llaman a la aplicacion directamente, sin gateway delante, y el
 * servicio rechaza lo que no lo traiga (SRS RNF24). Envolverlo aqui evita
 * repetir la cabecera en cada llamada y, sobre todo, evita la tentacion de
 * desactivar la comprobacion durante las pruebas.
 */
const request = (
  app: Express
): {
  get: (ruta: string) => supertest.Test;
  post: (ruta: string) => supertest.Test;
  put: (ruta: string) => supertest.Test;
  patch: (ruta: string) => supertest.Test;
  delete: (ruta: string) => supertest.Test;
} => {
  const agente = supertest(app);
  const conSecreto = (m: 'get' | 'post' | 'put' | 'patch' | 'delete') => (ruta: string) =>
    agente[m](ruta).set('x-internal-secret', SECRETO_INTERNO);
  return {
    get: conSecreto('get'),
    post: conSecreto('post'),
    put: conSecreto('put'),
    patch: conSecreto('patch'),
    delete: conSecreto('delete'),
  };
};
import knexLib, { type Knex } from 'knex';
import { buildContainer, envSchema } from '../src/main';

const CORREO = 'integracion@puntoamigo.local';
const CONTRASENA = 'ContrasenaDePrueba2026';

/**
 * Correos contra los que esta suite intenta un login fallido a proposito.
 *
 * El bloqueo progresivo lleva la cuenta por correo, asi que esos correos se
 * tienen que limpiar igual que `CORREO`. Sin esto, cada ejecucion de la suite
 * deja un fallo mas acumulado y, al llegar al umbral, el correo queda
 * bloqueado 24 horas: la suite deja de ser idempotente y falla sola.
 */
const CORREOS_CON_FALLO = [CORREO, 'nadie@puntoamigo.local'];

let app: Express;
let knex: Knex;
let disponible = false;
/** Por que no se pudo conectar. Sin esto, un fallo de configuracion se confunde con un entorno sin Docker. */
let motivoNoDisponible = '';

const env = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  CORS_ORIGIN: 'http://localhost:5173',
  MYSQL_HOST: process.env['MYSQL_HOST'] ?? '127.0.0.1',
  MYSQL_PORT: process.env['MYSQL_PORT'] ?? '3306',
  DB_AUTH_USER: process.env['DB_AUTH_USER'] ?? 'pa_auth_svc',
  DB_AUTH_PASSWORD: process.env['DB_AUTH_PASSWORD'] ?? '',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  INTERNAL_SERVICE_SECRET: SECRETO_INTERNO,
  JWT_PRIVATE_KEY: process.env['JWT_PRIVATE_KEY'] ?? '',
  JWT_PUBLIC_KEY: process.env['JWT_PUBLIC_KEY'] ?? '',
  REFRESH_COOKIE_SECURE: 'false',
  // Un umbral bajo hace la prueba del bloqueo rapida y legible.
  LOGIN_MAX_ATTEMPTS: '3',
  LOGIN_LOCKOUT_BASE_SECONDS: '60',
  RATE_LIMIT_AUTH_MAX: '500',
  RATE_LIMIT_MAX_PER_IP: '1000',
  RABBITMQ_HOST: process.env['RABBITMQ_HOST'] ?? '127.0.0.1',
  RABBITMQ_PORT: process.env['RABBITMQ_PORT'] ?? '5672',
  RABBITMQ_USER: process.env['RABBITMQ_USER'] ?? 'pa_dev',
  RABBITMQ_PASSWORD: process.env['RABBITMQ_PASSWORD'] ?? 'local',
};

beforeAll(async () => {
  if (env.DB_AUTH_PASSWORD === '' || env.JWT_PRIVATE_KEY === '') {
    motivoNoDisponible = 'faltan DB_AUTH_PASSWORD o JWT_PRIVATE_KEY en el entorno';
    return;
  }

  try {
    const parsed = envSchema.parse(env);
    const contenedor = buildContainer(parsed);
    app = contenedor.app;
    knex = contenedor.knex;
    await knex.raw('SELECT 1');
    disponible = true;
  } catch (error) {
    // El motivo se conserva y se imprime. Tragarlo convierte un error de
    // configuracion en una suite que "pasa" sin haber ejecutado nada, que es
    // peor que fallar.
    motivoNoDisponible = error instanceof Error ? error.message : String(error);
    disponible = false;
  }
});

afterAll(async () => {
  if (!disponible) return;
  await limpiar();
  await knex.destroy();
});

async function limpiar(): Promise<void> {
  const limpio = knexLib;
  void limpio;
  await knex('login_attempt').whereIn('correo_intentado', CORREOS_CON_FALLO).delete();
  await knex('login_lockout').whereIn('correo', CORREOS_CON_FALLO).delete();
  const usuario = await knex('usuario').where('correo', CORREO).first();
  if (usuario !== undefined) {
    await knex('refresh_session').where('id_usuario', usuario.id_usuario).delete();
    await knex('token_denylist').where('id_usuario', usuario.id_usuario).delete();
    await knex('usuario_rol').where('id_usuario', usuario.id_usuario).delete();
    await knex('outbox_event').where('aggregate_id', String(usuario.id_usuario)).delete();
    await knex('usuario').where('correo', CORREO).delete();
  }
}

beforeEach(async () => {
  if (disponible) await limpiar();
});

/**
 * Decide si omitir, y distingue dos situaciones que no son lo mismo.
 *
 * Sin Docker levantado, omitir es razonable: quien clona el repositorio y
 * ejecuta las pruebas no deberia ver fallos por algo que no es suyo.
 *
 * Pero un error de configuracion —una variable que el esquema exige y la prueba
 * no pasa— SI es un defecto, y omitirlo en silencio lo esconde. Con
 * REQUIRE_INTEGRATION=1, el fallo se propaga en lugar de disfrazarse de exito.
 */
const saltarSiNoHayBase = (): boolean => {
  if (!disponible) {
    if (process.env['REQUIRE_INTEGRATION'] === '1') {
      throw new Error(`Las pruebas de integracion no pudieron arrancar: ${motivoNoDisponible}`);
    }
    console.warn(`pruebas de integracion omitidas: ${motivoNoDisponible}`);
  }
  return !disponible;
};

describe('registro e inicio de sesion', () => {
  it('registra, autentica y devuelve un token utilizable', async () => {
    if (saltarSiNoHayBase()) return;

    const alta = await request(app).post('/api/v1/auth/register').send({
      nombre: 'Usuario Integracion',
      correo: CORREO,
      contrasena: CONTRASENA,
      confirmacionContrasena: CONTRASENA,
    });
    expect(alta.status).toBe(201);
    expect(alta.body.roles).toEqual(['SOLICITANTE']);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ correo: CORREO, contrasena: CONTRASENA });
    expect(login.status).toBe(200);

    const yo = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`);
    expect(yo.status).toBe(200);
    expect(yo.body.roles).toEqual(['SOLICITANTE']);
  });

  it('guarda la contrasena hasheada con Argon2id y nunca en claro', async () => {
    if (saltarSiNoHayBase()) return;

    await request(app).post('/api/v1/auth/register').send({
      nombre: 'Usuario Integracion',
      correo: CORREO,
      contrasena: CONTRASENA,
      confirmacionContrasena: CONTRASENA,
    });

    const fila = await knex('usuario').where('correo', CORREO).first();
    expect(fila.contrasena_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/u);
    expect(fila.contrasena_hash).not.toContain(CONTRASENA);
  });

  it('escribe el evento en el outbox dentro de la misma transaccion del alta', async () => {
    if (saltarSiNoHayBase()) return;

    const alta = await request(app).post('/api/v1/auth/register').send({
      nombre: 'Usuario Integracion',
      correo: CORREO,
      contrasena: CONTRASENA,
      confirmacionContrasena: CONTRASENA,
    });

    const eventos = await knex('outbox_event')
      .where('aggregate_id', String(alta.body.id))
      .select('event_name', 'published_at', 'payload');

    expect(eventos).toHaveLength(1);
    expect(eventos[0].event_name).toBe('UserRegistered');
    // Aun sin publicar: de eso se encarga un proceso aparte.
    expect(eventos[0].published_at).toBeNull();
    expect(JSON.stringify(eventos[0].payload)).not.toContain(CONTRASENA);
  });
});

describe('bloqueo progresivo', () => {
  /**
   * Regresion de un defecto encontrado al ejecutar el servicio, no al leerlo.
   *
   * El registro del intento fallido vivia dentro de la transaccion del inicio de
   * sesion. Como un fallo termina lanzando, la transaccion revertia y se llevaba
   * por delante el propio registro del fallo: el contador volvia a cero en cada
   * intento y el bloqueo no se activaba jamas, dejando la fuerza bruta sin
   * ningun freno.
   *
   * La prueba comprueba lo que ninguna prueba unitaria con dobles podia ver: que
   * el fallo SOBREVIVE al rollback.
   */
  it('registra el intento fallido pese a que la transaccion revierte', async () => {
    if (saltarSiNoHayBase()) return;

    await request(app).post('/api/v1/auth/register').send({
      nombre: 'Usuario Integracion',
      correo: CORREO,
      contrasena: CONTRASENA,
      confirmacionContrasena: CONTRASENA,
    });

    await request(app)
      .post('/api/v1/auth/login')
      .send({ correo: CORREO, contrasena: 'ContrasenaIncorrecta2026' })
      .expect(401);

    const intentos = await knex('login_attempt')
      .where({ correo_intentado: CORREO, exitoso: false })
      .count<{ n: number }[]>({ n: '*' });

    expect(Number(intentos[0]?.n)).toBe(1);
  });

  it('bloquea al alcanzar el umbral y responde 429', async () => {
    if (saltarSiNoHayBase()) return;

    await request(app).post('/api/v1/auth/register').send({
      nombre: 'Usuario Integracion',
      correo: CORREO,
      contrasena: CONTRASENA,
      confirmacionContrasena: CONTRASENA,
    });

    const codigos: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      const r = await request(app)
        .post('/api/v1/auth/login')
        .send({ correo: CORREO, contrasena: 'ContrasenaIncorrecta2026' });
      codigos.push(r.body.code);
    }

    expect(codigos.slice(0, 2)).toEqual(['UNAUTHENTICATED', 'UNAUTHENTICATED']);
    expect(codigos[2]).toBe('ACCOUNT_LOCKED');

    // Bloqueada, la credencial CORRECTA tampoco entra.
    const conCorrecta = await request(app)
      .post('/api/v1/auth/login')
      .send({ correo: CORREO, contrasena: CONTRASENA });
    expect(conCorrecta.status).toBe(429);
  });

  it('un acceso correcto limpia el contador de fallos', async () => {
    if (saltarSiNoHayBase()) return;

    await request(app).post('/api/v1/auth/register').send({
      nombre: 'Usuario Integracion',
      correo: CORREO,
      contrasena: CONTRASENA,
      confirmacionContrasena: CONTRASENA,
    });

    await request(app)
      .post('/api/v1/auth/login')
      .send({ correo: CORREO, contrasena: 'ContrasenaIncorrecta2026' });
    await request(app).post('/api/v1/auth/login').send({ correo: CORREO, contrasena: CONTRASENA });

    const fila = await knex('login_lockout').where('correo', CORREO).first();
    expect(fila.fallos_consecutivos).toBe(0);
    expect(fila.bloqueado_hasta).toBeNull();
  });
});

describe('recuperacion de contrasena', () => {
  /**
   * Regresion de un interbloqueo encontrado al ejecutar el servicio.
   *
   * Las revocaciones se habian sacado de la transaccion para que sobrevivieran
   * a un rechazo. Pero `refresh_session` tiene clave foranea hacia `usuario`, y
   * actualizarla desde otra conexion mientras la transaccion tiene esa fila
   * tomada en exclusiva hace que cada una espere a la otra hasta que MySQL corta
   * por tiempo. El endpoint colgaba cincuenta segundos y devolvia 503.
   *
   * Con un tiempo de espera corto, esta prueba falla en segundos si alguien
   * vuelve a sacar la revocacion de la transaccion.
   */
  it('restablece la contrasena sin bloquearse contra si misma', async () => {
    if (saltarSiNoHayBase()) return;

    await request(app).post('/api/v1/auth/register').send({
      nombre: 'Usuario Integracion',
      correo: CORREO,
      contrasena: CONTRASENA,
      confirmacionContrasena: CONTRASENA,
    });
    // Una sesion viva: es la que el cambio de contrasena debe revocar.
    await request(app).post('/api/v1/auth/login').send({ correo: CORREO, contrasena: CONTRASENA });

    await request(app).post('/api/v1/auth/password-recovery').send({ correo: CORREO }).expect(202);

    const evento = await knex('outbox_event')
      .where('event_name', 'UserProfileUpdated')
      .orderBy('id_outbox', 'desc')
      .first();
    const payload =
      typeof evento.payload === 'string' ? JSON.parse(evento.payload) : evento.payload;
    const token = payload.token as string;
    expect(typeof token).toBe('string');

    const nueva = 'ContrasenaRestablecida2026';
    const reset = await request(app)
      .post('/api/v1/auth/password-reset')
      .send({ token, contrasena: nueva, confirmacionContrasena: nueva });

    expect(reset.status).toBe(204);

    // La contrasena cambio de verdad.
    await request(app)
      .post('/api/v1/auth/login')
      .send({ correo: CORREO, contrasena: nueva })
      .expect(200);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ correo: CORREO, contrasena: CONTRASENA })
      .expect(401);
  }, 20000);

  it('el token de recuperacion sirve una sola vez', async () => {
    if (saltarSiNoHayBase()) return;

    await request(app).post('/api/v1/auth/register').send({
      nombre: 'Usuario Integracion',
      correo: CORREO,
      contrasena: CONTRASENA,
      confirmacionContrasena: CONTRASENA,
    });
    await request(app).post('/api/v1/auth/password-recovery').send({ correo: CORREO });

    const evento = await knex('outbox_event')
      .where('event_name', 'UserProfileUpdated')
      .orderBy('id_outbox', 'desc')
      .first();
    const payload =
      typeof evento.payload === 'string' ? JSON.parse(evento.payload) : evento.payload;
    const token = payload.token as string;

    const primera = 'PrimerCambio2026AB';
    await request(app)
      .post('/api/v1/auth/password-reset')
      .send({ token, contrasena: primera, confirmacionContrasena: primera })
      .expect(204);

    const segunda = 'SegundoCambio2026AB';
    await request(app)
      .post('/api/v1/auth/password-reset')
      .send({ token, contrasena: segunda, confirmacionContrasena: segunda })
      .expect(401);
  }, 20000);

  it('cambiar la contrasena cierra las sesiones abiertas', async () => {
    if (saltarSiNoHayBase()) return;

    await request(app).post('/api/v1/auth/register').send({
      nombre: 'Usuario Integracion',
      correo: CORREO,
      contrasena: CONTRASENA,
      confirmacionContrasena: CONTRASENA,
    });
    await request(app).post('/api/v1/auth/login').send({ correo: CORREO, contrasena: CONTRASENA });

    await request(app).post('/api/v1/auth/password-recovery').send({ correo: CORREO });
    const evento = await knex('outbox_event')
      .where('event_name', 'UserProfileUpdated')
      .orderBy('id_outbox', 'desc')
      .first();
    const payload =
      typeof evento.payload === 'string' ? JSON.parse(evento.payload) : evento.payload;

    const nueva = 'OtraContrasenaMas2026';
    await request(app)
      .post('/api/v1/auth/password-reset')
      .send({ token: payload.token, contrasena: nueva, confirmacionContrasena: nueva })
      .expect(204);

    const usuario = await knex('usuario').where('correo', CORREO).first();
    const activas = await knex('refresh_session')
      .where({ id_usuario: usuario.id_usuario })
      .whereNull('revocado_at')
      .count<{ n: number }[]>({ n: '*' });

    // Quien recupera su cuenta suele hacerlo porque sospecha que alguien entro;
    // dejar sesiones vivas conservaria el acceso a quien se intenta expulsar.
    expect(Number(activas[0]?.n)).toBe(0);
  }, 20000);
});

describe('endurecimiento', () => {
  it('rechaza un campo que el esquema no declara', async () => {
    if (saltarSiNoHayBase()) return;

    const r = await request(app)
      .post('/api/v1/auth/register')
      .send({
        nombre: 'Intruso',
        correo: CORREO,
        contrasena: CONTRASENA,
        confirmacionContrasena: CONTRASENA,
        roles: ['ADMINISTRADOR'],
      });

    expect(r.status).toBe(422);
  });

  it('cierra la sesion y deja inservible el access token emitido', async () => {
    if (saltarSiNoHayBase()) return;

    await request(app).post('/api/v1/auth/register').send({
      nombre: 'Usuario Integracion',
      correo: CORREO,
      contrasena: CONTRASENA,
      confirmacionContrasena: CONTRASENA,
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ correo: CORREO, contrasena: CONTRASENA });

    const token = login.body.accessToken;
    await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    // El JWT sigue siendo criptograficamente valido; lo rechaza la lista de
    // denegacion, que es justo el motivo por el que existe.
    const despues = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(despues.status).toBe(401);
  });

  it('entrega la cookie de refresco como httpOnly y SameSite=Strict', async () => {
    if (saltarSiNoHayBase()) return;

    await request(app).post('/api/v1/auth/register').send({
      nombre: 'Usuario Integracion',
      correo: CORREO,
      contrasena: CONTRASENA,
      confirmacionContrasena: CONTRASENA,
    });
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ correo: CORREO, contrasena: CONTRASENA });

    const cookie = (login.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('pa_refresh=')
    );

    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/iu);
    expect(cookie).toMatch(/SameSite=Strict/iu);
    // El refresh token nunca viaja en el cuerpo.
    expect(JSON.stringify(login.body)).not.toContain('pa_refresh');
  });

  it('rechaza una peticion que no venga del gateway', async () => {
    if (saltarSiNoHayBase()) return;

    // Sin el secreto interno, aunque los datos sean validos.
    const r = await supertest(app)
      .post('/api/v1/auth/login')
      .send({ correo: CORREO, contrasena: CONTRASENA });

    expect(r.status).toBe(403);
  });

  it('deja pasar /health sin secreto, porque lo consulta el orquestador', async () => {
    if (saltarSiNoHayBase()) return;

    const r = await supertest(app).get('/health');
    expect(r.status).toBe(200);
  });

  it('responde igual ante un correo inexistente que ante una contrasena incorrecta', async () => {
    if (saltarSiNoHayBase()) return;

    await request(app).post('/api/v1/auth/register').send({
      nombre: 'Usuario Integracion',
      correo: CORREO,
      contrasena: CONTRASENA,
      confirmacionContrasena: CONTRASENA,
    });

    const incorrecta = await request(app)
      .post('/api/v1/auth/login')
      .send({ correo: CORREO, contrasena: 'ContrasenaIncorrecta2026' });
    const inexistente = await request(app)
      .post('/api/v1/auth/login')
      .send({ correo: 'nadie@puntoamigo.local', contrasena: 'ContrasenaIncorrecta2026' });

    expect(inexistente.status).toBe(incorrecta.status);
    expect(inexistente.body.code).toBe(incorrecta.body.code);
    expect(inexistente.body.message).toBe(incorrecta.body.message);
  });
});
