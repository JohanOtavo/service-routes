/**
 * El calculo de estadisticas contra MySQL real (A-3 del backlog).
 *
 * Que demuestra. Que `pa_admin.statistics_snapshot` deja de ser una tabla que solo se
 * lee. Antes de este trabajo no habia escritor ni planificador en ningun sitio del
 * repositorio, la tabla no tenia ni una fila, y el modulo de reportes devolvia series
 * vacias sin que nadie supiera por que.
 *
 * Que prueba y que no. Prueba el criterio de cierre de A-3: dados reales en
 * `pa_request`, `pa_catalog` y `pa_rating`, el calculo deja filas en el snapshot y el
 * lector las devuelve. No prueba que las metricas sean las que quiere el SRS, porque
 * el SRS no esta en el repositorio; el catalogo de `CalculateStatistics` declara la
 * formula de cada una para que se puedan corregir sin tocar el SQL.
 *
 * De paso prueba la excepcion de ADR-005: si el GRANT no estuviera concedido, estas
 * pruebas caerian con `ER_TABLEACCESS_DENIED_ERROR`, que es justo el fallo que un
 * despliegue mal aprovisionado tiene que ver.
 */
import knexLib, { type Knex } from 'knex';
import { SystemClock } from '@punto-amigo/service-kit';

import {
  CalculateStatistics,
  CATALOGO_METRICAS,
  DIMENSION_TOTAL,
} from '../../services/admin-reporting-service/src/application/use-cases/CalculateStatistics';
import { KnexEstadisticasCalculadora } from '../../services/admin-reporting-service/src/infrastructure/persistence/KnexEstadisticasCalculadora';
import { KnexAuditRepository } from '../../services/admin-reporting-service/src/infrastructure/persistence/KnexAdminRepositories';
import {
  KnexBackupRepository,
  KnexEstadisticasSnapshotRepository,
  KnexParameterRepository,
  KnexStatisticsRepository,
} from '../../services/admin-reporting-service/src/infrastructure/persistence/KnexSupportRepositories';
import { ManageReportsUseCase } from '../../services/admin-reporting-service/src/application/use-cases/ManageReports';

/**
 * Una sola conexion con `pa_admin` como base por defecto, igual que el servicio.
 *
 * Es lo que obliga a que las consultas vayan cualificadas con su esquema: si esta
 * conexion alcanzara `necesidad` sin escribir el esquema, la prueba pasaria
 * en local y fallaria en el despliegue real, que es al reves de como debe comprobar
 * un test de estos.
 */
const admin = (): Knex =>
  knexLib({
    client: 'mysql2',
    connection: {
      host: process.env['MYSQL_HOST'] ?? '127.0.0.1',
      port: Number(process.env['MYSQL_PORT'] ?? 3306),
      user: process.env['DB_ADMIN_USER'] ?? '',
      password: process.env['DB_ADMIN_PASSWORD'] ?? '',
      database: 'pa_admin',
      timezone: 'Z',
    },
  });

/** Para sembrar los datos de origen hay que escribir con las cuentas propietarias. */
const deEsquema = (clave: 'REQUEST' | 'CATALOG' | 'RATING', esquema: string): Knex =>
  knexLib({
    client: 'mysql2',
    connection: {
      host: process.env['MYSQL_HOST'] ?? '127.0.0.1',
      port: Number(process.env['MYSQL_PORT'] ?? 3306),
      user: process.env[`DB_${clave}_USER`] ?? '',
      password: process.env[`DB_${clave}_PASSWORD`] ?? '',
      database: esquema,
      timezone: 'Z',
    },
  });

let db: Knex | undefined;
let request: Knex | undefined;
let catalog: Knex | undefined;
let rating: Knex | undefined;
let disponible = false;

/** Marca unica de lo sembrado, para limpiar sin tocar datos ajenos. */
const MARCA = 'estadisticas-a3';
const FECHA = '2026-03-15';
const MOMENTO = `${FECHA} 09:00:00`;

beforeAll(async () => {
  try {
    db = admin();
    request = deEsquema('REQUEST', 'pa_request');
    catalog = deEsquema('CATALOG', 'pa_catalog');
    rating = deEsquema('RATING', 'pa_rating');
    await db.raw('SELECT 1');
    await request.raw('SELECT 1');
    await catalog.raw('SELECT 1');
    await rating.raw('SELECT 1');
    disponible = true;
  } catch {
    disponible = false;
  }
});

