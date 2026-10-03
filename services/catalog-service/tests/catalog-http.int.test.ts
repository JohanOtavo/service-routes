/**
 * Pruebas de integracion de catalog-service contra MySQL real.
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

const OFERENTE = 9201;
const OTRO_OFERENTE = 9202;
const SOLICITANTE = 9203;
const ADMIN = 9204;

const PRESTADOR = 7201;
const OTRO_PRESTADOR = 7202;
/**
 * La categoria la crea la propia prueba y su identificador se descubre.
 *
 * Fijarlo a mano choca con el UNIQUE de `nombre_categoria` de los datos
 * sembrados: el upsert encontraria la categoria real por su nombre e intentaria
 * cambiarle el identificador, que es clave foranea de `servicio`.
 */
const CATEGORIA_NOMBRE = 'Plomeria de prueba de integracion';
let CATEGORIA = 0;

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
  DB_CATALOG_USER: process.env['DB_CATALOG_USER'] ?? 'pa_catalog_svc',
  DB_CATALOG_PASSWORD: process.env['DB_CATALOG_PASSWORD'] ?? '',
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
const solicitante = (): ReturnType<typeof como> => como(SOLICITANTE, ['SOLICITANTE']);
const admin = (): ReturnType<typeof como> => como(ADMIN, ['ADMINISTRADOR']);
/** Sin identidad: asi llega una ruta publica desde el gateway. */
const anonimo = (): ReturnType<typeof como> => como(null);

const servicioNuevo = (): {
  nombre: string;
  descripcion: string;
  idCategoria: number;
} => ({
  nombre: 'Reparacion de fugas de agua',
  descripcion: 'Detecto y reparo fugas en cocina, bano y lavadero. Incluye materiales.',
  idCategoria: CATEGORIA,
});

beforeAll(async () => {
  if (env.DB_CATALOG_PASSWORD === '') {
    motivoNoDisponible = 'falta DB_CATALOG_PASSWORD en el entorno';
    return;
  }

  try {
    const contenedor = buildContainer(envSchema.parse(env));
    app = contenedor.app;
    knex = contenedor.knex;
    await knex.raw('SELECT 1');
    disponible = true;
  } catch (error) {
    motivoNoDisponible = error instanceof Error ? error.message : String(error);
    disponible = false;
  }
});

/**
 * Siembra la replica de prestadores y la categoria.
 *
 * En produccion la replica llega por eventos de provider-service. Aqui se
 * escribe a mano porque la prueba ejerce catalog-service, no la mensajeria.
 */
async function sembrar(): Promise<void> {
  for (const [idPrestador, idUsuario] of [
    [PRESTADOR, OFERENTE],
    [OTRO_PRESTADOR, OTRO_OFERENTE],
  ]) {
    await knex('prestador_ref')
      .insert({
        id_prestador: idPrestador,
        id_usuario: idUsuario,
        nombre: `Prestador ${idPrestador}`,
        especialidad: 'Plomeria',
        estado: 'ACTIVE',
      })
      .onConflict('id_prestador')
      .merge();
  }

  const existente = await knex('categoria_servicio')
    .where({ nombre_categoria: CATEGORIA_NOMBRE })
    .first('id_categoria');

  if (existente === undefined) {
    const [id] = await knex('categoria_servicio').insert({
      nombre_categoria: CATEGORIA_NOMBRE,
      descripcion: 'Solo para pruebas de integracion',
      activa: true,
    });
    CATEGORIA = Number(id);
  } else {
    CATEGORIA = Number(existente.id_categoria);
  }
}

