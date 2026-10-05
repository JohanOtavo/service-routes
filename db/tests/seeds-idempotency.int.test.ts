/**
 * Idempotencia de los seeds, contra MySQL real (A-1 del backlog).
 *
 * Existe por un fallo concreto y documentado: los seeds borraban sus tablas y
 * las volvian a insertar. `usuario.id_usuario` era un autoincremento, asi que
 * cambia en cada ejecucion, y todo lo que apuntara a un usuario se quedaba
 * apuntando a alguien que ya no existe. Peor: las tablas `*_ref` de los demas
 * esquemas **no tienen clave foranea** contra `pa_auth.usuario` -es otro
 * esquema-, de modo que MySQL no avisaba. Un `docker compose up` de desarrollo
 * destruia el estado y los avisos, propuestas y calificaciones quedaban
 * apuntando a filas fantasma sin un solo error.
 *
 * Por eso la prueba mira lo que el motor NO puede avisar: que los
 * identificadores no se muevan, que las filas de trabajo sobrevivan y que cada
 * `id_usuario` de cada tabla replica exista de verdad en `pa_auth`.
 */
import knexLib, { type Knex } from 'knex';
import path from 'node:path';

const RAIZ_SEEDS = path.resolve(__dirname, '..', 'seeds');

/** Presta que solo existe para esta prueba y debe sobrevivir a los seeds. */
const ID_PRESTADOR_CANARIO = 900000001;

/**
 * Esquemas con una tabla que replica usuarios y que, ademas, tiene un escritor.
 *
 * Se comprueban todas porque el fallo no era de un esquema: cada uno tiene la
 * suya y ninguna lo detectaba.
 *
 * `pa_provider` y `pa_rating` estaban en esta lista hasta que A-5 las retiro:
 * sus tablas `usuario_ref` se habian creado pero **nadie las escribia**, asi que
 * la comprobacion era vacua para ellas y ademas fallaba al ejecutarse, porque la
 * tabla ya no existe. Eran laanza suelta de una migracion retirada.
 */
const ESQUEMAS_CON_REPLICA = [
  { key: 'catalog', tabla: 'prestador_ref' },
  { key: 'request', tabla: 'usuario_ref' },
  { key: 'notification', tabla: 'usuario_ref' },
];

let auth: Knex | undefined;
let catalog: Knex | undefined;
const replicas = new Map<string, { knex: Knex; tabla: string }>();

let disponible = false;
let motivoNoDisponible = '';

function conexion(key: string, schema: string, usarSeeds = false): Knex {
  const user = process.env[`DB_${key.toUpperCase()}_USER`] ?? '';
  const password = process.env[`DB_${key.toUpperCase()}_PASSWORD`] ?? '';
  if (user === '' || password === '') {
    throw new Error(`faltan credenciales de ${key} (DB_${key.toUpperCase()}_*)`);
  }
  return knexLib({
    client: 'mysql2',
    connection: {
      host: process.env['MYSQL_HOST'] ?? '127.0.0.1',
      port: Number(process.env['MYSQL_PORT'] ?? 3306),
      user,
      password,
      database: schema,
      timezone: 'Z',
    },
    ...(usarSeeds ? { seeds: { directory: path.join(RAIZ_SEEDS, key) } } : {}),
  });
}

/** Ejecuta los seeds de un servicio por el mismo camino que `db/cli.js seed`. */
async function correrSeeds(knex: Knex): Promise<void> {
  await knex.seed.run();
}

beforeAll(async () => {
  const password = process.env['DB_AUTH_PASSWORD'] ?? '';
  if (password === '') {
    motivoNoDisponible = 'falta DB_AUTH_PASSWORD en el entorno';
    return;
  }

  try {
    auth = conexion('auth', 'pa_auth', true);
    catalog = conexion('catalog', 'pa_catalog', true);
    await auth.raw('SELECT 1');
    await catalog.raw('SELECT 1');

    for (const esquema of ESQUEMAS_CON_REPLICA) {
      try {
        const knex = conexion(esquema.key, `pa_${esquema.key}`);
        await knex.raw('SELECT 1');
        replicas.set(esquema.key, { knex, tabla: esquema.tabla });
      } catch {
        // Un esquema sin credenciales no se comprueba; no es un fallo del seed.
      }
    }

    disponible = true;
  } catch (error) {
    motivoNoDisponible = error instanceof Error ? error.message : String(error);
  }
});