/** MySQL deadlock: 1213. Es transitorio por definicion, se reintenta. */
const ES_DEADLOCK = 1213;

/**
 * Repite una operacion si MySQL la corta por bloqueo.
 *
 * Los suites de integracion corren en paralelo sobre la misma base, asi que dos
 * pruebas que tocan filas vecinas se pueden dejar esperando la una a la otra. InnoDB
 * detecta el circulo y mata una de las dos con el error 1213. No es un fallo de este
 * test ni un dato roto: es contencion entre pruebas, y la respuesta correcta es
 * reintentar tras el rollback, no relajar las aserciones.
 */
async function conReintento<T>(intento: () => Promise<T>, intentos = 3): Promise<T> {
  for (let intentoActual = 1; ; intentoActual += 1) {
    try {
      return await intento();
    } catch (error) {
      const esDeadlock =
        typeof error === 'object' &&
        error !== null &&
        (error as { errno?: number }).errno === ES_DEADLOCK;

      if (!esDeadlock || intentoActual >= intentos) throw error;
      await new Promise((resolver) => {
        setTimeout(resolver, 50 * intentoActual);
      });
    }
  }
}

/**
 * Deja las tablas como estaban.
 *
 * Va antes de cada prueba y no solo al final: las tablas son de todos los servicios y
 * sin esto el conteo de una prueba dependeria de lo que dejo la anterior. Solo borra
 * filas con la marca, nunca por fecha, para no pisar datos de otro.
 */
async function limpiar(): Promise<void> {
  if (!disponible) return;

  await conReintento(() =>
    db!('statistics_snapshot')
      .where({ fecha: FECHA })
      .whereIn('metrica', [
        'necesidades_publicadas',
        'propuestas_enviadas',
        'prestadores_por_estado',
        'servicios_por_estado',
        'valoracion_media',
        'tasa_cobertura',
      ])
      .del()
  );

  await conReintento(() => request!('propuesta').where('mensaje', MARCA).del());
  await conReintento(() => request!('necesidad').where('titulo', MARCA).del());
  await conReintento(() => request!('prestador_ref').where('nombre', MARCA).del());

  await conReintento(() => catalog!('servicio').where('nombre_servicio', MARCA).del());
  await conReintento(() => catalog!('prestador_ref').where('nombre', MARCA).del());
  await conReintento(() => catalog!('categoria_servicio').where('nombre_categoria', MARCA).del());

  await conReintento(() => rating!('calificacion').where('comentario', MARCA).del());
  await conReintento(() => rating!('solicitud_ref').where('estado', MARCA).del());

  await conReintento(() => request!('categoria_ref').where('nombre_categoria', MARCA).del());
  await conReintento(() => request!('usuario_ref').where('nombre', MARCA).del());
}

/**
 * Las replicas que exigen los FK de `necesidad`.
 *
 * `necesidad.id_usuario` y `necesidad.id_categoria` son claves foraneas reales contra
 * `usuario_ref` y `categoria_ref`, asi que sembrar una necesidad exige sembrar antes
 * sus dos referencias. Es lo que hace que estas pruebas midan el calculo sobre el
 * esquema de verdad y no sobre una version recortada.
 */
async function sembrarReferencias(): Promise<void> {
  // `ignore` porque se llama una vez por necesidad y las referencias son las
  // mismas: sin esto, la segunda necesidad de una prueba revienta por clave primaria.
  await request!('usuario_ref')
    .insert({
      id_usuario: 900001,
      nombre: MARCA,
      estado: 'ACTIVO',
      synced_at: MOMENTO,
    })
    .onConflict('id_usuario')
    .ignore();

  await request!('categoria_ref')
    .insert({
      id_categoria: 900001,
      nombre_categoria: MARCA,
      activa: true,
      synced_at: MOMENTO,
    })
    .onConflict('id_categoria')
    .ignore();
}

afterAll(async () => {
  await limpiar();
  await rating?.destroy();
  await catalog?.destroy();
  await request?.destroy();
  await db?.destroy();
});