async function limpiar(): Promise<void> {
  const servicios = await knex('servicio')
    .whereIn('id_prestador', [PRESTADOR, OTRO_PRESTADOR])
    .select('id_servicio');

  for (const fila of servicios) {
    await knex('service_rating_summary').where('id_servicio', Number(fila.id_servicio)).delete();
  }
  await knex('servicio').whereIn('id_prestador', [PRESTADOR, OTRO_PRESTADOR]).delete();
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

async function publicar(quien = oferente()): Promise<number> {
  const r = await quien.post('/api/v1/services').send(servicioNuevo());
  expect(r.status).toBe(201);
  return r.body.id as number;
}

describe('publicacion de servicios (SRS RF40 a RF52)', () => {
  it('un oferente publica y nace con su resumen de calificaciones en cero', async () => {
    if (saltar()) return;
    const id = await publicar();

    const fila = await knex('servicio').where('id_servicio', id).first();
    expect(fila.estado).toBe('ACTIVE');
    expect(Number(fila.id_prestador)).toBe(PRESTADOR);

    /**
     * Sin esta fila, la primera calificacion no tendria donde sumarse y se
     * perderia sin que nada fallara.
     */
    const resumen = await knex('service_rating_summary').where('id_servicio', id).first();
    expect(resumen).toBeDefined();
    expect(Number(resumen.total_calificaciones)).toBe(0);

    const eventos = (await knex('outbox_event').select('event_name')).map((e) =>
      String(e.event_name)
    );
    expect(eventos).toContain('ServicePublished');
  });

  it('un solicitante no publica servicios', async () => {
    if (saltar()) return;
    expect((await solicitante().post('/api/v1/services').send(servicioNuevo())).status).toBe(403);
  });

  it('rechaza un cuerpo con campos no declarados', async () => {
    if (saltar()) return;

    const r = await oferente()
      .post('/api/v1/services')
      .send({ ...servicioNuevo(), estado: 'ACTIVE', idPrestador: OTRO_PRESTADOR });
    expect(r.status).toBe(422);
  });

  it('no se publica en una categoria que no existe', async () => {
    if (saltar()) return;

    const r = await oferente()
      .post('/api/v1/services')
      .send({ ...servicioNuevo(), idCategoria: 999999 });
    expect(r.status).toBe(422);
  });

  /**
   * Un cuerpo mal formado es culpa de quien llama, no del servidor. Devolverlo
   * como 500 le dice al cliente que el sistema se rompio y ensucia los
   * registros de errores reales con ruido que cualquiera puede provocar.
   */
  it('un JSON malformado da 422, no 500', async () => {
    if (saltar()) return;

    const r = await supertest(app)
      .post('/api/v1/services')
      .set('x-internal-secret', SECRETO_INTERNO)
      .set('x-internal-user-id', String(OFERENTE))
      .set('x-internal-roles', 'OFERENTE')
      .set('content-type', 'application/json')
      .send('{"nombre": ');

    expect(r.status).toBe(422);
    expect(r.body.code).toBe('VALIDATION_FAILED');
  });

  it('sin secreto interno no se entra, ni siquiera a la busqueda publica', async () => {
    if (saltar()) return;
    expect((await supertest(app).get('/api/v1/services')).status).toBe(403);
  });
});

describe('propiedad del servicio (IDOR)', () => {
  it('otro oferente no edita un servicio ajeno, y recibe 404', async () => {
    if (saltar()) return;
    const id = await publicar();

    const r = await otroOferente()
      .patch(`/api/v1/services/${id}`)
      .send({ nombre: 'Secuestrado por otro' });

    expect(r.status).toBe(404);
    expect((await knex('servicio').where('id_servicio', id).first()).nombre_servicio).toBe(
      servicioNuevo().nombre
    );
  });

  it('otro oferente no desactiva un servicio ajeno', async () => {
    if (saltar()) return;
    const id = await publicar();

    expect((await otroOferente().delete(`/api/v1/services/${id}`)).status).toBe(404);
    expect((await knex('servicio').where('id_servicio', id).first()).estado).toBe('ACTIVE');
  });

  /** El catalogo propio incluye los INACTIVE: su dueno debe poder verlos. */
  it('el catalogo propio solo muestra lo del propio oferente', async () => {
    if (saltar()) return;
    await publicar();
    await publicar(otroOferente());

    const mios = await oferente().get('/api/v1/services/mine');
    expect(mios.status).toBe(200);
    expect(mios.body.total).toBe(1);
    expect(mios.body.elementos[0].idPrestador).toBe(PRESTADOR);
  });
});

describe('busqueda publica (SRS RF45 a RF53)', () => {
  it('la busqueda no exige sesion', async () => {
    if (saltar()) return;
    await publicar();

    const r = await anonimo().get('/api/v1/services');
    expect(r.status).toBe(200);
    expect(r.body.total).toBeGreaterThanOrEqual(1);
  });

  /**
   * El escaparate no es un directorio de telefonos. Los datos de contacto se
   * revelan cuando hay acuerdo, y de eso es dueno request-service.
   */
  it('ningun resultado lleva datos de contacto', async () => {
    if (saltar()) return;
    await publicar();

    const cuerpo = JSON.stringify((await anonimo().get('/api/v1/services')).body);
    expect(cuerpo).not.toContain('telefono');
    expect(cuerpo).not.toContain('correo');
  });

  it('un servicio desactivado desaparece del escaparate', async () => {
    if (saltar()) return;
    const id = await publicar();
    expect((await oferente().delete(`/api/v1/services/${id}`)).status).toBe(204);

    const r = await anonimo().get('/api/v1/services');
    const ids = (r.body.elementos as { id: number }[]).map((e) => e.id);
    expect(ids).not.toContain(id);

    // Y su ficha directa tampoco: si solo desapareciera del listado, seguiria
    // siendo accesible por su enlace.
    expect((await anonimo().get(`/api/v1/services/${id}`)).status).toBe(404);
  });

  /**
   * Si el prestador deja de estar activo, sus servicios se van del escaparate
   * aunque ellos sigan en ACTIVE: es la suspension en cascada vista desde aqui.
   */
  it('un prestador suspendido saca sus servicios del escaparate', async () => {
    if (saltar()) return;
    const id = await publicar();

    await knex('prestador_ref').where('id_prestador', PRESTADOR).update({ estado: 'SUSPENDED' });

    const r = await anonimo().get('/api/v1/services');
    const ids = (r.body.elementos as { id: number }[]).map((e) => e.id);
    expect(ids).not.toContain(id);
    expect((await anonimo().get(`/api/v1/services/${id}`)).status).toBe(404);

    // Pero su dueno lo sigue viendo en su catalogo: no ha desaparecido.
    expect((await oferente().get('/api/v1/services/mine')).body.total).toBe(1);
  });

  it('la pagina esta acotada aunque se pida mas', async () => {
    if (saltar()) return;
    expect((await anonimo().get('/api/v1/services?tamano=10000')).status).toBe(422);
    expect((await anonimo().get('/api/v1/services?tamano=50')).status).toBe(200);
  });

  /** Un texto con comillas o asteriscos no debe romper la consulta FULLTEXT. */
  it('la busqueda por texto aguanta caracteres de puntuacion', async () => {
    if (saltar()) return;
    await publicar();

    for (const texto of ['fugas', 'fugas"', '+fuga -agua', 'repara*', "o'brien"]) {
      const r = await anonimo().get(`/api/v1/services?texto=${encodeURIComponent(texto)}`);
      expect(r.status).toBe(200);
    }
  });
});

describe('categorias (SRS RF41 a RF44)', () => {
  it('el listado de categorias es publico', async () => {
    if (saltar()) return;
    const r = await anonimo().get('/api/v1/categories');
    expect(r.status).toBe(200);
  });

  it('solo un administrador crea o edita categorias', async () => {
    if (saltar()) return;

    expect(
      (await oferente().post('/api/v1/categories').send({ nombre: 'Jardineria' })).status
    ).toBe(403);
    expect((await anonimo().post('/api/v1/categories').send({ nombre: 'Jardineria' })).status).toBe(
      401
    );

    const creada = await admin()
      .post('/api/v1/categories')
      .send({ nombre: 'Jardineria de prueba' });
    expect(creada.status).toBe(201);

    await knex('categoria_servicio').where('id_categoria', creada.body.id).delete();
  });
});
