/**
 * Las semillas se pueden repetir sin destruir nada.
 *
 *   docker compose up -d
 *   npx jest --selectProjects integration
 *
 * Es el criterio de cierre de A-1 y B-3: "repetirlos no rompe la integridad
 * referencial, y hay una prueba que lo demuestra ejecutandolos dos veces
 * seguidas" (docs/01-BACKLOG.md).
 *
 * Lo que se comprueba no es que el seed "no falle" al repetirse —borrar e
 * insertar tampoco falla—, sino que los IDENTIFICADORES sobreviven. Ese es el
 * defecto real: los perfiles derivados de otros esquemas guardan `id_usuario`
 * sin clave foranea, asi que un seed que reasigna identificadores los deja
 * apuntando a usuarios que ya no existen.
 *
 * Se salta sola si no hay base de datos, como el resto de la suite de
 * integracion.
 */
import knexLib, { type Knex } from 'knex';

/**
 * `require` y no `import`: `db/` es CommonJS sin declaraciones de tipos.
 *
 * Importarlos como modulos ES obligaria a meter todo `db/` en el programa de
 * TypeScript con `allowJs`, y ninguno de esos archivos esta escrito para eso.
 * Es el mismo caso que `services/api-gateway/tests/openapi-coverage.unit.test.ts`.
 */
/**
 * Las variables se definen ANTES de los `require`, no en `beforeAll`.
 *
 * `db/seeds/auth/01_roles_and_users.js` lee `SEED_DEV_PASSWORD` al cargarse y
 * lanza si falta, asi que hacerlo en `beforeAll` llega tarde: el modulo ya se
 * cargo. En local no se notaba porque la variable venia del `.env` del
 * entorno; en CI no existe, y la suite entera fallaba al arrancar.
 */
process.env['SEED_DEV_PASSWORD'] ??= 'ContrasenaDeSemillaParaPruebas';
process.env['NODE_ENV'] ??= 'test';

/* eslint-disable @typescript-eslint/no-require-imports */
const configs = require('../knexfile') as Record<string, Knex.Config>;
const seedAuth = require('../seeds/auth/01_roles_and_users') as {
  seed: (knex: Knex) => Promise<void>;
};
const seedCatalog = require('../seeds/catalog/01_categories') as {
  seed: (knex: Knex) => Promise<void>;
};
/* eslint-enable @typescript-eslint/no-require-imports */

let auth: Knex;
let catalog: Knex;
let disponible = false;
/** Por que no se pudo conectar: un fallo de configuracion no es un entorno sin Docker. */
let motivoNoDisponible = '';

beforeAll(async () => {
  try {
    auth = knexLib(configs['auth'] as Knex.Config);
    catalog = knexLib(configs['catalog'] as Knex.Config);
    await auth.raw('SELECT 1');
    await catalog.raw('SELECT 1');
    disponible = true;
  } catch (error) {
    motivoNoDisponible = error instanceof Error ? error.message : String(error);
    disponible = false;
  }
}, 30_000);

afterAll(async () => {
  if (auth !== undefined) await auth.destroy();
  if (catalog !== undefined) await catalog.destroy();
});

/**
 * Omite sin Docker, pero falla con REQUIRE_INTEGRATION=1.
 *
 * Omitir en silencio un error de configuracion es peor que fallar: la suite
 * "pasa" sin haber ejecutado nada.
 */
const saltarSiNoHayBase = (): boolean => {
  if (!disponible) {
    if (process.env['REQUIRE_INTEGRATION'] === '1') {
      throw new Error(`Las pruebas de semillas no pudieron arrancar: ${motivoNoDisponible}`);
    }
    console.warn(`pruebas de semillas omitidas: ${motivoNoDisponible}`);
  }
  return !disponible;
};

/**
 * Los cuatro correos que siembra `db/seeds/auth/01_roles_and_users.js`.
 *
 * Se repiten aqui a proposito en lugar de importarlos: el seed no los exporta,
 * y que esta lista tenga que actualizarse al cambiar el seed es la senal de que
 * alguien ha tocado los datos de prueba.
 */