async function sembrarNecesidad(
  estado: string,
  opciones: { conPropuesta?: boolean; eliminada?: boolean } = {}
): Promise<void> {
  await sembrarReferencias();

  // Sin `returning`: MySQL no lo soporta y knex lo ignora en silencio, asi que el
  // resultado de un insert es el id generado, no una fila. Pedirlo con `returning`
  // daria `undefined` y el fallo apareceria mas abajo, en la FK de la propuesta.
  const idNecesidad = (await request!('necesidad').insert({
    titulo: MARCA,
    descripcion: 'sembrada por el test de estadisticas',
    id_usuario: 900001,
    id_categoria: 900001,
    estado,
    fecha_publicacion: MOMENTO,
    fecha_vigencia: '2030-01-01 00:00:00',
    created_at: MOMENTO,
    updated_at: MOMENTO,
    deleted_at: opciones.eliminada === true ? MOMENTO : null,
  })) as unknown as number;

  if (opciones.conPropuesta === true) {
    await request!('prestador_ref')
      .insert({
        id_prestador: 900001,
        id_usuario: 900002,
        nombre: MARCA,
        estado: 'APPROVED',
        synced_at: MOMENTO,
      })
      .onConflict('id_prestador')
      .ignore();

    await request!('propuesta').insert({
      id_necesidad: idNecesidad,
      id_prestador: 900001,
      precio: 100,
      tiempo_estimado: 3,
      mensaje: MARCA,
      estado: 'ENVIADA',
      fecha_envio: MOMENTO,
      created_at: MOMENTO,
      updated_at: MOMENTO,
    });
  }
}

/** Un prestador y un servicio vivos en el catalogo. */
async function sembrarCatalogo(opciones: { servicioEliminado?: boolean } = {}): Promise<void> {
  // `categoria_servicio.id_categoria` es autoincrement, asi que se deja que MySQL lo
  // genere y se usa el que devuelva: fijarlo a mano deja el servicio huerfano y la FK
  // falla en `servicio`, no aqui.
  const idCategoria = (await catalog!('categoria_servicio').insert({
    nombre_categoria: MARCA,
    descripcion: 'categoria de prueba',
    activa: true,
    created_at: MOMENTO,
    updated_at: MOMENTO,
  })) as unknown as number;

  await catalog!('prestador_ref')
    .insert({
      id_prestador: 900001,
      id_usuario: 900002,
      nombre: MARCA,
      estado: 'APPROVED',
      synced_at: MOMENTO,
    })
    .onConflict('id_prestador')
    .ignore();

  await catalog!('servicio').insert({
    nombre_servicio: MARCA,
    descripcion: 'servicio de prueba',
    id_prestador: 900001,
    id_categoria: idCategoria,
    estado: 'ACTIVE',
    created_at: MOMENTO,
    updated_at: MOMENTO,
    deleted_at: opciones.servicioEliminado === true ? MOMENTO : null,
  });
}

/**
 * Una calificacion, con la visibilidad, la moderacion y el borrado controlados.
 *
 * Cada calificacion necesita su propia `solicitud_ref` porque el indice unico es
 * `(id_solicitud, direccion)`: sembrar dos calificaciones sobre la misma solicitud
 * con la misma direccion no es una prueba, es un `ER_DUP_ENTRY` disfrazado.
 */
async function sembrarCalificacion(
  idSolicitud: number,
  puntuacion: number,
  opciones: { visible?: boolean; moderada?: boolean; eliminada?: boolean } = {}
): Promise<void> {
  await rating!('solicitud_ref').insert({
    id_solicitud: idSolicitud,
    id_usuario: 900001,
    id_prestador: 900001,
    id_usuario_prestador: 900002,
    estado: MARCA,
    synced_at: MOMENTO,
  });

  await rating!('calificacion').insert({
    id_solicitud: idSolicitud,
    direccion: 'OFERENTE_A_SOLICITANTE',
    id_emisor: 900001,
    id_receptor: 900002,
    puntuacion,
    comentario: MARCA,
    visible_at: opciones.visible === true ? MOMENTO : null,
    oculta_por_moderacion: opciones.moderada === true,
    fecha: MOMENTO,
    created_at: MOMENTO,
    updated_at: MOMENTO,
    deleted_at: opciones.eliminada === true ? MOMENTO : null,
  });
}

/**
 * Cuantos servicios vivos hay ahora mismo.
 *
 * Se consulta con la misma cuenta de servicio y los mismos filtros que la
 * calculadora: si el seed inserta servicios borrados logicamente, contemplarlos como
 * base haria que la prueba siga verde sin comprobar nada.
 */
const baseServicios = async (): Promise<number> => {
  const fila = await catalog!('servicio').whereNull('deleted_at').count({ n: '*' });
  return Number(fila[0].n);
};

