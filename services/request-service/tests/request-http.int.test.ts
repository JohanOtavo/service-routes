/**
 * Pruebas de integracion de request-service contra MySQL real.
 *
 *   docker compose up -d
 *   npx jest --selectProjects integration
 *
 * Se salta sola si no hay base disponible. Con REQUIRE_INTEGRATION=1 el fallo
 * se propaga en lugar de disfrazarse de exito.
 */
import supertest from 'supertest';
import type { Express } from 'express';
import type { Knex } from 'knex';
import { buildContainer, envSchema } from '../src/main';

const SECRETO_INTERNO = 'solo-para-pruebas-de-integracion';

const SOLICITANTE = 8101;
const OFERENTE = 8102;
const OTRO_OFERENTE = 8103;
const AJENO = 8104;

const PRESTADOR = 7101;
const OTRO_PRESTADOR = 7102;
const SERVICIO = 6101;
const CATEGORIA = 5101;

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
  DB_REQUEST_USER: process.env['DB_REQUEST_USER'] ?? 'pa_request_svc',
  DB_REQUEST_PASSWORD: process.env['DB_REQUEST_PASSWORD'] ?? '',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  INTERNAL_SERVICE_SECRET: SECRETO_INTERNO,
  RATE_LIMIT_MAX_PER_IP: '2000',
  RABBITMQ_HOST: process.env['RABBITMQ_HOST'] ?? '127.0.0.1',
  RABBITMQ_PORT: process.env['RABBITMQ_PORT'] ?? '5672',
  RABBITMQ_USER: process.env['RABBITMQ_USER'] ?? 'pa_dev',
  RABBITMQ_PASSWORD: process.env['RABBITMQ_PASSWORD'] ?? 'local',
};

/** Cliente que imita al gateway: secreto interno mas identidad en cabeceras. */
const como = (userId: number | null, roles: string[] = []) => {
  const agente = supertest(app);
  const preparar = (m: 'get' | 'post' | 'patch' | 'delete') => (ruta: string) => {
    let p = agente[m](ruta).set('x-internal-secret', SECRETO_INTERNO);
    if (userId !== null) {
      p = p.set('x-internal-user-id', String(userId)).set('x-internal-roles', roles.join(','));
    }
    return p;
  };
  return { get: preparar('get'), post: preparar('post'), patch: preparar('patch'), delete: preparar('delete') };
};

const solicitante = () => como(SOLICITANTE, ['SOLICITANTE']);
const oferente = () => como(OFERENTE, ['OFERENTE']);
const otroOferente = () => como(OTRO_OFERENTE, ['OFERENTE']);
const ajeno = () => como(AJENO, ['SOLICITANTE', 'OFERENTE']);

const NECESIDAD = {
  titulo: 'Fuga de agua bajo el lavaplatos',
  descripcion: 'Hay una fuga constante bajo el lavaplatos y moja todo el mueble de la cocina.',
  idCategoria: CATEGORIA,
};

const PROPUESTA = {
  precio: '150000.00',
  tiempoEstimado: 2,
  mensaje: 'Reviso la union, cambio el sifon y sello. Incluye materiales.',
};

beforeAll(async () => {
  if (env.DB_REQUEST_PASSWORD === '') {
    motivoNoDisponible = 'falta DB_REQUEST_PASSWORD en el entorno';
    return;
  }

  try {
    const contenedor = buildContainer(envSchema.parse(env));
    app = contenedor.app;
    knex = contenedor.knex;
    await knex.raw('SELECT 1');
    disponible = true;
  } catch (error) {
    // El motivo se conserva. Tragarlo convierte un error de configuracion en
    // una suite que "pasa" sin haber ejecutado nada.
    motivoNoDisponible = error instanceof Error ? error.message : String(error);
    disponible = false;
  }
});

/**
 * Siembra las replicas que este servicio necesita.
 *
 * En produccion llegan por eventos de provider-service y catalog-service. Aqui
 * se escriben a mano porque la prueba ejerce request-service, no la mensajeria:
 * levantar los otros dos servicios para probar una adjudicacion convertiria
 * esto en una prueba de sistema y tardaria un orden de magnitud mas.
 */