const CORREOS_SEMBRADOS = [
  'admin@puntoamigo.local',
  'solicitante@puntoamigo.local',
  'oferente@puntoamigo.local',
  'ambos@puntoamigo.local',
] as const;

interface FotoUsuario {
  id_usuario: string;
  correo: string;
  nombre: string;
  telefono: string | null;
  estado: string;
}

/**
 * Foto de los usuarios del seed, y solo de ellos.
 *
 * El filtro no es cosmetico: sin el, estas comprobaciones recogen tambien las
 * cuentas que `auth-http.int.test.ts` crea y borra en paralelo desde otro
 * worker de Jest, y la prueba falla una vez cada varias ejecuciones por algo
 * que el seed no ha hecho.
 */
const usuariosPorCorreo = async (): Promise<Map<string, FotoUsuario>> => {
  const filas = await auth<FotoUsuario>('usuario')
    .select('id_usuario', 'correo', 'nombre', 'telefono', 'estado')
    .whereIn('correo', CORREOS_SEMBRADOS)
    .orderBy('correo');
  return new Map(filas.map((f) => [f.correo, f]));
};

describe('semillas de pa_auth', () => {
  it('conserva el identificador de cada usuario al repetirse', async () => {
    if (saltarSiNoHayBase()) return;

    await seedAuth.seed(auth);
    const primera = await usuariosPorCorreo();
    expect(primera.size).toBeGreaterThan(0);

    await seedAuth.seed(auth);
    const segunda = await usuariosPorCorreo();

    expect([...segunda.keys()]).toEqual([...primera.keys()]);
    for (const [correo, antes] of primera) {
      expect(segunda.get(correo)?.id_usuario).toBe(antes.id_usuario);
    }
  }, 60_000);

  it('no duplica filas al repetirse', async () => {
    if (saltarSiNoHayBase()) return;

    await seedAuth.seed(auth);
    // Acotado a los usuarios del seed, por lo mismo que `usuariosPorCorreo`.
    const contar = async (): Promise<{ usuarios: number; roles: number; asignaciones: number }> => {
      const sembrados = auth('usuario').select('id_usuario').whereIn('correo', CORREOS_SEMBRADOS);
      const [[u], [r], [a]] = await Promise.all([
        auth('usuario').whereIn('correo', CORREOS_SEMBRADOS).count<{ n: number }[]>({ n: '*' }),
        auth('rol').count<{ n: number }[]>({ n: '*' }),
        auth('usuario_rol').whereIn('id_usuario', sembrados).count<{ n: number }[]>({ n: '*' }),
      ]);
      return {
        usuarios: Number(u?.n ?? 0),
        roles: Number(r?.n ?? 0),
        asignaciones: Number(a?.n ?? 0),
      };
    };

    const primera = await contar();
    await seedAuth.seed(auth);
    expect(await contar()).toEqual(primera);
  }, 60_000);

  it('deja toda asignacion de rol apuntando a un usuario y un rol que existen', async () => {
    if (saltarSiNoHayBase()) return;

    await seedAuth.seed(auth);
    await seedAuth.seed(auth);

    /**
     * `usuario_rol` SI tiene claves foraneas dentro de pa_auth, asi que el
     * motor ya impediria una huerfana. Se comprueba de todas formas porque lo
     * que se esta probando es el seed, no el motor: si una version futura
     * volviera a borrar e insertar, aqui se veria.
     */
    const huerfanas = await auth('usuario_rol as ur')
      .leftJoin('usuario as u', 'u.id_usuario', 'ur.id_usuario')
      .leftJoin('rol as r', 'r.id_rol', 'ur.id_rol')
      .whereNull('u.id_usuario')
      .orWhereNull('r.id_rol')
      .count<{ n: number }[]>({ n: '*' });

    expect(Number(huerfanas[0]?.n ?? 0)).toBe(0);
  }, 60_000);

  it('no vuelve a encolar UserRegistered para un usuario que ya existia', async () => {
    if (saltarSiNoHayBase()) return;

    await seedAuth.seed(auth);

    /**
     * Se cuentan solo las altas de LOS CUATRO USUARIOS DEL SEED, no todas.
     *
     * Contar `where event_name = 'UserRegistered'` a secas hacia esta prueba
     * intermitente: Jest reparte las suites entre varios procesos, y
     * `auth-http.int.test.ts` da de alta y borra su propio usuario contra el
     * mismo `pa_auth.outbox_event`. El total subia o bajaba entre las dos
     * lecturas sin que el seed hubiera tocado nada.
     *
     * Un `LIKE '%@puntoamigo.local'` tampoco servia: el correo de esa otra
     * suite tambien encaja. Los cuatro correos exactos son el dato que esta
     * prueba examina, asi que se nombran.
     */
    const idsSembrados = await auth('usuario')
      .select('id_usuario')
      .whereIn('correo', CORREOS_SEMBRADOS);
    const aggregateIds = idsSembrados.map((f: { id_usuario: string }) => String(f.id_usuario));
    expect(aggregateIds).toHaveLength(CORREOS_SEMBRADOS.length);

    const altas = async (): Promise<number> => {
      const [fila] = await auth('outbox_event')
        .where({ event_name: 'UserRegistered' })
        .whereIn('aggregate_id', aggregateIds)
        .count<{ n: number }[]>({ n: '*' });
      return Number(fila?.n ?? 0);
    };

    const primera = await altas();
    expect(primera).toBeGreaterThan(0);

    await seedAuth.seed(auth);

    /**
     * Repetir el seed no puede volver a anunciar el alta.
     *
     * El evento es el que alimenta `usuario_ref` en los otros seis esquemas. Un
     * `event_id` nuevo por ejecucion esquiva la idempotencia del consumidor
     * —que compara por `event_id`, no por contenido— asi que cada
     * `docker compose up` publicaria de nuevo el alta de todos los usuarios de
     * prueba.
     */
    expect(await altas()).toBe(primera);
  }, 60_000);
});