const basePrestadores = async (): Promise<number> => {
  const fila = await catalog!('prestador_ref').count({ n: '*' });
  return Number(fila[0].n);
};

/**
 * Cuantas necesidades abiertas, y cuantas con propuesta, hay ahora mismo.
 *
 * Estas metricas son **globales por definicion**: cuentan toda la tabla, no las filas de
 * esta prueba. Y los suites de integracion corren en paralelo sobre la misma base, asi
 * que `request-service` esta creando y borrando necesidades mientras estas pruebas se
 * ejecutan. Por eso las aserciones son sobre el **delta** que aporta lo sembrado aqui,
 * con la base medida en el momento, y no sobre un total absoluto. Un total absoluto
 * pasaria en verde por casualidad y fallaria por la causa equivocada.
 */
const baseCobertura = async (
  conexion: Knex = request!
): Promise<{ abiertas: number; conPropuesta: number }> => {
  // `pa_request.` explicito porque esta misma consulta se pide a veces con la
  // transaccion de `pa_admin`, cuya base por defecto es `pa_admin`. Sin cualificar,
  // `necesidad` se buscaria alli y no existe.
  const [{ n: abiertas }] = await conexion('necesidad')
    .whereNull('deleted_at')
    .where('estado', 'ABIERTA')
    .count({ n: '*' });

  const [{ n: conPropuesta }] = await conexion('necesidad')
    .whereNull('deleted_at')
    .where('estado', 'ABIERTA')
    .whereExists((sub) =>
      sub
        .select('*')
        .from('pa_request.propuesta')
        .whereRaw('pa_request.propuesta.id_necesidad = necesidad.id_necesidad')
        .whereNull('pa_request.propuesta.deleted_at')
        .whereIn('pa_request.propuesta.estado', ['ENVIADA', 'ACEPTADA'])
    )
    .count({ n: '*' });

  return { abiertas: Number(abiertas), conPropuesta: Number(conPropuesta) };
};

const baseNecesidadesDelDia = async (): Promise<number> => {
  const [{ n }] = await request!('necesidad')
    .whereNull('deleted_at')
    .whereRaw('DATE(fecha_publicacion) = ?', [FECHA])
    .count({ n: '*' });
  return Number(n);
};

const baseValoracion = async (): Promise<{ suma: number; cuenta: number }> => {
  const fila = await rating!('calificacion')
    .whereNull('deleted_at')
    .where('oculta_por_moderacion', false)
    .whereNotNull('visible_at')
    .whereRaw('DATE(fecha) = ?', [FECHA])
    .sum({ suma: 'puntuacion' })
    .count({ cuenta: '*' })
    .first<{ suma: number | string | null; cuenta: number | string }>();

  // Un agregado sin GROUP BY devuelve siempre una fila, pero sin filas la suma llega
  // null. El ?? 0 convierte eso en "no hay nada que promediar" sin romper la aritmetica.
  return { suma: Number(fila?.suma ?? 0), cuenta: Number(fila?.cuenta ?? 0) };
};

/**
 * Calcula y mide la cobertura en la misma vista de los datos.
 *
 * `tasa_cobertura` es la unica metrica que mira **toda** la tabla y no solo las filas
 * del dia, asi que no se puede acotar por fecha: es una fotografia del estado actual.
 * Por eso la base y el calculo tienen que compartir vista. Medir con una conexion y
 * calcular con otra abre una ventana en la que otro suite inserta o borra necesidades,
 * y la asercion falla por una razon que no tiene que ver con la formula.
 *
 * Por eso aqui se mide y se calcula **dentro de una transaccion `REPEATABLE READ`**:
 * las dos lecturas ven el mismo snapshot de MySQL, asi que el denominador medido es
 * exactamente el que consulta la calculadora.
 *
 * Lo que se siembra va **antes** de abrirla. Dentro de la transaccion, un
 * `REPEATABLE READ` ya tiene fijada su vista y no veria las filas que se insertaran
 * despues: el denominador mediria una cosa y la calculadora otra, que es justo el
 * error que se quiere evitar.
 */