async function sembrarReplicas(): Promise<void> {
  // `usuario_ref` es clave foranea de `necesidad` y de `solicitud_servicio`, y
  // ademas guarda el contacto que se revela cuando hay acuerdo (SRS RF156).
  for (const idUsuario of [SOLICITANTE, OFERENTE, OTRO_OFERENTE, AJENO]) {
    await knex('usuario_ref')
      .insert({
        id_usuario: idUsuario,
        nombre: `Usuario ${idUsuario}`,
        correo: `u${idUsuario}@puntoamigo.local`,
        telefono: null,
        estado: 'ACTIVO',
      })
      .onConflict('id_usuario')
      .merge();
  }

  await knex('categoria_ref')
    .insert({ id_categoria: CATEGORIA, nombre_categoria: 'Plomeria', activa: true })
    .onConflict('id_categoria')
    .merge();

  for (const [idPrestador, idUsuario] of [
    [PRESTADOR, OFERENTE],
    [OTRO_PRESTADOR, OTRO_OFERENTE],
  ]) {
    await knex('prestador_ref')
      .insert({
        id_prestador: idPrestador,
        id_usuario: idUsuario,
        nombre: 'Prestador de prueba',
        especialidad: 'Plomeria',
        estado: 'ACTIVE',
      })
      .onConflict('id_prestador')
      .merge();
  }

  await knex('servicio_ref')
    .insert({
      id_servicio: SERVICIO,
      id_prestador: PRESTADOR,
      id_categoria: CATEGORIA,
      nombre_servicio: 'Reparacion de fugas',
      estado: 'ACTIVE',
    })
    .onConflict('id_servicio')
    .merge();
}

async function limpiar(): Promise<void> {
  const usuarios = [SOLICITANTE, OFERENTE, OTRO_OFERENTE, AJENO];

  const solicitudes = await knex('solicitud_servicio')
    .whereIn('id_usuario', usuarios)
    .select('id_solicitud');

  for (const fila of solicitudes) {
    const id = Number(fila.id_solicitud);
    await knex('cancelacion').where('id_solicitud', id).delete();
    await knex('historial_solicitud').where('id_solicitud', id).delete();
  }
  await knex('solicitud_servicio').whereIn('id_usuario', usuarios).delete();

  const necesidades = await knex('necesidad').whereIn('id_usuario', usuarios).select('id_necesidad');
  for (const fila of necesidades) {
    await knex('propuesta').where('id_necesidad', Number(fila.id_necesidad)).delete();
  }
  await knex('necesidad').whereIn('id_usuario', usuarios).delete();

  await knex('outbox_event').delete();
}

beforeEach(async () => {
  if (!disponible) return;
  await limpiar();
  await sembrarReplicas();
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
    // eslint-disable-next-line no-console
    console.warn(`pruebas de integracion omitidas: ${motivoNoDisponible}`);
    return true;
  }
  return false;
};

async function publicarNecesidad(): Promise<number> {
  const r = await solicitante().post('/api/v1/needs').send(NECESIDAD);
  expect(r.status).toBe(201);
  return r.body.id as number;
}

async function enviarPropuesta(idNecesidad: number, quien = oferente()): Promise<number> {
  const r = await quien.post(`/api/v1/needs/${idNecesidad}/proposals`).send(PROPUESTA);
  expect(r.status).toBe(201);
  return r.body.id as number;
}

const eventos = async (): Promise<string[]> =>
  (await knex('outbox_event').select('event_name')).map((e) => String(e.event_name));

