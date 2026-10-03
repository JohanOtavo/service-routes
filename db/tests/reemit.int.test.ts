/**
 * Re-emision de eventos y reconstruccion de replicas (A-2, B-2).
 *
 *   docker compose up -d
 *   npx jest --selectProjects integration
 *
 * El criterio de cierre del backlog pide que exista el comando y que "se ha
 * ejecutado al menos una vez reconstruyendo `prestador_ref` desde cero". Eso es
 * lo que prueba el primer caso: borra la replica y la recupera.
 *
 * No se levanta RabbitMQ aqui. La re-emision escribe en el outbox y el relevo
 * publica —esa division es deliberada, para que use el mismo camino que un alta
 * real—, asi que esta prueba aplica el evento con el mismo upsert que usa el
 * consumidor en lugar de esperar al broker. Lo que se verifica es que el
 * payload re-emitido CONTIENE lo que el consumidor necesita; que el consumidor
 * aplique bien un payload correcto ya lo cubre
 * `packages/messaging/tests/consumer-idempotency.int.test.ts`.
 */
import knexLib, { type Knex } from 'knex';

/* eslint-disable @typescript-eslint/no-require-imports */
const configs = require('../knexfile') as Record<string, Knex.Config>;
const { reemitir } = require('../reemit') as {
  reemitir: (
    db: Knex,
    servicio: string
  ) => Promise<{ escritos: number; correlationId?: string; detalle: string[] }>;
};
/* eslint-enable @typescript-eslint/no-require-imports */

let provider: Knex;
let catalog: Knex;
let disponible = false;
let motivoNoDisponible = '';

const PRESTADOR = 990_101;
const USUARIO = 990_102;
const NOMBRE = 'Prestador de la prueba de re-emision';

beforeAll(async () => {
  try {
    provider = knexLib(configs['provider'] as Knex.Config);
    catalog = knexLib(configs['catalog'] as Knex.Config);
    await provider.raw('SELECT 1');
    await catalog.raw('SELECT 1');
    disponible = true;
  } catch (error) {
    motivoNoDisponible = error instanceof Error ? error.message : String(error);
    disponible = false;
  }
}, 30_000);

const limpiar = async (): Promise<void> => {
  await provider('outbox_event').where('aggregate_id', String(PRESTADOR)).delete();
  await provider('prestador').where('id_prestador', PRESTADOR).delete();
  await catalog('prestador_ref').where('id_prestador', PRESTADOR).delete();
};

const sembrarPrestador = async (): Promise<void> => {
  await provider('prestador').insert({
    id_prestador: PRESTADOR,
    id_usuario: USUARIO,
    nombre: NOMBRE,
    especialidad: 'Plomeria',
    estado: 'ACTIVE',
  });
};

afterAll(async () => {
  if (disponible) await limpiar();
  if (provider !== undefined) await provider.destroy();
  if (catalog !== undefined) await catalog.destroy();
});

const saltarSiNoHayBase = (): boolean => {
  if (!disponible) {
    if (process.env['REQUIRE_INTEGRATION'] === '1') {
      throw new Error(`La prueba de re-emision no pudo arrancar: ${motivoNoDisponible}`);
    }
    console.warn(`prueba de re-emision omitida: ${motivoNoDisponible}`);
  }
  return !disponible;
};

const comoPayload = (bruto: unknown): Record<string, unknown> =>
  (typeof bruto === 'string' ? JSON.parse(bruto) : bruto) as Record<string, unknown>;

/** El mismo upsert que hace `KnexPrestadorRefRepository`. */
const aplicarEnReplica = async (payload: Record<string, unknown>): Promise<void> => {
  await catalog('prestador_ref')
    .insert({
      id_prestador: Number(payload['idPrestador']),
      id_usuario: Number(payload['idUsuario']),
      nombre: String(payload['nombre'] ?? ''),
      especialidad: payload['especialidad'] === undefined ? null : String(payload['especialidad']),
      estado: String(payload['estado']),
      synced_at: new Date(),
    })
    .onConflict('id_prestador')
    .merge();
};

describe('re-emision de eventos', () => {
  beforeEach(async () => {
    if (disponible) await limpiar();
  });

  it('reconstruye prestador_ref desde cero', async () => {
    if (saltarSiNoHayBase()) return;

    await sembrarPrestador();

    // La replica se pierde: es el escenario que A-2 existe para resolver.
    await catalog('prestador_ref').where('id_prestador', PRESTADOR).delete();
    expect(await catalog('prestador_ref').where('id_prestador', PRESTADOR).first()).toBeUndefined();

    const resultado = await reemitir(provider, 'provider');
    expect(resultado.escritos).toBeGreaterThan(0);

    const encolado = await provider('outbox_event')
      .where({ aggregate_id: String(PRESTADOR), event_name: 'ServiceProviderProfileCreated' })
      .first();
    expect(encolado).toBeDefined();

    const payload = comoPayload(encolado.payload);

    // Las claves que el consumidor exige. Si faltaran no fallaria nada: la fila
    // quedaria con NaN o con el nombre vacio, que es el modo de fallo que este
    // comando tiene que evitar.
    expect(payload['idPrestador']).toBe(PRESTADOR);
    expect(payload['idUsuario']).toBe(USUARIO);
    expect(payload['nombre']).toBe(NOMBRE);
    expect(payload['estado']).toBe('ACTIVE');

    await aplicarEnReplica(payload);

    const recuperada = await catalog('prestador_ref').where('id_prestador', PRESTADOR).first();
    expect(recuperada).toBeDefined();
    expect(recuperada.nombre).toBe(NOMBRE);
    expect(recuperada.estado).toBe('ACTIVE');
  }, 60_000);

  it('marca cada evento como re-emision, para que nadie reenvie un aviso', async () => {
    if (saltarSiNoHayBase()) return;

    await sembrarPrestador();
    await reemitir(provider, 'provider');

    const filas = await provider('outbox_event').where('aggregate_id', String(PRESTADOR));
    expect(filas.length).toBeGreaterThan(0);
    for (const fila of filas) {
      expect(comoPayload(fila.payload)['reemision']).toBe(true);
    }
  }, 60_000);

  it('deja los eventos sin publicar, para que los envie el relevo', async () => {
    if (saltarSiNoHayBase()) return;

    await sembrarPrestador();
    await reemitir(provider, 'provider');

    const fila = await provider('outbox_event').where('aggregate_id', String(PRESTADOR)).first();
    expect(fila.published_at).toBeNull();
    expect(Number(fila.attempts)).toBe(0);
  }, 60_000);

  it('usa un event_id nuevo cada vez, porque processed_event descartaria el viejo', async () => {
    if (saltarSiNoHayBase()) return;

    await sembrarPrestador();
    await reemitir(provider, 'provider');
    await reemitir(provider, 'provider');

    const filas = await provider('outbox_event').where('aggregate_id', String(PRESTADOR));
    expect(filas).toHaveLength(2);
    expect(new Set(filas.map((f: { event_id: string }) => f.event_id)).size).toBe(2);
  }, 60_000);

  it('un servicio sin replicas que re-emitir no es un error', async () => {
    if (saltarSiNoHayBase()) return;

    const r = await reemitir(provider, 'notification');
    expect(r.escritos).toBe(0);
    expect(r.detalle.join(' ')).toContain('sin replicas');
  }, 30_000);
});