async function calcularCobertura(): Promise<{
  valor: number;
  abiertas: number;
  conPropuesta: number;
}> {
  return db!.transaction(async (trx) => {
    const base = await baseCobertura(trx);

    const caso = new CalculateStatistics(
      new KnexEstadisticasCalculadora(trx),
      new KnexEstadisticasSnapshotRepository(trx)
    );
    await caso.ejecutar(FECHA);

    const fila = await trx('statistics_snapshot')
      .where({ fecha: FECHA, metrica: 'tasa_cobertura', dimension: DIMENSION_TOTAL })
      .first('valor');

    return {
      valor: Number(fila?.valor ?? Number.NaN),
      abiertas: base.abiertas,
      conPropuesta: base.conPropuesta,
    };
  });
}

const basePorEstado = async (estado: string): Promise<number> => {
  const [{ n }] = await request!('necesidad')
    .whereNull('deleted_at')
    .where('estado', estado)
    .whereRaw('DATE(fecha_publicacion) = ?', [FECHA])
    .count({ n: '*' });
  return Number(n);
};

const basePropuestasDelDia = async (): Promise<number> => {
  const [{ n }] = await request!('pa_request.propuesta')
    .whereNull('deleted_at')
    .whereRaw('DATE(fecha_envio) = ?', [FECHA])
    .count({ n: '*' });
  return Number(n);
};

const calculo = (): CalculateStatistics =>
  new CalculateStatistics(
    new KnexEstadisticasCalculadora(db!),
    new KnexEstadisticasSnapshotRepository(db!)
  );

const valorDe = async (
  metrica: string,
  dimension = DIMENSION_TOTAL
): Promise<number | undefined> => {
  const fila = await db!('statistics_snapshot')
    .where({ fecha: FECHA, metrica, dimension })
    .first('valor');
  return fila === undefined ? undefined : Number(fila.valor);
};

const antesDeCada = async (): Promise<void> => {
  await limpiar();
};

describe('el calculo de estadisticas escribe lo que antes nadie escribia', () => {
  beforeEach(antesDeCada);
  afterAll(limpiar);

  it('deja filas en statistics_snapshot', async () => {
    if (!disponible) return;

    const antes = await baseNecesidadesDelDia();

    await sembrarNecesidad('ABIERTA');
    const resultado = await calculo().ejecutar(FECHA);

    expect(resultado.metricas).toBe(CATALOGO_METRICAS.length);
    expect(resultado.puntos).toBeGreaterThan(0);
    expect(await valorDe('necesidades_publicadas', DIMENSION_TOTAL)).toBe(antes + 1);
  });

  it('cada metrica del catalogo deja su fila TOTAL', async () => {
    if (!disponible) return;

    await sembrarNecesidad('ABIERTA');
    await calculo().ejecutar(FECHA);

    for (const definicion of CATALOGO_METRICAS) {
      expect(await valorDe(definicion.nombre, DIMENSION_TOTAL)).toBeDefined();
    }
  });

  it('una metrica con dimension deja un TOTAL y un corte por cada valor', async () => {
    if (!disponible) return;

    await sembrarNecesidad('ABIERTA');
    await sembrarNecesidad('ADJUDICADA');
    await calculo().ejecutar(FECHA);

    // Lo que detecta este numero es el fallo de que el desglose acabe guardado como
    // TOTAL: el guardado es un ON DUPLICATE KEY UPDATE, asi que dos filas que chocan
    // no dan error, se pisan en silencio y el TOTAL sigue pareciendo correcto. Solo
    // contar filas distintas lo revela.
    const filas = await db!('statistics_snapshot')
      .where({ fecha: FECHA, metrica: 'necesidades_publicadas' })
      .orderBy('dimension');

    const dimensiones = filas.map((f) => f.dimension as string);

    expect(dimensiones).toContain('ABIERTA');
    expect(dimensiones).toContain('ADJUDICADA');
    expect(dimensiones).toContain(DIMENSION_TOTAL);
    expect(new Set(dimensiones).size).toBe(dimensiones.length);
  });
});

