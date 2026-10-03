/**
 * Pruebas de integracion de admin-reporting-service contra MySQL real.
 *
 *   docker compose up -d
 *   npx jest --selectProjects integration
 */
import { randomUUID } from 'node:crypto';
import supertest from 'supertest';
import type { Express } from 'express';
import type { Knex } from 'knex';
import { buildContainer, envSchema } from '../src/main';
import { METRICA_AUDITORIA } from '../src/application/use-cases/CalculateStatistics';

const SECRETO_INTERNO = 'solo-para-pruebas-de-integracion';

const ADMIN = 9501;
const USUARIO = 9502;
const CLAVE = 'UMBRAL_DE_PRUEBA';
const CLAVE_SECRETA = 'SMTP_PASSWORD_DE_PRUEBA';

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
  DB_ADMIN_USER: process.env['DB_ADMIN_USER'] ?? 'pa_admin_svc',
  DB_ADMIN_PASSWORD: process.env['DB_ADMIN_PASSWORD'] ?? '',
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
  userId: number | null,
  roles: string[] = []
): {
  get: (ruta: string) => supertest.Test;
  put: (ruta: string) => supertest.Test;
} => {
  const agente = supertest(app);
  const preparar = (m: 'get' | 'put') => (ruta: string) => {
    let p = agente[m](ruta).set('x-internal-secret', SECRETO_INTERNO);
    if (userId !== null) {
      p = p.set('x-internal-user-id', String(userId)).set('x-internal-roles', roles.join(','));
    }
    return p;
  };
  return { get: preparar('get'), put: preparar('put') };
};

const admin = (): ReturnType<typeof como> => como(ADMIN, ['ADMINISTRADOR']);
const usuario = (): ReturnType<typeof como> => como(USUARIO, ['OFERENTE', 'SOLICITANTE']);
const anonimo = (): ReturnType<typeof como> => como(null);