describe('necesidades (SRS RF120 a RF136)', () => {
  it('un solicitante publica y la ve en las suyas', async () => {
    if (saltar()) return;
    const id = await publicarNecesidad();

    const fila = await knex('necesidad').where('id_necesidad', id).first();
    expect(fila.estado).toBe('ABIERTA');
    expect(await eventos()).toContain('NeedPublished');

    const mias = await solicitante().get('/api/v1/needs/mine');
    expect(mias.body.total).toBe(1);
  });

  /**
   * El listado para oferentes no lleva el autor. Si lo llevara, un oferente
   * podria contactar por fuera y la plataforma se quedaria sin su unica razon
   * de ser (riesgo N-01, desintermediacion).
   */
  it('el listado para oferentes no revela quien publico', async () => {
    if (saltar()) return;
    await publicarNecesidad();

    const r = await oferente().get('/api/v1/needs');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    expect(r.body.elementos[0].idUsuario).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain(String(SOLICITANTE));
  });

  it('otro solicitante no edita una necesidad ajena, y recibe 404', async () => {
    if (saltar()) return;
    const id = await publicarNecesidad();

    const r = await ajeno().patch(`/api/v1/needs/${id}`).send({ titulo: 'Secuestrada por otro' });
    expect(r.status).toBe(404);

    const fila = await knex('necesidad').where('id_necesidad', id).first();
    expect(fila.titulo).toBe(NECESIDAD.titulo);
  });

  it('una categoria que no existe no deja publicar', async () => {
    if (saltar()) return;

    const r = await solicitante().post('/api/v1/needs').send({ ...NECESIDAD, idCategoria: 999999 });
    expect(r.status).toBe(409);
  });

  it('un oferente no publica necesidades', async () => {
    if (saltar()) return;
    expect((await oferente().post('/api/v1/needs').send(NECESIDAD)).status).toBe(403);
  });
});

describe('propuestas (SRS RF137 a RF148)', () => {
  it('un oferente propone y el autor la ve', async () => {
    if (saltar()) return;
    const idNecesidad = await publicarNecesidad();
    await enviarPropuesta(idNecesidad);

    expect(await eventos()).toContain('ProposalSubmitted');

    const lista = await solicitante().get(`/api/v1/needs/${idNecesidad}/proposals`);
    expect(lista.status).toBe(200);
    expect(lista.body).toHaveLength(1);
  });

  /**
   * Si un oferente viera las propuestas de los demas, sabria contra que precios
   * compite y bastaria rebajar un peso la mas barata para ganar siempre.
   */
  it('ningun otro oferente ve las propuestas de una necesidad', async () => {
    if (saltar()) return;
    const idNecesidad = await publicarNecesidad();
    await enviarPropuesta(idNecesidad);

    expect((await otroOferente().get(`/api/v1/needs/${idNecesidad}/proposals`)).status).toBe(403);
    // Y tampoco otro solicitante que no sea el autor.
    expect((await ajeno().get(`/api/v1/needs/${idNecesidad}/proposals`)).status).toBe(404);
  });

  it('no se envian dos propuestas vigentes a la misma necesidad', async () => {
    if (saltar()) return;
    const idNecesidad = await publicarNecesidad();
    await enviarPropuesta(idNecesidad);

    const segunda = await oferente().post(`/api/v1/needs/${idNecesidad}/proposals`).send(PROPUESTA);
    expect(segunda.status).toBe(409);
  });

  /** Adjuntar el servicio mejor valorado de otro seria apropiarse de su reputacion. */
  it('no se adjunta un servicio de otro prestador', async () => {
    if (saltar()) return;
    const idNecesidad = await publicarNecesidad();

    const r = await otroOferente()
      .post(`/api/v1/needs/${idNecesidad}/proposals`)
      .send({ ...PROPUESTA, idServicio: SERVICIO });

    expect(r.status).toBe(404);
  });

  it('otro oferente no modifica ni retira una propuesta ajena', async () => {
    if (saltar()) return;
    const idNecesidad = await publicarNecesidad();
    const idPropuesta = await enviarPropuesta(idNecesidad);

    expect(
      (await otroOferente().patch(`/api/v1/proposals/${idPropuesta}`).send({ precio: '1.00' }))
        .status
    ).toBe(404);
    expect((await otroOferente().delete(`/api/v1/proposals/${idPropuesta}`)).status).toBe(404);

    const fila = await knex('propuesta').where('id_propuesta', idPropuesta).first();
    expect(String(fila.precio)).toBe(PROPUESTA.precio);
    expect(fila.estado).toBe('ENVIADA');
  });
});