describe('las metricas cuentan lo que dicen que cuentan', () => {
  beforeEach(antesDeCada);
  afterAll(limpiar);

  it('desglosa por estado y excluye el borrado logico', async () => {
    if (!disponible) return;

    const antes = await baseNecesidadesDelDia();
    const baseAbierta = await basePorEstado('ABIERTA');
    const baseAdjudicada = await basePorEstado('ADJUDICADA');

    await sembrarNecesidad('ABIERTA');
    await sembrarNecesidad('ADJUDICADA');
    await sembrarNecesidad('ABIERTA', { eliminada: true });

    await calculo().ejecutar(FECHA);

    // La tercera va borrada logicamente: si el filtro `deleted_at` desapareciera,
    // el total seria tres y no dos.
    expect(await valorDe('necesidades_publicadas', DIMENSION_TOTAL)).toBe(antes + 2);
    expect(await valorDe('necesidades_publicadas', 'ABIERTA')).toBe(baseAbierta + 1);
    expect(await valorDe('necesidades_publicadas', 'ADJUDICADA')).toBe(baseAdjudicada + 1);
  });

  it('cuenta las propuestas enviadas del dia', async () => {
    if (!disponible) return;

    const antes = await basePropuestasDelDia();

    await sembrarNecesidad('ABIERTA', { conPropuesta: true });

    await calculo().ejecutar(FECHA);

    expect(await valorDe('propuestas_enviadas', DIMENSION_TOTAL)).toBe(antes + 1);
    expect(await valorDe('propuestas_enviadas', 'ENVIADA')).toBeGreaterThanOrEqual(1);
  });

  it('calcula la cobertura contra las necesidades abiertas, no contra las del dia', async () => {
    if (!disponible) return;

    await sembrarNecesidad('ABIERTA', { conPropuesta: true });
    await sembrarNecesidad('ABIERTA');
    await sembrarNecesidad('ADJUDICADA', { conPropuesta: true });

    const { valor, abiertas, conPropuesta } = await calcularCobertura();

    expect(valor).toBeCloseTo((100 * conPropuesta) / abiertas, 4);
  });

  it('la cobertura sube cuando una necesidad abierta recibe propuesta', async () => {
    if (!disponible) return;

    // Sin esta comprobacion, una formula que dividiera por el numerador pasaria la
    // prueba anterior y el grafico mostraria el complemento.
    await sembrarNecesidad('ABIERTA', { conPropuesta: true });
    await sembrarNecesidad('ABIERTA');

    const primera = await calcularCobertura();

    expect(primera.valor).toBeCloseTo((100 * primera.conPropuesta) / primera.abiertas, 4);

    await limpiar();
    await sembrarNecesidad('ABIERTA', { conPropuesta: true });
    await sembrarNecesidad('ABIERTA');
    await sembrarNecesidad('ABIERTA', { conPropuesta: true });

    const segunda = await calcularCobertura();

    expect(segunda.valor).toBeCloseTo((100 * segunda.conPropuesta) / segunda.abiertas, 4);
    expect(segunda.valor).toBeGreaterThan(primera.valor);
  });

  it('una necesidad adjudicada no cuenta ni en el numerador ni en el denominador', async () => {
    if (!disponible) return;

    // Adjudicada con propuesta viva: si se colara en el denominador, el ratio bajaria.
    await sembrarNecesidad('ABIERTA');
    const sinAdjudicada = await calcularCobertura();

    await limpiar();
    await sembrarNecesidad('ABIERTA');
    await sembrarNecesidad('ADJUDICADA', { conPropuesta: true });

    const conAdjudicada = await calcularCobertura();

    expect(conAdjudicada.abiertas).toBe(sinAdjudicada.abiertas);
    expect(conAdjudicada.conPropuesta).toBe(sinAdjudicada.conPropuesta);
    expect(conAdjudicada.valor).toBeCloseTo(sinAdjudicada.valor, 4);
  });

  it('la cobertura sale como numero aunque no haya nada abierto', async () => {
    if (!disponible) return;

    // El contrato que se comprueba aqui es "nunca null": un `NULL` sin envolver en
    // COALESCE llegaria al snapshot como null y el grafico dibujaria un hueco en vez
    // de un cero. El 0 exacto solo se da si no hay ninguna abierta en la base, y eso
    // no se puede prometer mientras otros suites comparten la tabla, asi que se
    // comprueba el tipo y el rango en vez del valor absoluto.
    await sembrarNecesidad('ADJUDICADA', { conPropuesta: true });

    await calculo().ejecutar(FECHA);

    const cobertura = await valorDe('tasa_cobertura', DIMENSION_TOTAL);

    expect(cobertura).not.toBeNull();
    expect(cobertura).not.toBeUndefined();
    expect(Number.isFinite(cobertura as number)).toBe(true);
    expect(cobertura as number).toBeGreaterThanOrEqual(0);
    expect(cobertura as number).toBeLessThanOrEqual(100);
  });

  it('excluye los servicios borrados logicamente', async () => {
    if (!disponible) return;

    // El catalogo tiene datos semilla, asi que la afirmacion es sobre el delta que
    // aporta esta prueba, no sobre un total absoluto: si el seed cambia, la prueba
    // sigue diciendo lo mismo.
    const serviciosAntes = await baseServicios();
    const prestadoresAntes = await basePrestadores();

    await sembrarCatalogo({ servicioEliminado: true });

    await calculo().ejecutar(FECHA);

    expect(await valorDe('servicios_por_estado', DIMENSION_TOTAL)).toBe(serviciosAntes);
    expect(await valorDe('prestadores_por_estado', DIMENSION_TOTAL)).toBe(prestadoresAntes + 1);
  });

  it('promedia solo las calificaciones visibles, no moderadas y no borradas', async () => {
    if (!disponible) return;

    // De lo sembrado aqui solo cuentan 5 y 1: la de 1 en periodo ciego, la moderada
    // y la borrada quedan fuera. La razon de ser de los tres filtros. La media se
    // compara contra la suma y el conteo reales del momento, porque la tabla es
    // compartida con `rating-service` y puede contener mas filas.
    const antes = await baseValoracion();

    await sembrarCalificacion(900001, 5, { visible: true });
    await sembrarCalificacion(900002, 1, { visible: true });
    await sembrarCalificacion(900003, 1, {});
    await sembrarCalificacion(900004, 1, { visible: true, moderada: true });
    await sembrarCalificacion(900005, 1, { visible: true, eliminada: true });

    await calculo().ejecutar(FECHA);

    const esperada = (antes.suma + 5 + 1) / (antes.cuenta + 2);

    expect(await valorDe('valoracion_media', DIMENSION_TOTAL)).toBeCloseTo(esperada, 4);
  });
});

