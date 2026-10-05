/**
 * Re-emision de la outbox contra MySQL real (A-4 del backlog).
 *
 * Que demuestra. Que el comando de re-emision existe, que republica de una forma
 * que el consumidor acepta, y —lo que es el criterio de cierre— que ejecutandolo
 * una replica vacia vuelve a poblarse. No con un doble: se usa el `OutboxRelay`
 * real, el `EventConsumer` real, el repositorio real y el caso de uso real. Un
 * broker falso solo aporta el ultimo salto, el de RabbitMQ, que es el unico que
 * no se puede comprobar con MySQL.
 *
 * La cadena que se prueba, entera:
 *
 *   reemitir()  ->  outbox_event (copia con event_id nuevo)
 *               ->  OutboxRelay.ciclo()  publica lo pendiente
 *               ->  EventConsumer       acepta el evento nuevo
 *               ->  SyncReplicasUseCase escribe la replica
 *
 * Y encaja con la decision que se tomo: republicar con `event_id` nuevo, sin
 * tocar `processed_event` del destino. Eso es justo lo que hace posible la ultima
 * fila de la cadena, porque el consumidor solo descarta lo que ya tiene marcado.
 */
import knexLib, { type Knex } from 'knex';
import { OutboxRelay } from '@punto-amigo/messaging';
import { EventConsumer } from '@punto-amigo/messaging';
import type { Broker } from '@punto-amigo/messaging';
import { SyncReplicasUseCase } from '../../services/request-service/src/application/use-cases/SyncReplicas';
import { KnexReplicaRepository } from '../../services/request-service/src/infrastructure/persistence/KnexSupportRepositories';
import { SyncProviderRefUseCase } from '../../services/catalog-service/src/application/use-cases/SyncProviderRef';
import { KnexPrestadorRefRepository } from '../../services/catalog-service/src/infrastructure/persistence/KnexPrestadorRefRepository';
import type { EstadoPrestador } from '../../services/catalog-service/src/domain';
import { EventName } from '@punto-amigo/shared';

// El modulo bajo prueba es JavaScript plano, como el resto de db/.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const requireJS = createRequire(__filename);
const { reemitir } = requireJS('../reemit.js') as {
  reemitir: (
    db: Knex,
    opciones: Record<string, unknown>
  ) => Promise<{
    candidatas: number;
    encoladas: number;
    truncado: boolean;
  }>;
};

const CONSUMIDOR = 'prueba-reemision';
const CONSUMIDOR_CATALOG = 'prueba-reemision-catalogo';

/** correo y nombre propios de esta prueba, para no depender de los seeds. */
const CORREO = 'reemision@puntoamigo.local';
const NOMBRE = 'Usuario de la reemision';

/** nombre del prestador de la parte de catalogo. */
const NOMBRE_PRESTADOR = 'Prestador de la reemision';

let auth: Knex | undefined;
let request: Knex | undefined;
let provider: Knex | undefined;
let catalog: Knex | undefined;
let idUsuario = 0;
let eventIdOriginal = '';
let idPrestador = 0;

const conexion = (clave: 'AUTH' | 'REQUEST' | 'PROVIDER' | 'CATALOG', esquema: string): Knex =>
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

let disponible = false;
let motivoNoDisponible = '';

beforeAll(async () => {
  try {
    auth = conexion('AUTH', 'pa_auth');
    request = conexion('REQUEST', 'pa_request');
    provider = conexion('PROVIDER', 'pa_provider');
    catalog = conexion('CATALOG', 'pa_catalog');
    await auth.raw('SELECT 1');
    await request.raw('SELECT 1');
    await provider.raw('SELECT 1');
    await catalog.raw('SELECT 1');
    disponible = true;
  } catch (error) {
    motivoNoDisponible = error instanceof Error ? error.message : String(error);
  }
});

afterAll(async () => {
  if (!disponible) return;
  await limpiar();
  await limpiarPrestador();
  await catalog?.destroy();
  await provider?.destroy();
  await request?.destroy();
  await auth?.destroy();
});