describe('adjudicacion (SRS RF149 a RF153)', () => {
  /**
   * La operacion mas delicada del servicio: toca cuatro cosas a la vez. Lo que
   * esta prueba comprueba es que o pasan todas o no pasa ninguna.
   */
  it('adjudicar acepta una, descarta el resto y crea la contratacion', async () => {
    if (saltar()) return;
    const idNecesidad = await publicarNecesidad();
    const elegida = await enviarPropuesta(idNecesidad);
    const perdedora = await enviarPropuesta(idNecesidad, otroOferente());

    const r = await solicitante()
      .post(`/api/v1/needs/${idNecesidad}/award`)
      .send({ idPropuesta: elegida });

    expect(r.status).toBe(201);
    // Nace ACEPTADA, no PENDIENTE: el acuerdo ya se alcanzo al adjudicar.
    expect(r.body.estado).toBe('ACEPTADA');
    expect(r.body.origen).toBe('ADJUDICACION');

    expect((await knex('necesidad').where('id_necesidad', idNecesidad).first()).estado).toBe(
      'ADJUDICADA'
    );
    expect((await knex('propuesta').where('id_propuesta', elegida).first()).estado).toBe('ACEPTADA');
    expect((await knex('propuesta').where('id_propuesta', perdedora).first()).estado).toBe(
      'DESCARTADA'
    );

    const publicados = await eventos();
    expect(publicados).toContain('ProposalAwarded');
    expect(publicados).toContain('ProposalDiscarded');
    expect(publicados).toContain('ServiceRequestCreated');
  });

  /** El precio y el plazo se congelan: son el acuerdo, no una preferencia. */
  it('la contratacion copia el precio y el plazo de la propuesta', async () => {
    if (saltar()) return;
    const idNecesidad = await publicarNecesidad();
    const elegida = await enviarPropuesta(idNecesidad);

    const r = await solicitante()
      .post(`/api/v1/needs/${idNecesidad}/award`)
      .send({ idPropuesta: elegida });

    expect(String(r.body.valorAcordado)).toBe(PROPUESTA.precio);
    expect(r.body.plazoAcordado).toBe(PROPUESTA.tiempoEstimado);
  });

  it('solo el autor de la necesidad adjudica', async () => {
    if (saltar()) return;
    const idNecesidad = await publicarNecesidad();
    const idPropuesta = await enviarPropuesta(idNecesidad);

    const r = await ajeno()
      .post(`/api/v1/needs/${idNecesidad}/award`)
      .send({ idPropuesta });
    expect(r.status).toBe(404);

    // Y nada cambio: un 404 que ya escribio seria peor que un 403.
    expect((await knex('necesidad').where('id_necesidad', idNecesidad).first()).estado).toBe(
      'ABIERTA'
    );
    expect((await knex('propuesta').where('id_propuesta', idPropuesta).first()).estado).toBe(
      'ENVIADA'
    );
  });

  it('no se adjudica dos veces', async () => {
    if (saltar()) return;
    const idNecesidad = await publicarNecesidad();
    const primera = await enviarPropuesta(idNecesidad);
    const segunda = await enviarPropuesta(idNecesidad, otroOferente());

    await solicitante().post(`/api/v1/needs/${idNecesidad}/award`).send({ idPropuesta: primera });

    const r = await solicitante()
      .post(`/api/v1/needs/${idNecesidad}/award`)
      .send({ idPropuesta: segunda });
    expect(r.status).toBe(409);
  });
});