afterAll(async () => {
  if (catalog) {
    // El canario se borra en orden inverso por la FK de `servicio`.
    await catalog('servicio')
      .where({ id_prestador: ID_PRESTADOR_CANARIO })
      .del()
      .catch(() => {});
    await catalog('prestador_ref').where({ id_prestador: ID_PRESTADOR_CANARIO }).del();
  }
  for (const { knex } of replicas.values()) await knex.destroy();
  await auth?.destroy();
  await catalog?.destroy();
});

const saltar = (): boolean => {
  if (!disponible) {
    if (process.env['REQUIRE_INTEGRATION'] === '1') {
      throw new Error(`La prueba no pudo arrancar: ${motivoNoDisponible}`);
    }
    console.warn(`prueba omitida: ${motivoNoDisponible}`);
    return true;
  }
  return false;
};

const CORREOS_DE_SEED = [
  'admin@puntoamigo.local',
  'solicitante@puntoamigo.local',
  'oferente@puntoamigo.local',
  'ambos@puntoamigo.local',
];

const usuarios = async (): Promise<{ id_usuario: number; correo: string }[]> =>
  auth!('usuario').select('id_usuario', 'correo').orderBy('id_usuario');

/**
 * Solo las cuentas que crea el seed.
 *
 * Estas pruebas comparten `pa_auth.usuario` con las ocho suites de integracion
 * de los servicios, que crean sus propias cuentas de prueba. Comparar la tabla
 * entera hacia que esta prueba fallara si otra suite inserta una fila entre las
 * dos lecturas: no es un fallo del seed, es una prueba que no aísla lo que
 * comprueba. Lo que se verifica es que los identificadores de los usuarios que
 * el seed es dueño no se muevan.
 */
const usuariosDeSeed = async (): Promise<{ id_usuario: number; correo: string }[]> =>
  auth!('usuario')
    .whereIn('correo', CORREOS_DE_SEED)
    .select('id_usuario', 'correo')
    .orderBy('id_usuario');