/**
 * Deja la base como estaba.
 *
 * Se ejecuta en `afterAll` y tambien entre pruebas: las tablas `usuario`,
 * `outbox_event` y `usuario_ref` son compartidas con las ocho suites de
 * integracion de los servicios, asi que esta prueba solo puede afirmar sobre sus
 * propias filas.
 */
async function limpiar(): Promise<void> {
  if (auth === undefined || request === undefined) return;

  await request('processed_event').where({ consumer: CONSUMIDOR }).delete();
  if (idUsuario > 0) {
    await request('usuario_ref').where({ id_usuario: idUsuario }).delete();
  }
  await auth('outbox_event')
    .where({ event_name: EventName.UserRegistered })
    .where({ aggregate_id: String(idUsuario) })
    .delete();
  if (idUsuario > 0) {
    await auth('usuario_rol').where({ id_usuario: idUsuario }).delete();
    await auth('usuario').where({ id_usuario: idUsuario }).delete();
  }
}

/** Crea el usuario y su evento de alta, que es el punto de partida. */
async function sembrarAlta(): Promise<void> {
  await auth!('usuario').where({ correo: CORREO }).delete();
  const [idCreado] = await auth!('usuario').insert({
    nombre: NOMBRE,
    correo: CORREO,
    contrasena_hash: 'x',
  });
  idUsuario = Number(idCreado);

  const eventId = randomUUID();
  await auth!('outbox_event').insert({
    event_id: eventId,
    event_name: EventName.UserRegistered,
    aggregate_type: 'Usuario',
    aggregate_id: String(idUsuario),
    correlation_id: '22222222-2222-4222-8222-222222222222',
    payload: JSON.stringify({ userId: idUsuario, nombre: NOMBRE, correo: CORREO, roles: [] }),
    published_at: new Date(),
  });
  eventIdOriginal = eventId;
}

/**
 * Limpia lo del prestador de esta prueba.
 *
 * El orden importa y no es cosmetico: `servicio.id_prestador` declara clave
 * foranea contra `prestador_ref`, asi que los hijos se borran antes que el padre
 * o MySQL lo rechaza con `RESTRICT`.
 */
async function limpiarPrestador(): Promise<void> {
  if (provider === undefined || catalog === undefined) return;

  await catalog('processed_event').where({ consumer: CONSUMIDOR_CATALOG }).delete();
  if (idPrestador > 0) {
    await catalog('servicio').where({ id_prestador: idPrestador }).delete();
    await catalog('prestador_ref').where({ id_prestador: idPrestador }).delete();
    await provider('prestador').where({ id_prestador: idPrestador }).delete();
  }
  await provider('outbox_event')
    .where({ event_name: EventName.ServiceProviderProfileCreated })
    .where({ aggregate_id: String(idPrestador) })
    .delete();
}

/**
 * Crea un prestador en `pa_provider` y el evento de alta de su perfil, que es lo
 * que consume `catalog-service` para poblar `prestador_ref`.
 *
 * Se escribe la fila del outbox en vez de invocar `ManageProviderProfileUseCase`
 * porque el dominio de provider-service ya tiene sus pruebas unitarias y aqui lo
 * que se prueba es el tramo entre servicios.
 */
async function sembrarPrestador(): Promise<void> {
  await provider!('prestador').where({ nombre: NOMBRE_PRESTADOR }).delete();
  const [id] = await provider!('prestador').insert({
    id_usuario: 999999,
    nombre: NOMBRE_PRESTADOR,
    especialidad: 'Plomeria',
    estado: 'PENDING_VALIDATION',
  });
  idPrestador = Number(id);

  const eventId = randomUUID();
  await provider!('outbox_event').insert({
    event_id: eventId,
    event_name: EventName.ServiceProviderProfileCreated,
    aggregate_type: 'Prestador',
    aggregate_id: String(idPrestador),
    correlation_id: '33333333-3333-4333-8333-333333333333',
    payload: JSON.stringify({
      idPrestador: idPrestador,
      idUsuario: 999999,
      nombre: NOMBRE_PRESTADOR,
      especialidad: 'Plomeria',
      estado: 'PENDING_VALIDATION',
    }),
    // Sin publicar, como queda una fila recien encolada. El relay la recogera en
    // el primer republic.
    published_at: null,
  });
}

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

