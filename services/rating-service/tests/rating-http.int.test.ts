/**
 * Pruebas de integracion de rating-service contra MySQL real.
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

const SOLICITANTE = 9301;
const OFERENTE = 9302;
const AJENO = 9303;
const ADMIN = 9304;

const SOLICITUD = 6301;
const SERVICIO = 6401;

let app: Express;
let knex: Knex;
/** El caso de uso, para ejecutar el barrido sin esperar al temporizador. */
let calificarUseCase: ReturnType<typeof buildContainer>['calificar'];
let disponible = false;
let motivoNoDisponible = '';

const env = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  CORS_ORIGIN: 'http://localhost:5173',
  MYSQL_HOST: process.env['MYSQL_HOST'] ?? '127.0.0.1',
  MYSQL_PORT: process.env['MYSQL_PORT'] ?? '3306',
  DB_RATING_USER: process.env['DB_RATING_USER'] ?? 'pa_rating_svc',
  DB_RATING_PASSWORD: process.env['DB_RATING_PASSWORD'] ?? '',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  INTERNAL_SERVICE_SECRET: SECRETO_INTERNO,
  RATE_LIMIT_MAX_PER_IP: '2000',
  // Un plazo de un dia hace legible la prueba del vencimiento.
  BLIND_PERIOD_DAYS: '1',
  RABBITMQ_HOST: process.env['RABBITMQ_HOST'] ?? '127.0.0.1',
  RABBITMQ_PORT: process.env['RABBITMQ_PORT'] ?? '5672',
  RABBITMQ_USER: process.env['RABBITMQ_USER'] ?? 'pa_dev',
  RABBITMQ_PASSWORD: process.env['RABBITMQ_PASSWORD'] ?? 'local',
};

const como = (
  userId: number | null,
  roles: string[] = []
): {
  get: (ruta: string) => supertest.Test;
  post: (ruta: string) => supertest.Test;
  delete: (ruta: string) => supertest.Test;
} => {
  const agente = supertest(app);
  const preparar = (m: 'get' | 'post' | 'delete') => (ruta: string) => {
    let p = agente[m](ruta).set('x-internal-secret', SECRETO_INTERNO);
    if (userId !== null) {
      p = p.set('x-internal-user-id', String(userId)).set('x-internal-roles', roles.join(','));
    }
    return p;
  };
  return { get: preparar('get'), post: preparar('post'), delete: preparar('delete') };
};

const solicitante = (): ReturnType<typeof como> => como(SOLICITANTE, ['SOLICITANTE']);
const oferente = (): ReturnType<typeof como> => como(OFERENTE, ['OFERENTE']);
const ajeno = (): ReturnType<typeof como> => como(AJENO, ['SOLICITANTE', 'OFERENTE']);
const admin = (): ReturnType<typeof como> => como(ADMIN, ['ADMINISTRADOR']);

beforeAll(async () => {
  if (env.DB_RATING_PASSWORD === '') {
    motivoNoDisponible = 'falta DB_RATING_PASSWORD en el entorno';
    return;
  }

  try {
    const contenedor = buildContainer(envSchema.parse(env));
    app = contenedor.app;
    knex = contenedor.knex;
    calificarUseCase = contenedor.calificar;
    await knex.raw('SELECT 1');
    disponible = true;
  } catch (error) {
    motivoNoDisponible = error instanceof Error ? error.message : String(error);
    disponible = false;
  }
});

/**
 * Siembra la replica de la solicitud.
 *
 * En produccion llega por eventos de request-service. Aqui se escribe a mano
 * porque la prueba ejerce rating-service, no la mensajeria.
 */
async function sembrar(estado = 'COMPLETADA'): Promise<void> {
  await knex('solicitud_ref')
    .insert({
      id_solicitud: SOLICITUD,
      id_usuario: SOLICITANTE,
      id_prestador: 7301,
      id_usuario_prestador: OFERENTE,
      id_servicio: SERVICIO,
      estado,
      completada_at: estado === 'COMPLETADA' ? new Date() : null,
    })
    .onConflict('id_solicitud')
    .merge();
}