describe('semillas de pa_catalog', () => {
  it('conserva el identificador de cada categoria y no las duplica', async () => {
    if (saltarSiNoHayBase()) return;

    await seedCatalog.seed(catalog);
    const primera = await catalog('categoria_servicio')
      .select('id_categoria', 'nombre_categoria')
      .orderBy('nombre_categoria');
    expect(primera.length).toBeGreaterThan(0);

    await seedCatalog.seed(catalog);
    const segunda = await catalog('categoria_servicio')
      .select('id_categoria', 'nombre_categoria')
      .orderBy('nombre_categoria');

    expect(segunda).toEqual(primera);
  }, 60_000);

  it('no borra los servicios publicados sobre esas categorias', async () => {
    if (saltarSiNoHayBase()) return;

    await seedCatalog.seed(catalog);
    const categoria = await catalog('categoria_servicio')
      .select('id_categoria')
      .orderBy('id_categoria')
      .first();
    expect(categoria).toBeDefined();

    /**
     * El caso que motiva A-1, reproducido.
     *
     * Un servicio publicado apunta a una categoria y a un prestador replicado.
     * El seed anterior borraba `servicio` y `prestador_ref` antes de insertar,
     * asi que arrancar el entorno de desarrollo dos veces se llevaba por
     * delante el catalogo que alguien estuviera usando.
     */
    const idPrestador = 999_001;
    await catalog('prestador_ref')
      .insert({
        id_prestador: idPrestador,
        id_usuario: 999_001,
        nombre: 'Prestador de la prueba de semillas',
        especialidad: null,
        estado: 'ACTIVE',
        synced_at: new Date(),
      })
      .onConflict('id_prestador')
      .merge();

    const [idServicio] = await catalog('servicio').insert({
      id_prestador: idPrestador,
      id_categoria: (categoria as { id_categoria: string }).id_categoria,
      nombre_servicio: 'Servicio de la prueba de semillas',
      descripcion: 'Existe para comprobar que el seed no lo borra.',
      estado: 'ACTIVE',
    });

    try {
      await seedCatalog.seed(catalog);

      const sigueAhi = await catalog('servicio').where({ id_servicio: idServicio }).first();
      expect(sigueAhi).toBeDefined();
    } finally {
      await catalog('servicio').where({ id_servicio: idServicio }).delete();
      await catalog('prestador_ref').where({ id_prestador: idPrestador }).delete();
    }
  }, 60_000);
});