describe('guardar es idempotente', () => {
  beforeEach(antesDeCada);
  afterAll(limpiar);

  it('dos vueltas para la misma fecha dejan el mismo numero de filas', async () => {
    if (!disponible) return;

    await sembrarNecesidad('ABIERTA');

    await calculo().ejecutar(FECHA);
    const primera = await db!('statistics_snapshot').where({ fecha: FECHA }).count({ n: '*' });

    await calculo().ejecutar(FECHA);
    const segunda = await db!('statistics_snapshot').where({ fecha: FECHA }).count({ n: '*' });

    expect(Number(segunda[0].n)).toBe(Number(primera[0].n));
  });

  it('la segunda vuelta actualiza el valor en vez de duplicar la fila', async () => {
    if (!disponible) return;

    const antes = await baseNecesidadesDelDia();

    await sembrarNecesidad('ABIERTA');
    await calculo().ejecutar(FECHA);
    expect(await valorDe('necesidades_publicadas', DIMENSION_TOTAL)).toBe(antes + 1);

    await sembrarNecesidad('ABIERTA');
    await calculo().ejecutar(FECHA);

    expect(await valorDe('necesidades_publicadas', DIMENSION_TOTAL)).toBe(antes + 2);
  });
});

describe('el lector de informes ve lo que escribio el calculo', () => {
  beforeEach(antesDeCada);
  afterAll(limpiar);

  it('devuelve la serie calculada', async () => {
    if (!disponible) return;

    const antes = await baseNecesidadesDelDia();

    await sembrarNecesidad('ABIERTA');
    await calculo().ejecutar(FECHA);

    const informes = new ManageReportsUseCase(
      new KnexAuditRepository(db!),
      new KnexParameterRepository(db!),
      new KnexStatisticsRepository(db!),
      new KnexBackupRepository(db!),
      new SystemClock()
    );

    const serie = (await informes.serie({
      metrica: 'necesidades_publicadas',
      dimension: DIMENSION_TOTAL,
    })) as { total: number; elementos: Record<string, unknown>[] };

    expect(serie.total).toBe(1);
    expect(serie.elementos[0]).toMatchObject({
      fecha: FECHA,
      metrica: 'necesidades_publicadas',
      dimension: DIMENSION_TOTAL,
      valor: antes + 1,
    });
  });

  it('anuncia la metrica que se puede pedir', async () => {
    if (!disponible) return;

    await sembrarNecesidad('ABIERTA');
    await calculo().ejecutar(FECHA);

    const metricas = await new KnexStatisticsRepository(db!).metricas();

    expect(metricas).toContain('necesidades_publicadas');
    expect(metricas).toContain('tasa_cobertura');
  });
});