describe('contratacion directa y contacto (SRS RF60 a RF70, RF156)', () => {
  const crearDirecta = async (): Promise<number> => {
    const r = await solicitante()
      .post('/api/v1/requests')
      .send({ idServicio: SERVICIO, descripcionProblema: 'Fuga bajo el lavaplatos, urge.' });
    expect(r.status).toBe(201);
    return r.body.id as number;
  };

  it('nace PENDIENTE y espera al oferente', async () => {
    if (saltar()) return;
    const id = await crearDirecta();

    const fila = await knex('solicitud_servicio').where('id_solicitud', id).first();
    expect(fila.estado).toBe('PENDIENTE');
    expect(fila.origen).toBe('DIRECTA');
  });

  /**
   * La frontera que sostiene toda la intermediacion: el contacto no aparece
   * hasta que hay acuerdo.
   */
  it('el contacto no se revela antes de aceptar, y si despues', async () => {
    if (saltar()) return;
    const id = await crearDirecta();

    const antes = await solicitante().get(`/api/v1/requests/${id}`);
    expect(antes.body.contacto).toBeNull();

    expect(
      (await oferente().patch(`/api/v1/requests/${id}/status`).send({ destino: 'ACEPTADA' })).status
    ).toBe(200);

    const despues = await solicitante().get(`/api/v1/requests/${id}`);
    expect(despues.body.contacto).not.toBeNull();
    // El de la CONTRAPARTE, no el propio: cada parte ya conoce el suyo.
    expect(despues.body.contacto.idUsuario).toBe(OFERENTE);
    expect(despues.body.contacto.correo).toBe(`u${OFERENTE}@puntoamigo.local`);
  });

  it('un tercero no ve una contratacion ajena', async () => {
    if (saltar()) return;
    const id = await crearDirecta();

    expect((await ajeno().get(`/api/v1/requests/${id}`)).status).toBe(404);
  });

  /** Solo el oferente acepta. El solicitante no se acepta su propia solicitud. */
  it('el solicitante no acepta su propia solicitud', async () => {
    if (saltar()) return;
    const id = await crearDirecta();

    const r = await solicitante().patch(`/api/v1/requests/${id}/status`).send({ destino: 'ACEPTADA' });
    expect(r.status).toBe(409);
  });

  it('no se completa una solicitud que nadie acepto', async () => {
    if (saltar()) return;
    const id = await crearDirecta();

    expect(
      (await oferente().patch(`/api/v1/requests/${id}/status`).send({ destino: 'COMPLETADA' }))
        .status
    ).toBe(409);
  });

  it('no se puede contratar el servicio propio', async () => {
    if (saltar()) return;

    const r = await como(OFERENTE, ['SOLICITANTE'])
      .post('/api/v1/requests')
      .send({ idServicio: SERVICIO, descripcionProblema: 'Me contrato a mi mismo para subir nota.' });

    expect(r.status).toBe(409);
  });
});