/**
 * Broker que captura lo publicado y entrega lo que se le pase, sin RabbitMQ.
 *
 * Lo unico que se falsea es el ultimo salto, el transporte. Todo lo que se puede
 * comprobar contra MySQL se comprueba contra MySQL, porque los defectos que
 * justifican estas pruebas estan en lo que el motor devuelve al insertar y no en
 * como viaja el mensaje.
 *
 * `consume` no devuelve una promesa y entrega en un callback, igual que el broker
 * real: por eso `entregar` guarda el callback y lo invoca la prueba.
 */
function brokerCapturador(): {
  broker: Broker;
  publicados: Buffer[];
  confirmados: number[];
  entregados: number;
  entregar: (contenido: Buffer) => void;
} {
  const publicados: Buffer[] = [];
  const confirmados: number[] = [];
  let callback: ((m: unknown) => void) | null = null;
  let entregados = 0;

  const canal = {
    prefetch: async (): Promise<void> => undefined,
    consume: async (_cola: string, cb: (m: unknown) => void): Promise<void> => {
      callback = cb;
    },
    ack: (m: { fields: { deliveryTag: number } }): void => {
      confirmados.push(m.fields.deliveryTag);
    },
    nack: (): void => undefined,
  };

  const broker = {
    disponible: true,
    declararCola: async (): Promise<void> => undefined,
    // El relay llama a `publicar(clave, contenido, eventId)`.
    publicar: async (_clave: string, contenido: Buffer): Promise<void> => {
      publicados.push(contenido);
    },
    canalActivo: canal,
  } as unknown as Broker;

  return {
    broker,
    publicados,
    confirmados,
    entregar: (contenido: Buffer) => {
      entregados += 1;
      callback?.({
        content: contenido,
        fields: {
          deliveryTag: entregados,
          redelivered: false,
          exchange: 'punto-amigo.events',
          routingKey: 'iam.usuario.user_registered',
        },
        properties: { headers: {} },
      });
    },
    get entregados() {
      return entregados;
    },
  };
}

const esperarA = async (condicion: () => boolean, techoMs = 2000): Promise<void> => {
  const limite = Date.now() + techoMs;
  while (!condicion()) {
    if (Date.now() > limite) return;
    await new Promise((r) => setTimeout(r, 10));
  }
};

/**
 * Filtros de la prueba, acotados al usuario sembrado.
 *
 * El recorte no es cosmético. La outbox de `pa_auth` la comparten las semillas y
 * las ocho suites de integracion de los servicios, y `UserRegistered` tiene
 * cuatro filas de semilla que no son de esta prueba: sin `--agregado` las
 * cifras de esta prueba serian las de todos los demas.
 */
const opciones = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  event: [EventName.UserRegistered],
  agregado: String(idUsuario),
  ...extra,
});