async function limpiar(): Promise<void> {
  await knex('calificacion').where('id_solicitud', SOLICITUD).delete();
  await knex('cancelacion_ref').where('id_solicitud', SOLICITUD).delete();
  await knex('solicitud_ref').where('id_solicitud', SOLICITUD).delete();
  await knex('reputacion').whereIn('id_usuario', [SOLICITANTE, OFERENTE, AJENO]).delete();
  await knex('tasa_cancelacion').whereIn('id_usuario', [SOLICITANTE, OFERENTE, AJENO]).delete();
  await knex('outbox_event').delete();
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

const calificar = (
  quien: ReturnType<typeof como>,
  puntuacion: number,
  comentario?: string
): supertest.Test =>
  quien.post('/api/v1/ratings').send({
    idSolicitud: SOLICITUD,
    puntuacion,
    ...(comentario === undefined ? {} : { comentario }),
  });

const eventos = async (): Promise<string[]> =>
  (await knex('outbox_event').select('event_name')).map((e) => String(e.event_name));

describe('quien puede calificar (SRS RF78 a RF82, RF164)', () => {
  it('las DOS partes califican, cada una una vez', async () => {
    if (saltar()) return;

    expect((await calificar(solicitante(), 5, 'Puntual y limpio')).status).toBe(201);
    expect((await calificar(oferente(), 4, 'Claro con lo que necesitaba')).status).toBe(201);

    // Y ninguna repite.
    expect((await calificar(solicitante(), 1)).status).toBe(409);
    expect((await calificar(oferente(), 1)).status).toBe(409);
  });

  it('un tercero recibe 404, nunca 403', async () => {
    if (saltar()) return;
    expect((await calificar(ajeno(), 5)).status).toBe(404);
  });

  it('solo se califica una solicitud completada', async () => {
    if (saltar()) return;
    await knex('solicitud_ref')
      .where('id_solicitud', SOLICITUD)
      .update({ estado: 'ACEPTADA', completada_at: null });

    expect((await calificar(solicitante(), 5)).status).toBe(409);
  });

  it('la puntuacion fuera de rango no pasa', async () => {
    if (saltar()) return;
    for (const p of [0, 6, 3.5]) {
      expect((await calificar(solicitante(), p)).status).toBe(422);
    }
  });

  it('sin identidad no se califica', async () => {
    if (saltar()) return;
    expect((await calificar(como(null), 5)).status).toBe(401);
  });
});

describe('periodo ciego (SRS RF166)', () => {
  /**
   * Lo que esta regla protege: si la primera se viera, quien va segundo
   * responderia en represalia y todo el mundo acabaria poniendo cinco
   * estrellas.
   */
  it('la primera queda oculta y no suma a la reputacion', async () => {
    if (saltar()) return;
    const r = await calificar(solicitante(), 5, 'Excelente');
    expect(r.status).toBe(201);
    expect(r.body.visibleAt).toBeNull();

    const fila = await knex('calificacion').where('id_calificacion', r.body.id).first();
    expect(fila.visible_at).toBeNull();

    // La reputacion del receptor sigue sin existir: nada visible que promediar.
    const rep = await knex('reputacion').where('id_usuario', OFERENTE).first();
    expect(rep).toBeUndefined();

    // Y el listado publico no la devuelve.
    const publicas = await ajeno().get(`/api/v1/ratings/users/${OFERENTE}/received`);
    expect(publicas.body.total).toBe(0);
  });

  it('la segunda revela las dos en el mismo instante', async () => {
    if (saltar()) return;
    const primera = await calificar(solicitante(), 5);
    await calificar(oferente(), 3);

    const filas = await knex('calificacion').where('id_solicitud', SOLICITUD);
    expect(filas).toHaveLength(2);
    for (const f of filas) expect(f.visible_at).not.toBeNull();

    // Revelarlas juntas quita la posibilidad de represalia: cuando una se ve,
    // la otra ya estaba escrita.
    expect(new Date(filas[0].visible_at).getTime()).toBe(new Date(filas[1].visible_at).getTime());

    const publicas = await ajeno().get(`/api/v1/ratings/users/${OFERENTE}/received`);
    expect(publicas.body.total).toBe(1);
    expect(publicas.body.elementos[0].id).toBe(primera.body.id);
  });

  it('al revelarse, la reputacion se recalcula por faceta', async () => {
    if (saltar()) return;
    await calificar(solicitante(), 5);
    await calificar(oferente(), 3);

    const comoOferente = await knex('reputacion')
      .where({ id_usuario: OFERENTE, faceta: 'COMO_OFERENTE' })
      .first();
    const comoSolicitante = await knex('reputacion')
      .where({ id_usuario: SOLICITANTE, faceta: 'COMO_SOLICITANTE' })
      .first();

    // Cada quien en SU faceta: ser buen oferente y ser buen solicitante son
    // cosas distintas y promediarlas destruiria informacion (SRS RF165).
    expect(Number(comoOferente.puntuacion_media)).toBe(5);
    expect(Number(comoSolicitante.puntuacion_media)).toBe(3);

    expect(await eventos()).toContain('ReputationRecalculated');
  });

  /**
   * Sin plazo, quien recibio un mal servicio y no califica dejaria la
   * calificacion de la otra parte oculta para siempre.
   */
  it('el barrido revela las que ya vencieron el plazo', async () => {
    if (saltar()) return;
    const r = await calificar(solicitante(), 5);

    const antes = await ajeno().get(`/api/v1/ratings/users/${OFERENTE}/received`);
    expect(antes.body.total).toBe(0);

    // Se envejece la calificacion mas alla del plazo configurado (un dia).
    await knex('calificacion')
      .where('id_calificacion', r.body.id)
      .update({ fecha: new Date(Date.now() - 3 * 86_400_000) });

    const reveladas = await runInTransaction(knex, () =>
      calificarUseCase.vencerPeriodosCiegos({
        lote: 50,
        correlationId: '00000000-0000-4000-8000-000000000000',
      })
    );
    expect(reveladas).toBe(1);

    const despues = await ajeno().get(`/api/v1/ratings/users/${OFERENTE}/received`);
    expect(despues.body.total).toBe(1);

    // Y la reputacion ya cuenta esa nota, aunque la contraparte nunca calificara.
    const rep = await knex('reputacion')
      .where({ id_usuario: OFERENTE, faceta: 'COMO_OFERENTE' })
      .first();
    expect(Number(rep.puntuacion_media)).toBe(5);
  });

  /** Una ya revelada no vuelve a vencer ni cambia de fecha. */
  it('el barrido no toca las que ya estaban visibles', async () => {
    if (saltar()) return;
    await calificar(solicitante(), 5);
    await calificar(oferente(), 4);

    const antes = await knex('calificacion')
      .where('id_solicitud', SOLICITUD)
      .orderBy('id_calificacion');

    const reveladas = await runInTransaction(knex, () =>
      calificarUseCase.vencerPeriodosCiegos({
        lote: 50,
        correlationId: '00000000-0000-4000-8000-000000000000',
      })
    );
    expect(reveladas).toBe(0);

    const despues = await knex('calificacion')
      .where('id_solicitud', SOLICITUD)
      .orderBy('id_calificacion');
    expect(new Date(despues[0].visible_at).getTime()).toBe(new Date(antes[0].visible_at).getTime());
  });
});

describe('lo que se publica y lo que no (SRS RF85, RF167, RF192)', () => {
  const reveladas = async (): Promise<void> => {
    await calificar(solicitante(), 5, 'Trabajo impecable');
    await calificar(oferente(), 4);
  };

  it('la vista publica no filtra el emisor ni la marca de moderacion', async () => {
    if (saltar()) return;
    await reveladas();

    const r = await ajeno().get(`/api/v1/ratings/users/${OFERENTE}/received`);
    const cuerpo = JSON.stringify(r.body);
    expect(cuerpo).not.toContain('idEmisor');
    expect(cuerpo).not.toContain('ocultaPorModeracion');
  });

  /**
   * Si el autor pudiera retirar la suya, bastaria hacerlo cada vez que la
   * contraparte respondiera mal y la reputacion solo guardaria elogios.
   */
  it('solo un administrador retira una calificacion', async () => {
    if (saltar()) return;
    await reveladas();
    const id = (await knex('calificacion').where('id_receptor', OFERENTE).first()).id_calificacion;

    expect((await solicitante().delete(`/api/v1/ratings/${id}`)).status).toBe(403);
    expect((await ajeno().delete(`/api/v1/ratings/${id}`)).status).toBe(403);
    expect((await admin().delete(`/api/v1/ratings/${id}`)).status).toBe(204);
  });

  /**
   * Retirarla sin restarla de la media la dejaria contando: el administrador
   * creeria haberla quitado y el numero seguiria incluyendola.
   */
  it('retirar una calificacion la resta de la reputacion', async () => {
    if (saltar()) return;
    await reveladas();

    const antes = await knex('reputacion')
      .where({ id_usuario: OFERENTE, faceta: 'COMO_OFERENTE' })
      .first();
    expect(Number(antes.total_calificaciones)).toBe(1);

    const id = (await knex('calificacion').where('id_receptor', OFERENTE).first()).id_calificacion;
    expect((await admin().delete(`/api/v1/ratings/${id}`)).status).toBe(204);

    const despues = await knex('reputacion')
      .where({ id_usuario: OFERENTE, faceta: 'COMO_OFERENTE' })
      .first();
    expect(Number(despues.total_calificaciones)).toBe(0);
    expect(Number(despues.puntuacion_media)).toBe(0);

    // Y desaparece del listado publico.
    const publicas = await ajeno().get(`/api/v1/ratings/users/${OFERENTE}/received`);
    expect(publicas.body.total).toBe(0);
  });

  it('el perfil publico devuelve las dos facetas, aunque esten vacias', async () => {
    if (saltar()) return;

    const r = await ajeno().get(`/api/v1/ratings/users/${OFERENTE}`);
    expect(r.status).toBe(200);
    expect(r.body.facetas.COMO_OFERENTE).toEqual({
      puntuacionMedia: 0,
      totalCalificaciones: 0,
    });
    expect(r.body.facetas.COMO_SOLICITANTE).toBeDefined();
  });

  /**
   * Publicar el 0 % de todo el mundo no disuade a nadie y si expone a quien
   * cancelo una vez de forma justificada (SRS RF192).
   */
  it('la tasa de cancelacion no aparece por debajo del primer umbral', async () => {
    if (saltar()) return;

    await knex('tasa_cancelacion').insert({
      id_usuario: OFERENTE,
      faceta: 'COMO_OFERENTE',
      contrataciones_en_ventana: 20,
      cancelaciones_ponderadas: 1,
      tasa: 0.05,
      umbral_alcanzado: 0,
      evaluable: true,
      ventana_desde: new Date(Date.now() - 90 * 86_400_000),
      calculada_at: new Date(),
    });

    const r = await ajeno().get(`/api/v1/ratings/users/${OFERENTE}`);
    expect(r.body.facetas.COMO_OFERENTE.tasaCancelacion).toBeUndefined();
  });

  it('a partir del primer umbral si aparece', async () => {
    if (saltar()) return;

    await knex('tasa_cancelacion').insert({
      id_usuario: OFERENTE,
      faceta: 'COMO_OFERENTE',
      contrataciones_en_ventana: 10,
      cancelaciones_ponderadas: 2,
      tasa: 0.2,
      umbral_alcanzado: 1,
      evaluable: true,
      ventana_desde: new Date(Date.now() - 90 * 86_400_000),
      calculada_at: new Date(),
    });

    const r = await ajeno().get(`/api/v1/ratings/users/${OFERENTE}`);
    expect(r.body.facetas.COMO_OFERENTE.tasaCancelacion).toBe(0.2);
    expect(r.body.facetas.COMO_OFERENTE.umbralAlcanzado).toBe(1);
  });

  it('la pagina esta acotada aunque se pida mas', async () => {
    if (saltar()) return;
    expect(
      (await ajeno().get(`/api/v1/ratings/users/${OFERENTE}/received?tamano=10000`)).status
    ).toBe(422);
  });
});