describe('politica de cancelacion (SRS 10.2, RF174 a RF186)', () => {
  /** Deja una contratacion ACEPTADA por adjudicacion y devuelve sus identificadores. */
  async function adjudicada(): Promise<{ idSolicitud: number; idNecesidad: number }> {
    const idNecesidad = await publicarNecesidad();
    const idPropuesta = await enviarPropuesta(idNecesidad);
    const r = await solicitante()
      .post(`/api/v1/needs/${idNecesidad}/award`)
      .send({ idPropuesta });
    return { idSolicitud: r.body.id as number, idNecesidad };
  }

  const dentroDe = (horas: number): string =>
    new Date(Date.now() + horas * 3_600_000).toISOString();

  /** Saca la aceptacion de la ventana de gracia. El reloj se lee del historial. */
  const envejecerAceptacion = async (idSolicitud: number): Promise<void> => {
    await knex('historial_solicitud')
      .where({ id_solicitud: idSolicitud, estado_nuevo: 'ACEPTADA' })
      .update({ fecha_cambio: new Date(Date.now() - 72 * 3_600_000) });
  };

  /**
   * Recien aceptada, la ventana de gracia esta abierta: cancelar no cuesta
   * nada. Es el equivalente a cancelar un viaje a los treinta segundos.
   */
  it('dentro de la gracia no computa, sea cual sea el motivo', async () => {
    if (saltar()) return;
    const { idSolicitud } = await adjudicada();

    const r = await solicitante()
      .post(`/api/v1/requests/${idSolicitud}/cancel`)
      .send({ codigoMotivo: 'YA_NO_LO_NECESITO', fechaAcordada: dentroDe(1) });

    expect(r.status).toBe(200);
    expect(r.body.franja).toBe('GRACIA');
    expect(r.body.peso).toBe(0);
    expect(r.body.computa).toBe(false);

    const fila = await knex('cancelacion').where('id_solicitud', idSolicitud).first();
    expect(fila.franja).toBe('GRACIA');
    expect(Number(fila.peso)).toBe(0);
  });

  /**
   * Pasada la gracia, el peso depende de cuanto aviso se dio respecto de la
   * fecha acordada: lo que dana a la contraparte es quedarse sin margen.
   */
  it('pasada la gracia, el peso sube cuanto mas cerca este la fecha acordada', async () => {
    if (saltar()) return;
    const { idSolicitud } = await adjudicada();
    await envejecerAceptacion(idSolicitud);

    const r = await solicitante()
      .post(`/api/v1/requests/${idSolicitud}/cancel`)
      // Seis horas de margen: dentro de las 48 que separan holgada de ajustada.
      .send({ codigoMotivo: 'YA_NO_LO_NECESITO', fechaAcordada: dentroDe(6) });

    expect(r.body.franja).toBe('AJUSTADA');
    expect(r.body.peso).toBe(1);
    expect(r.body.computa).toBe(true);
  });

  it('cancelar con la fecha ya pasada es lo mas caro', async () => {
    if (saltar()) return;
    const { idSolicitud } = await adjudicada();
    await envejecerAceptacion(idSolicitud);

    const r = await solicitante()
      .post(`/api/v1/requests/${idSolicitud}/cancel`)
      .send({ codigoMotivo: 'YA_NO_LO_NECESITO', fechaAcordada: dentroDe(-1) });

    expect(r.body.franja).toBe('TARDIA');
    expect(r.body.peso).toBe(1.5);
  });

  /**
   * Un motivo que traslada la falta NO se da por bueno solo porque quien
   * cancela lo elija. Si bastara con elegirlo, todo el mundo elegiria ese.
   */
  it('un motivo que traslada la falta abre revision y no computa todavia', async () => {
    if (saltar()) return;
    const { idSolicitud } = await adjudicada();
    await envejecerAceptacion(idSolicitud);

    const r = await solicitante()
      .post(`/api/v1/requests/${idSolicitud}/cancel`)
      .send({ codigoMotivo: 'CONTRAPARTE_NO_SE_PRESENTO', fechaAcordada: dentroDe(-1) });

    expect(r.status).toBe(200);
    expect(r.body.enRevision).toBe(true);
    expect(r.body.computa).toBe(false);

    const fila = await knex('cancelacion').where('id_solicitud', idSolicitud).first();
    expect(fila.estado).toBe('EN_REVISION');
  });

  it('un motivo que no existe en el catalogo no vale', async () => {
    if (saltar()) return;
    const { idSolicitud } = await adjudicada();

    const r = await solicitante()
      .post(`/api/v1/requests/${idSolicitud}/cancel`)
      .send({ codigoMotivo: 'EL_PERRO_SE_COMIO_LA_LLAVE' });

    expect(r.status).toBe(422);
    // La solicitud sigue viva: clasificar antes de validar el motivo habria
    // dejado una cancelacion registrada de una solicitud no cancelada.
    expect((await knex('solicitud_servicio').where('id_solicitud', idSolicitud).first()).estado).toBe(
      'ACEPTADA'
    );
  });
});