describe('la re-emision de la outbox', () => {
  it('sin --ejecutar no escribe nada', async () => {
    if (saltar()) return;
    await limpiar();
    await sembrarAlta();

    const antes = await auth!('outbox_event').count<{ n: number }[]>({ n: '*' });
    const resultado = await reemitir(auth!, opciones());
    const despues = await auth!('outbox_event').count<{ n: number }[]>({ n: '*' });

    expect(resultado.candidatas).toBe(1);
    expect(resultado.encoladas).toBe(0);
    expect(Number(despues[0]?.n)).toBe(Number(antes[0]?.n));
  });

  it('copia el evento con identidad nueva y sin perder la fecha original', async () => {
    if (saltar()) return;
    await limpiar();
    await sembrarAlta();

    const original = await auth!('outbox_event').where({ event_id: eventIdOriginal }).first();
    const resultado = await reemitir(auth!, opciones({ ejecutar: true }));

    expect(resultado.encoladas).toBe(1);

    const copia = await auth!('outbox_event').where({ reemit_of: eventIdOriginal }).first();

    // Identidad nueva: es lo que permite al consumidor aceptarlo sin borrar su
    // marca de "ya procesado".
    expect(copia.event_id).not.toBe(eventIdOriginal);
    // El rastro de que esto es una repeticion, no un evento nuevo. Vive en
    // `reemit_of`, y no se deduce del `causation_id` porque un evento de negocio
    // tambien lo tiene.
    expect(copia.reemit_of).toBe(eventIdOriginal);
    expect(copia.causation_id).toBe(eventIdOriginal);
    // La fecha se conserva porque es la que fija el orden de publicacion, y el
    // orden es lo que hace respetar las claves foraneas entre esquemas.
    expect(String(copia.occurred_at)).toBe(String(original.occurred_at));
    expect(copia.payload).toEqual(original.payload);
    expect(copia.published_at).toBeNull();
  });

  it('repetir el comando no multiplica los eventos', async () => {
    if (saltar()) return;
    await limpiar();
    await sembrarAlta();

    const corrida = opciones({ ejecutar: true });
    await reemitir(auth!, corrida);
    await reemitir(auth!, corrida);
    const tercera = await reemitir(auth!, corrida);

    // Idempotente de verdad: la segunda y la tercera ejecucion no encolan nada.
    // Ejecutar el comando dos veces por desconfiar del resultado es el caso mas
    // probable, y tiene que devolver lo mismo que la primera. Con un filtro que
    // solo excluia las copias —sin mirar si el original ya se habia copiado—
    // aqui habria tres copias del mismo alta, y la prueba habria pasado igual.
    expect(tercera.encoladas).toBe(0);
    expect(await auth!('outbox_event').where({ reemit_of: eventIdOriginal })).toHaveLength(1);

    // Y con `--incluir-repeticiones` el operador si puede pedir las copias a
    // proposito, que es lo que hace falta para reprocesar una que se publico a
    // medio hacer.
    const conRepeticiones = await reemitir(
      auth!,
      opciones({ ejecutar: true, incluirRepeticiones: true })
    );
    expect(conRepeticiones.candidatas).toBe(2);
  });

  /**
   * Un evento de negocio tambien tiene `causation_id` apuntando a otro evento de
   * la misma outbox. Si el filtro de repeticiones se apoyara en ahi, este evento
   * desapareceria de la re-emision y con el se caeria la reconstruccion del
   * catalogo, que es el caso para el que existe el comando.
   */
  it('no confunde un evento encadenado de verdad con una repeticion', async () => {
    if (saltar()) return;
    await limpiar();
    await sembrarAlta();

    // Un segundo evento del mismo usuario, causado por el primero.
    const encadenado = randomUUID();
    await auth!('outbox_event').insert({
      event_id: encadenado,
      event_name: EventName.UserRegistered,
      aggregate_type: 'Usuario',
      aggregate_id: String(idUsuario),
      correlation_id: '22222222-2222-4222-8222-222222222222',
      causation_id: eventIdOriginal,
      payload: JSON.stringify({ userId: idUsuario, nombre: NOMBRE, correo: CORREO, roles: [] }),
      published_at: new Date(),
    });

    const resultado = await reemitir(auth!, opciones({ ejecutar: true }));

    // Ambos son candidatos: el encadenado tambien.
    expect(resultado.encoladas).toBe(2);
    expect(await auth!('outbox_event').where({ reemit_of: eventIdOriginal })).toHaveLength(1);
    expect(await auth!('outbox_event').where({ reemit_of: encadenado })).toHaveLength(1);
  });

  /**
   * El criterio de cierre de A-4: ejecutar el comando reconstruye una replica
   * vacia. Es la unica prueba que atraviesa la cadena entera.
   */
  it('reconstruye una replica vacia de extremo a extremo', async () => {
    if (saltar()) return;
    await limpiar();
    await sembrarAlta();

    // Se vacia la replica y se marca el evento original como ya procesado: el
    // estado que deja una perdida de `processed_event` mas una tabla borrada.
    await request!('usuario_ref').where({ id_usuario: idUsuario }).delete();
    await request!('processed_event')
      .insert({ consumer: CONSUMIDOR, event_id: eventIdOriginal })
      .onConflict(['consumer', 'event_id'])
      .ignore();

    expect(await request!('usuario_ref').where({ id_usuario: idUsuario }).first()).toBeUndefined();

    // 1. El comando reencola. Con identidad nueva, asi que la marca del original
    //    no lo afecta.
    await reemitir(auth!, opciones({ ejecutar: true }));

    // 2. El relay real publica lo pendiente.
    const { broker, publicados, confirmados, entregar } = brokerCapturador();
    const relay = new OutboxRelay(
      auth!,
      broker,
      { intervaloMs: 1000, lote: 50, maxIntentos: 5, contexto: 'iam' },
      { info: () => undefined, error: () => undefined }
    );
    await relay.ciclo();

    // El relay publica todo lo pendiente del esquema, no solo lo reemitido: las
    // semillas tambien dejaban filas sin publicar. Lo que se comprueba es que la
    // copia esta entre ellas.
    const copia = await auth!('outbox_event').where({ reemit_of: eventIdOriginal }).first();
    const mio = publicados.filter((c) => {
      const sobre = JSON.parse(c.toString('utf8')) as { eventId?: string };
      return sobre.eventId === copia.event_id;
    });
    expect(mio).toHaveLength(1);

    // 3. El consumidor real recibe el sobre y el caso de uso real escribe la
    //    replica. Sin este paso, el anterior seria el final del camino y la
    //    prueba no probaria nada del consumidor.
    const sincronizacion = new SyncReplicasUseCase(new KnexReplicaRepository(request!));

    const consumidor = new EventConsumer(
      request!,
      broker,
      {
        cola: 'prueba-reemision',
        patrones: ['iam.#'],
        consumidor: CONSUMIDOR,
        prefetch: 10,
      },
      { info: () => undefined, error: () => undefined }
    );

    consumidor.on(EventName.UserRegistered, async (sobre) => {
      const p = sobre.payload;
      await sincronizacion.alCambiarUsuario({
        idUsuario: Number(p['userId']),
        nombre: p['nombre'] === undefined ? null : String(p['nombre']),
        correo: p['correo'] === undefined ? null : String(p['correo']),
        estado: 'ACTIVO',
      });
    });

    await consumidor.iniciar();

    // Se entrega solo el sobre de la copia. El relay publico tambien las filas
    // pendientes de las semillas, y consumirlas escribiria `usuario_ref` de otros
    // usuarios que no son de esta prueba.
    for (const contenido of publicados) {
      const sobre = JSON.parse(contenido.toString('utf8')) as { eventId?: string };
      if (sobre.eventId === copia.event_id) entregar(contenido);
    }
    await esperarA(() => confirmados.length === 1);

    // El evento original sigue marcado, y aun asi la replica se repoblo: eso es
    // justamente lo que compra el `event_id` nuevo. Con el mismo identificador, el
    // consumidor lo habria descartado y esta prueba habria fallado.
    const marcado = await request!('processed_event')
      .where({ consumer: CONSUMIDOR, event_id: eventIdOriginal })
      .first();
    expect(marcado).toBeDefined();

    const fila = await request!('usuario_ref').where({ id_usuario: idUsuario }).first();
    expect(fila).toBeDefined();
    expect(String(fila.nombre)).toBe(NOMBRE);
    expect(String(fila.correo)).toBe(CORREO);
    expect(confirmados).toHaveLength(1);
  });
});