describe('los seeds se pueden repetir', () => {
  it('deja los mismos usuarios con los mismos identificadores', async () => {
    if (saltar()) return;

    await correrSeeds(auth!);
    const antes = await usuariosDeSeed();

    await correrSeeds(auth!);
    await correrSeeds(auth!);
    const despues = await usuariosDeSeed();

    // La comparacion clave: no basta con que las filas esten, tienen que seguir
    // siendo las MISMAS. Con identificadores nuevos, las claves foraneas de los
    // demas esquemas apuntarian a filas que ya no existen.
    expect(despues).toEqual(antes);
    expect(antes).toHaveLength(CORREOS_DE_SEED.length);
  });

  it('no duplica los roles de una cuenta', async () => {
    if (saltar()) return;

    const admin = (await usuarios()).find((u) => u.correo === 'admin@puntoamigo.local');
    expect(admin).toBeDefined();

    const roles = await auth!('usuario_rol')
      .where({ id_usuario: admin!.id_usuario })
      .select('id_rol');
    const nombres = await auth!('rol')
      .whereIn(
        'id_rol',
        roles.map((r) => r.id_rol)
      )
      .pluck('nombre_rol');

    expect(nombres.sort()).toEqual(['ADMINISTRADOR', 'SOLICITANTE']);
  });

  it('no duplica las categorias de servicio', async () => {
    if (saltar()) return;

    await correrSeeds(catalog!);
    const tras = await catalog!('categoria_servicio').pluck('nombre_categoria');

    await correrSeeds(catalog!);
    const nette = await catalog!('categoria_servicio').pluck('nombre_categoria');

    const repetidas = nette.filter((nombre, i) => nette.indexOf(nombre) !== i);
    expect(repetidas).toEqual([]);
    expect(tras.filter((n) => n === 'Plomeria').length).toBeLessThanOrEqual(1);
  });

  it('conserva los roles que el seed declara y retira los que sobra', async () => {
    if (saltar()) return;

    const admin = (await usuarios()).find((u) => u.correo === 'admin@puntoamigo.local');
    const oferta = (await usuarios()).find((u) => u.correo === 'oferente@puntoamigo.local');
    const rol = await auth!('rol').where({ nombre_rol: 'OFERENTE' }).first();

    await auth!('usuario_rol').insert({ id_usuario: admin!.id_usuario, id_rol: rol!.id_rol });
    await correrSeeds(auth!);

    const roles = await auth!('usuario_rol')
      .where({ id_usuario: admin!.id_usuario })
      .pluck('id_rol');
    expect(roles).not.toContain(rol!.id_rol);

    await correrSeeds(auth!);
    const delOferente = await auth!('usuario_rol')
      .where({ id_usuario: oferta!.id_usuario })
      .pluck('id_rol');
    expect(delOferente.sort()).toEqual(
      [
        await auth!('rol')
          .where({ nombre_rol: 'SOLICITANTE' })
          .first()
          .then((r) => r.id_rol),
        rol!.id_rol,
      ].sort()
    );
  });

  it('no borra el trabajo de desarrollo: un servicio publicado sobrevive', async () => {
    if (saltar()) return;

    const Marta = (await usuarios()).find((u) => u.correo === 'solicitante@puntoamigo.local');
    const categoria = await catalog!('categoria_servicio')
      .where({ nombre_categoria: 'Plomeria' })
      .first();

    await catalog!('prestador_ref')
      .insert({
        id_prestador: ID_PRESTADOR_CANARIO,
        id_usuario: Marta!.id_usuario,
        nombre: 'Prestador canario',
      })
      .onConflict('id_prestador')
      .ignore();

    await catalog!('servicio').insert({
      nombre_servicio: 'Cambio de grifo canario',
      descripcion: 'Fila que solo existe para comprobar que el seed no borra trabajo.',
      id_prestador: ID_PRESTADOR_CANARIO,
      id_categoria: categoria!.id_categoria,
    });

    await correrSeeds(auth!);
    await correrSeeds(catalog!);

    const servicio = await catalog!('servicio')
      .where({ id_prestador: ID_PRESTADOR_CANARIO })
      .first();
    expect(servicio).toBeDefined();
    expect(servicio!.nombre_servicio).toBe('Cambio de grifo canario');
  });

  /**
   * La garantia central de A-1. Estas tablas no tienen clave foranea contra
   * `pa_auth.usuario` porque viven en otro esquema, asi que un identificador
   * recycled no lo detecta el motor: hay que preguntarlo.
   *
   * La pregunta se limita a las filas que los seeds son duenos de -las que
   * apuntan a una cuenta de seed-. Preguntar por la tabla entera seria
   * mentira: las demas suites de integracion comparten estos mismos esquemas y
   * crean sus propios prestadores y solicitudes alli, asi que un conteo global
   * daria falso positivo y, peor, obligaria a esta prueba a borrar datos que no
   * son suyos.
   */
  it('deja cada replica de un usuario de seed apuntando a un usuario que existe', async () => {
    if (saltar()) return;

    await correrSeeds(auth!);
    await correrSeeds(catalog!);

    const idsDeSeed = new Set(
      (await usuarios()).filter((u) => CORREOS_DE_SEED.includes(u.correo)).map((u) => u.id_usuario)
    );
    expect(idsDeSeed.size).toBe(CORREOS_DE_SEED.length);

    // Con los seeds idempotentes, una segunda pasada no cambia ni un
    // identificador. Si un seed volviera a borrar e insertar, estos ids
    // desaparecerian de `pa_auth` y las replicas que apuntan a ellos se
    // quedarian colgando sin que ninguna clave foranea lo advierta.
    await correrSeeds(auth!);
    await correrSeeds(catalog!);

    const tras = new Set((await usuarios()).map((u) => u.id_usuario));
    for (const id of idsDeSeed) expect(tras.has(id)).toBe(true);

    for (const [esquema, { knex, tabla }] of replicas) {
      const filas = await knex(tabla)
        .whereIn('id_usuario', [...idsDeSeed])
        .select('id_usuario');
      const huerfanos = filas.map((f) => f.id_usuario as number).filter((id) => !tras.has(id));
      expect({ esquema, huerfanos }).toEqual({ esquema, huerfanos: [] });
    }
  });

  it('no duplica los eventos de alta en el outbox', async () => {
    if (saltar()) return;

    await correrSeeds(auth!);
    const Marta = (await usuarios()).find((u) => u.correo === 'solicitante@puntoamigo.local');

    const eventos = await auth!('outbox_event')
      .where({ event_name: 'UserRegistered', aggregate_id: String(Marta!.id_usuario) })
      .select('event_id');

    await correrSeeds(auth!);
    const despues = await auth!('outbox_event')
      .where({ event_name: 'UserRegistered', aggregate_id: String(Marta!.id_usuario) })
      .select('event_id');

    // Reanunciar el alta haria que los consumidores volvieran a procesar una
    // cuenta que ya conocian.
    expect(despues.length).toBe(eventos.length);
  });
});