describe('retractacion y reparacion (SRS RF184 a RF186)', () => {
  async function adjudicada(): Promise<{ idSolicitud: number; idNecesidad: number }> {
    const idNecesidad = await publicarNecesidad();
    const idPropuesta = await enviarPropuesta(idNecesidad);
    const r = await solicitante()
      .post(`/api/v1/needs/${idNecesidad}/award`)
      .send({ idPropuesta });
    return { idSolicitud: r.body.id as number, idNecesidad };
  }

  /**
   * El caso mas grave: al adjudicar se descartaron todas las demas propuestas,
   * asi que si ahora el oferente se retira, el solicitante esta PEOR que antes
   * de publicar. Como no hay dinero con el que compensar, la reparacion es
   * devolverle la necesidad al mercado con mas tiempo.
   */
  it('si el oferente se retracta, la necesidad vuelve a abrirse con mas vigencia', async () => {
    if (saltar()) return;
    const { idSolicitud, idNecesidad } = await adjudicada();

    const antes = await knex('necesidad').where('id_necesidad', idNecesidad).first();
    expect(antes.estado).toBe('ADJUDICADA');

    const r = await oferente()
      .post(`/api/v1/requests/${idSolicitud}/cancel`)
      .send({ codigoMotivo: 'NO_PUEDO_ATENDERLO' });
    expect(r.status).toBe(200);

    const despues = await knex('necesidad').where('id_necesidad', idNecesidad).first();
    expect(despues.estado).toBe('ABIERTA');
    expect(new Date(despues.fecha_vigencia).getTime()).toBeGreaterThan(
      new Date(antes.fecha_vigencia).getTime()
    );
    expect(await eventos()).toContain('NeedReopened');
  });

  /** Si cancela el solicitante, es el quien decide si vuelve a publicar. */
  it('si cancela el solicitante, la necesidad NO se reabre sola', async () => {
    if (saltar()) return;
    const { idSolicitud, idNecesidad } = await adjudicada();

    await solicitante()
      .post(`/api/v1/requests/${idSolicitud}/cancel`)
      .send({ codigoMotivo: 'YA_NO_LO_NECESITO' });

    expect((await knex('necesidad').where('id_necesidad', idNecesidad).first()).estado).toBe(
      'ADJUDICADA'
    );
  });

  it('un tercero no cancela una contratacion ajena', async () => {
    if (saltar()) return;
    const { idSolicitud } = await adjudicada();

    const r = await ajeno()
      .post(`/api/v1/requests/${idSolicitud}/cancel`)
      .send({ codigoMotivo: 'YA_NO_LO_NECESITO' });

    expect(r.status).toBe(404);
    expect((await knex('solicitud_servicio').where('id_solicitud', idSolicitud).first()).estado).toBe(
      'ACEPTADA'
    );
  });

  /**
   * Cancelar por `/status` saltaria el motivo, la clasificacion y la
   * imputacion. Es decir, toda la politica.
   */
  it('no se puede cancelar por la ruta de cambio de estado', async () => {
    if (saltar()) return;
    const { idSolicitud } = await adjudicada();

    const r = await solicitante()
      .patch(`/api/v1/requests/${idSolicitud}/status`)
      .send({ destino: 'CANCELADA' });

    expect(r.status).toBe(422);
  });

  it('el evento de cancelacion lleva el peso y la faceta ya resueltos', async () => {
    if (saltar()) return;
    const { idSolicitud } = await adjudicada();
    await knex('historial_solicitud')
      .where({ id_solicitud: idSolicitud, estado_nuevo: 'ACEPTADA' })
      .update({ fecha_cambio: new Date(Date.now() - 72 * 3_600_000) });

    await oferente()
      .post(`/api/v1/requests/${idSolicitud}/cancel`)
      .send({
        codigoMotivo: 'NO_PUEDO_ATENDERLO',
        fechaAcordada: new Date(Date.now() - 3_600_000).toISOString(),
      });

    const fila = await knex('outbox_event').where('event_name', 'ServiceRequestCancelled').first();
    const payload = typeof fila.payload === 'string' ? JSON.parse(fila.payload) : fila.payload;

    // rating-service no vuelve a clasificar: la politica vive en un solo sitio.
    expect(payload.peso).toBe(1.5);
    expect(payload.computa).toBe(true);
    expect(payload.faceta).toBe('COMO_OFERENTE');
    expect(payload.parteCanceladora).toBe('OFERENTE');
  });
});