beforeAll(async () => {
  if (env.DB_ADMIN_PASSWORD === '') {
    motivoNoDisponible = 'falta DB_ADMIN_PASSWORD en el entorno';
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
 * La bitacora es append-only y la base lo impone con disparadores, asi que no
 * se puede limpiar borrando. Las pruebas se escriben para no depender de que
 * la tabla este vacia: filtran por lo que ellas mismas escriben.
 */
async function limpiar(): Promise<void> {
  // Las dos claves, no solo una: si una prueba falla antes de su limpieza, la
  // siguiente veria un parametro existente y mediria otra cosa.
  await knex('system_parameter').whereIn('clave', [CLAVE, CLAVE_SECRETA]).delete();
  await knex('statistics_snapshot').where('metrica', 'metrica_de_prueba').delete();
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

describe('todo exige ADMINISTRADOR', () => {
  const rutas = [
    '/api/v1/admin/audit',
    '/api/v1/admin/reports/activity',
    '/api/v1/admin/reports/metrics',
    '/api/v1/admin/backups',
    '/api/v1/admin/parameters',
  ];

  /**
   * El guardia se aplica por ambito antes de declarar las rutas, no ruta a
   * ruta. Esta prueba vigila esa decision: si alguien anade una ruta nueva,
   * queda protegida por omision y no por acordarse.
   */
  it('sin identidad, ninguna ruta responde', async () => {
    if (saltar()) return;
    for (const ruta of rutas) {
      expect((await anonimo().get(ruta)).status).toBe(401);
    }
  });

  it('con sesion pero sin el rol, ninguna ruta responde', async () => {
    if (saltar()) return;
    for (const ruta of rutas) {
      expect((await usuario().get(ruta)).status).toBe(403);
    }
  });

  it('sin secreto interno no se entra', async () => {
    if (saltar()) return;
    expect((await supertest(app).get('/api/v1/admin/audit')).status).toBe(403);
  });
});

describe('bitacora de auditoria (SRS RF101 a RF103)', () => {
  it('un administrador la consulta', async () => {
    if (saltar()) return;
    const r = await admin().get('/api/v1/admin/audit');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.elementos)).toBe(true);
  });

  /**
   * ORDER BY no admite parametros: el nombre de columna acaba concatenado al
   * SQL. La lista blanca es lo unico que lo separa de una inyeccion, asi que
   * cualquier otro valor tiene que rebotar en el borde.
   */
  it('el orden fuera de la lista blanca no pasa', async () => {
    if (saltar()) return;
    for (const campo of ['id_actor', 'detalle', '1; DROP TABLE audit_record', 'ocurrido_at ASC']) {
      const r = await admin().get(`/api/v1/admin/audit?campoOrden=${encodeURIComponent(campo)}`);
      expect(r.status).toBe(422);
    }
    expect((await admin().get('/api/v1/admin/audit?campoOrden=registrado_at')).status).toBe(200);
  });

  it('un rango de fechas al reves no devuelve cero en silencio', async () => {
    if (saltar()) return;
    const r = await admin().get('/api/v1/admin/audit?desde=2026-10-02&hasta=2026-10-01');
    expect(r.status).toBe(422);
  });

  it('la pagina esta acotada aunque se pida mas', async () => {
    if (saltar()) return;
    expect((await admin().get('/api/v1/admin/audit?tamano=10000')).status).toBe(422);
  });

  it('rechaza parametros de consulta no declarados', async () => {
    if (saltar()) return;
    expect((await admin().get('/api/v1/admin/audit?limite=999')).status).toBe(422);
  });
});

describe('parametros del sistema (SRS RF105)', () => {
  const nuevo = {
    clave: CLAVE,
    valor: '0.15',
    descripcion: 'Umbral de prueba de integracion',
    tipoDato: 'number' as const,
  };

  it('crear un parametro deja asiento de auditoria en la misma operacion', async () => {
    if (saltar()) return;

    const r = await admin().put('/api/v1/admin/parameters').send(nuevo);
    expect(r.status).toBe(200);
    expect(r.body.clave).toBe(CLAVE);

    const asiento = await knex('audit_record')
      .where({ recurso_id: CLAVE, accion: 'CREAR_PARAMETRO' })
      .orderBy('id_auditoria', 'desc')
      .first();

    expect(asiento).toBeDefined();
    expect(Number(asiento.id_actor)).toBe(ADMIN);
    expect(asiento.resultado).toBe('EXITO');
  });

  it('cambiarlo registra el valor anterior y el nuevo', async () => {
    if (saltar()) return;
    await admin().put('/api/v1/admin/parameters').send(nuevo);

    const r = await admin()
      .put('/api/v1/admin/parameters')
      .send({ ...nuevo, valor: '0.30' });
    expect(r.body.valor).toBe('0.30');

    const asiento = await knex('audit_record')
      .where({ recurso_id: CLAVE, accion: 'CAMBIAR_PARAMETRO' })
      .orderBy('id_auditoria', 'desc')
      .first();

    const detalle =
      typeof asiento.detalle === 'string' ? JSON.parse(asiento.detalle) : asiento.detalle;
    expect(detalle.anterior).toBe('0.15');
    expect(detalle.nuevo).toBe('0.30');
  });

  /**
   * Un umbral declarado `number` que valga "pronto" rompe al servicio que lo
   * convierta, en otro proceso y mucho despues, con un error que no apunta aqui.
   */
  it('el valor se comprueba contra el tipo declarado', async () => {
    if (saltar()) return;
    const r = await admin()
      .put('/api/v1/admin/parameters')
      .send({ ...nuevo, valor: 'pronto' });
    expect(r.status).toBe(422);
  });

  it('una clave mal formada no pasa', async () => {
    if (saltar()) return;
    const r = await admin()
      .put('/api/v1/admin/parameters')
      .send({ ...nuevo, clave: 'umbral de prueba' });
    expect(r.status).toBe(422);
  });

  /**
   * Lo que mas importa de esta prueba: si alguien crea un parametro cuyo nombre
   * suena a secreto, su valor NO debe quedar escrito en una tabla que por
   * diseno no se puede corregir.
   */
  it('el asiento no guarda el valor de un parametro que suene a secreto', async () => {
    if (saltar()) return;
    const clave = CLAVE_SECRETA;

    await admin()
      .put('/api/v1/admin/parameters')
      .send({ clave, valor: 'SuperSecreto2026', tipoDato: 'string' });

    const asiento = await knex('audit_record')
      .where({ recurso_id: clave })
      .orderBy('id_auditoria', 'desc')
      .first();

    expect(JSON.stringify(asiento.detalle)).not.toContain('SuperSecreto2026');

    // Pero el HECHO queda: la auditoria tiene que demostrar que hubo un cambio,
    // y lo que se pierde es el valor, no el acontecimiento.
    const detalle =
      typeof asiento.detalle === 'string' ? JSON.parse(asiento.detalle) : asiento.detalle;
    expect(detalle.clave).toBe(clave);
    expect(detalle.valores).toBe('[omitido]');
    expect(detalle.cambio).toBe('ALTA');
  });

  it('un parametro que no existe da 404', async () => {
    if (saltar()) return;
    expect((await admin().get('/api/v1/admin/parameters/NO_EXISTE_ESTE')).status).toBe(404);
  });
});

describe('informes (SRS RF113, RF115)', () => {
  it('la actividad consolidada responde con sus agregados', async () => {
    if (saltar()) return;
    const r = await admin().get('/api/v1/admin/reports/activity');

    expect(r.status).toBe(200);
    expect(typeof r.body.totalAsientos).toBe('number');
    expect(Array.isArray(r.body.porAccion)).toBe(true);
    expect(Array.isArray(r.body.porDia)).toBe(true);
  });

  it('la serie de una metrica devuelve sus puntos', async () => {
    if (saltar()) return;
    await knex('statistics_snapshot').insert({
      fecha: '2026-10-01',
      metrica: 'metrica_de_prueba',
      dimension: 'total',
      valor: 42,
    });

    const r = await admin().get('/api/v1/admin/reports/series?metrica=metrica_de_prueba');
    expect(r.status).toBe(200);
    expect(r.body.total).toBe(1);
    expect(r.body.elementos[0].valor).toBe(42);

    const metricas = await admin().get('/api/v1/admin/reports/metrics');
    expect(metricas.body.metricas).toContain('metrica_de_prueba');
  });

  it('la serie exige decir que metrica', async () => {
    if (saltar()) return;
    expect((await admin().get('/api/v1/admin/reports/series')).status).toBe(422);
  });
});

/**
 * El escritor de `statistics_snapshot` (A-3).
 *
 * El criterio de cierre del backlog pide "una prueba que verifica que una fila
 * aparece". Esto comprueba eso y las dos cosas que no se pueden simular sin el
 * motor: que la clave unica `(fecha, metrica, dimension)` hace que recalcular
 * SUSTITUYA en lugar de duplicar, y que el agregado por `DATE(...)` cuenta los
 * asientos del dia correcto.
 */
describe('recalculo de series (A-3)', () => {
  const ACCION = 'ACCION_DE_PRUEBA_ESTADISTICAS';

  const limpiarEstadisticas = async (): Promise<void> => {
    await knex('statistics_snapshot').whereIn('metrica', [METRICA_AUDITORIA]).delete();
  };

  /**
   * La auditoria NO se puede limpiar: es append-only por disparador.
   *
   * Asi que esta suite no puede afirmar un valor absoluto —otras pruebas y
   * otras ejecuciones dejan asientos del mismo dia—. Mide la DIFERENCIA que
   * produce al escribir sus propios asientos, que es lo que de verdad prueba
   * que el calculo los ve.
   */
  const valorDeHoy = async (dimension: string): Promise<number> => {
    const fila = await knex('statistics_snapshot')
      .select('valor')
      .where({ metrica: METRICA_AUDITORIA, dimension })
      .andWhereRaw('fecha = CURRENT_DATE()')
      .first();
    return fila === undefined ? 0 : Number(fila.valor);
  };

  const escribirAsientos = async (cuantos: number, resultado: string): Promise<void> => {
    await knex('audit_record').insert(
      Array.from({ length: cuantos }, () => ({
        ocurrido_at: new Date(),
        id_actor: ADMIN,
        actor_rol: 'ADMINISTRADOR',
        accion: ACCION,
        recurso_tipo: 'PRUEBA',
        recurso_id: '1',
        resultado,
        correlation_id: randomUUID(),
      }))
    );
  };

  it('escribe una fila por dimension y un TOTAL, y recalcular no duplica', async () => {
    if (saltar()) return;
    await limpiarEstadisticas();

    const contenedor = buildContainer(envSchema.parse(env));
    const calcular = contenedor.calcular;

    await calcular.recalcular({ dias: 1 });
    const exitosAntes = await valorDeHoy('EXITO');
    const totalAntes = await valorDeHoy('TOTAL');

    await escribirAsientos(3, 'EXITO');
    await escribirAsientos(2, 'FALLO');
    await calcular.recalcular({ dias: 1 });

    expect(await valorDeHoy('EXITO')).toBe(exitosAntes + 3);
    expect(await valorDeHoy('TOTAL')).toBe(totalAntes + 5);

    // Volver a pasar sin escribir nada deja la cifra igual: la clave unica
    // sustituye el punto del dia en lugar de anadir otro.
    await calcular.recalcular({ dias: 1 });
    expect(await valorDeHoy('EXITO')).toBe(exitosAntes + 3);

    const filas = await knex('statistics_snapshot')
      .where({ metrica: METRICA_AUDITORIA, dimension: 'EXITO' })
      .andWhereRaw('fecha = CURRENT_DATE()');
    expect(filas).toHaveLength(1);

    await contenedor.knex.destroy();
  }, 60_000);

  it('la metrica recalculada aparece en el catalogo y se puede consultar como serie', async () => {
    if (saltar()) return;
    await limpiarEstadisticas();

    const contenedor = buildContainer(envSchema.parse(env));
    await escribirAsientos(1, 'EXITO');
    await contenedor.calcular.recalcular({ dias: 1 });
    await contenedor.knex.destroy();

    const metricas = await admin().get('/api/v1/admin/reports/metrics');
    expect(metricas.body.metricas).toContain(METRICA_AUDITORIA);

    const serie = await admin().get(
      `/api/v1/admin/reports/series?metrica=${METRICA_AUDITORIA}&dimension=TOTAL`
    );
    expect(serie.status).toBe(200);
    expect(serie.body.total).toBeGreaterThan(0);
    expect(serie.body.elementos[0].valor).toBeGreaterThan(0);
  }, 60_000);

  afterAll(async () => {
    if (disponible) await limpiarEstadisticas();
  });
});