/**
 * La parte de A-2 que quedaba abierta: `pa_catalog.prestador_ref`.
 *
 * A diferencia de `usuario_ref`, esta replica no la escribe ningun evento de
 * usuario: la escribe el perfil del prestador. Y hay una razon por la que el
 * comando tiene que funcionar aqui y no basta con decir que funciona en general:
 * `servicio.id_prestador` declara clave foranea contra `prestador_ref`, de modo
 * que un `prestador_ref` vacio no es solo una tabla menos, es un catalogo al que
 * no se puede publicar ningun servicio.
 */
describe('la re-emision reconstruye prestador_ref', () => {
  /** Publica la outbox de provider y entrega lo publicado al consumidor de catalog. */
  const republicarYConsumir = async (): Promise<{ confirmados: number }> => {
    const { broker, publicados, confirmados, entregar } = brokerCapturador();
    const relay = new OutboxRelay(
      provider!,
      broker,
      { intervaloMs: 1000, lote: 50, maxIntentos: 5, contexto: 'provider' },
      { info: () => undefined, error: () => undefined }
    );
    await relay.ciclo();

    const sincronizarPrestador = new SyncProviderRefUseCase(
      new KnexPrestadorRefRepository(catalog!)
    );
    const consumidor = new EventConsumer(
      catalog!,
      broker,
      {
        cola: 'prueba-reemision-catalogo',
        patrones: ['provider.prestador.*'],
        consumidor: CONSUMIDOR_CATALOG,
        prefetch: 10,
      },
      { info: () => undefined, error: () => undefined }
    );

    for (const evento of [
      EventName.ServiceProviderProfileCreated,
      EventName.ServiceProviderProfileUpdated,
      EventName.ServiceProviderProfileValidated,
    ]) {
      consumidor.on(evento, async (sobre) => {
        const p = sobre.payload;
        await sincronizarPrestador.alRefrescarPerfil({
          idPrestador: Number(p['idPrestador']),
          idUsuario: Number(p['idUsuario']),
          nombre: String(p['nombre'] ?? ''),
          especialidad: p['especialidad'] === undefined ? null : String(p['especialidad']),
          estado: String(p['estado'] ?? 'PENDING_VALIDATION') as EstadoPrestador,
          ocurridoAt: new Date(sobre.occurredAt),
        });
      });
    }

    await consumidor.iniciar();

    // Solo se entrega lo que es de este prestador: el relay publica tambien lo
    // pendiente de las semillas, y consumirlas escribira filas de otros.
    const mios = new Set(
      (
        await provider!('outbox_event')
          .select('event_id')
          .where({ aggregate_id: String(idPrestador) })
          .where({ event_name: EventName.ServiceProviderProfileCreated })
      ).map((f) => String(f.event_id))
    );

    for (const contenido of publicados) {
      const sobre = JSON.parse(contenido.toString('utf8')) as { eventId?: string };
      if (sobre.eventId !== undefined && mios.has(sobre.eventId)) entregar(contenido);
    }
    await esperarA(() => confirmados.length >= 1);
    return { confirmados: confirmados.length };
  };

  it('puebla prestador_ref y vuelve a permitir referenciar a un prestador', async () => {
    if (saltar()) return;
    await limpiarPrestador();
    await sembrarPrestador();

    // 1. La replica se puebla por el camino normal, para tener un punto de
    //    partida creible.
    await republicarYConsumir();
    expect(
      await catalog!('prestador_ref').where({ id_prestador: idPrestador }).first()
    ).toBeDefined();

    // 2. La perdida. MySQL no deja borrar `prestador_ref` mientras haya servicios
    //    que la referencien, asi que el escenario realista es la perdida del
    //    esquema entero; aun asi, que el orden de borrado sea el inverso al de
    //    creacion es la misma restriccion que hace obligatoria la reemision.
    const antesDelDesastre = await catalog!('servicio')
      .where({ id_prestador: idPrestador })
      .first();
    expect(antesDelDesastre).toBeUndefined();

    await catalog!('prestador_ref').where({ id_prestador: idPrestador }).delete();
    expect(
      await catalog!('prestador_ref').where({ id_prestador: idPrestador }).first()
    ).toBeUndefined();

    // 3. El comando, y con el la cadena relay + consumidor + caso de uso.
    await reemitir(provider!, {
      event: [EventName.ServiceProviderProfileCreated],
      agregado: String(idPrestador),
      ejecutar: true,
    });
    const { confirmados } = await republicarYConsumir();
    expect(confirmados).toBeGreaterThanOrEqual(1);

    const repoblada = await catalog!('prestador_ref').where({ id_prestador: idPrestador }).first();
    expect(repoblada).toBeDefined();
    expect(String(repoblada.nombre)).toBe(NOMBRE_PRESTADOR);
    expect(String(repoblada.especialidad)).toBe('Plomeria');

    // 4. Y lo que de verdad importa: la clave foranea vuelve a ser satisfacible.
    //    Sin esto, la replica estaria poblada pero el catalogo seguiria sin poder
    //    registrar un servicio.
    const idCategoria = await catalog!('categoria_servicio')
      .orderBy('id_categoria')
      .first('id_categoria');
    const [idServicio] = await catalog!('servicio').insert({
      nombre_servicio: 'Cambio de grifo',
      descripcion: 'Servicio de prueba de la reemision',
      id_prestador: idPrestador,
      id_categoria: idCategoria.id_categoria,
      estado: 'ACTIVE',
    });
    const servicio = await catalog!('servicio').where({ id_servicio: idServicio }).first();
    expect(servicio).toBeDefined();
  });

  it('un prestador_ref vacio no puede referenciarse: la clave foranea lo impide', async () => {
    if (saltar()) return;
    await limpiarPrestador();
    await sembrarPrestador();
    await republicarYConsumir();

    // Con la replica poblada, el servicio entra.
    const idCategoria = await catalog!('categoria_servicio')
      .orderBy('id_categoria')
      .first('id_categoria');
    const [idServicio] = await catalog!('servicio').insert({
      nombre_servicio: 'Servicio con prestador',
      descripcion: 'Se inserta mientras prestador_ref tiene la fila',
      id_prestador: idPrestador,
      id_categoria: idCategoria.id_categoria,
      estado: 'ACTIVE',
    });
    expect(await catalog!('servicio').where({ id_servicio: idServicio }).first()).toBeDefined();

    // Y con la replica vacia, no entra. Esta es la restriccion que hace que la
    // reemision no sea opcional: no se puede "arreglar despues" el catalogo.
    await catalog!('servicio').where({ id_servicio: idServicio }).delete();
    await catalog!('prestador_ref').where({ id_prestador: idPrestador }).delete();

    await expect(
      catalog!('servicio').insert({
        nombre_servicio: 'Servicio sin prestador',
        descripcion: 'No deberia poder entrar',
        id_prestador: idPrestador,
        id_categoria: idCategoria.id_categoria,
        estado: 'ACTIVE',
      })
    ).rejects.toThrow();

    // Y con la replica de vuelta, entra otra vez. La restauracion se comprueba
    // por sus efectos, no por el numero de filas de la replica.
    await reemitir(provider!, {
      event: [EventName.ServiceProviderProfileCreated],
      agregado: String(idPrestador),
      ejecutar: true,
    });
    await republicarYConsumir();

    await expect(
      catalog!('servicio').insert({
        nombre_servicio: 'Servicio tras restaurar',
        descripcion: 'Entra porque prestador_ref volvio',
        id_prestador: idPrestador,
        id_categoria: idCategoria.id_categoria,
        estado: 'ACTIVE',
      })
    ).resolves.toBeDefined();
  });
});
