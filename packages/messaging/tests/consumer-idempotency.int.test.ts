/**
 * Idempotencia del consumidor, contra MySQL real.
 *
 * Existe por un fallo concreto: la primera version decidia "ya procesado"
 * leyendo el numero de filas que devolvia `onConflict().ignore()`. En MySQL eso
 * se compila a `INSERT IGNORE` y Knex devuelve `[insertId]`, que en una tabla
 * con clave primaria compuesta y sin autoincremento vale 0 SIEMPRE. Resultado:
 * ningun manejador llegaba a ejecutarse, la marca quedaba escrita y el mensaje
 * se confirmaba. Nada fallaba y nada pasaba.
 *
 * Una prueba con un doble en memoria no lo habria visto, porque el defecto esta
 * en lo que el motor devuelve. Por eso esta va contra MySQL de verdad.
 */
import knexLib, { type Knex } from 'knex';
import { EventConsumer } from '../src/consumer';
import type { Broker } from '../src/broker';

const CONSUMIDOR = 'prueba-idempotencia';

let knex: Knex;
let disponible = false;
let motivoNoDisponible = '';

beforeAll(async () => {
  const password = process.env['DB_REQUEST_PASSWORD'] ?? '';
  if (password === '') {
    motivoNoDisponible = 'falta DB_REQUEST_PASSWORD en el entorno';
    return;
  }

  try {
    knex = knexLib({
      client: 'mysql2',
      connection: {
        host: process.env['MYSQL_HOST'] ?? '127.0.0.1',
        port: Number(process.env['MYSQL_PORT'] ?? 3306),
        user: process.env['DB_REQUEST_USER'] ?? 'pa_request_svc',
        password,
        database: 'pa_request',
        timezone: 'Z',
      },
    });
    await knex.raw('SELECT 1');
    disponible = true;
  } catch (error) {
    motivoNoDisponible = error instanceof Error ? error.message : String(error);
  }
});

afterAll(async () => {
  if (!disponible) return;
  await knex('processed_event').where({ consumer: CONSUMIDOR }).delete();
  await knex.destroy();
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

/**
 * Broker falso: solo lo justo para que `iniciar()` entregue mensajes.
 *
 * No se finge la base de datos a proposito. El defecto que esta prueba vigila
 * esta en lo que MySQL devuelve al insertar, asi que la base tiene que ser real
 * o la prueba no vale para nada.
 */
function brokerFalso(): {
  broker: Broker;
  confirmados: number[];
  rechazados: number[];
  entregar: (m: unknown) => void;
} {
  let entregar: ((mensaje: unknown) => void) | null = null;
  const confirmados: number[] = [];
  const rechazados: number[] = [];

  const canal = {
    prefetch: async (): Promise<void> => undefined,
    consume: async (_cola: string, cb: (m: unknown) => void): Promise<void> => {
      entregar = cb;
    },
    ack: (m: { fields: { deliveryTag: number } }): void => {
      confirmados.push(m.fields.deliveryTag);
    },
    nack: (m: { fields: { deliveryTag: number } }): void => {
      rechazados.push(m.fields.deliveryTag);
    },
  };

  const broker = {
    declararCola: async (): Promise<void> => undefined,
    canalActivo: canal,
  } as unknown as Broker;

  return { broker, confirmados, rechazados, entregar: (m: unknown) => entregar?.(m) };
}

let etiqueta = 0;

function mensaje(eventId: string, eventName: string, payload: Record<string, unknown>): unknown {
  etiqueta += 1;
  const sobre = {
    eventId,
    eventName,
    eventVersion: 1,
    aggregateType: 'Prueba',
    aggregateId: '1',
    occurredAt: new Date().toISOString(),
    correlationId: '11111111-1111-4111-8111-111111111111',
    producer: 'prueba',
    payload,
  };

  return {
    content: Buffer.from(JSON.stringify(sobre), 'utf8'),
    fields: { deliveryTag: etiqueta, redelivered: false, exchange: '', routingKey: '' },
    properties: { headers: {} },
  };
}

/**
 * Espera a que el consumidor termine: `consume` no devuelve una promesa.
 *
 * No basta con dormir un tiempo fijo. `consume` entrega el mensaje en un
 * callback y el manejador escribe en MySQL, asi que cuanto tarda depende de
 * cuantos conectores haya encima. Con las diecisiete suites corriendo a la vez,
 * 150 ms se quedaban cortos y esta prueba fallaba de forma intermitente sin que
 * hubiera nada que corregir en el consumidor. Preguntar cada cuanto hasta que la
 * condicion se cumple hace que dependa del trabajo hecho y no del reloj, y el
 * techo sigue existiendo: si nunca llega, la prueba falla con un mensaje util en
 * lugar de colarse.
 */
const esperarA = async (condicion: () => boolean, techoMs = 5000): Promise<void> => {
  const limite = Date.now() + techoMs;
  while (!condicion()) {
    if (Date.now() > limite) return;
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('idempotencia del consumidor de eventos', () => {
  it('la PRIMERA entrega ejecuta el manejador', async () => {
    if (saltar()) return;

    const { broker, confirmados, entregar } = brokerFalso();
    const aplicados: string[] = [];

    const consumidor = new EventConsumer(
      knex,
      broker,
      { cola: 'prueba', patrones: ['prueba.#'], consumidor: CONSUMIDOR, prefetch: 1 },
      { info: () => undefined, error: () => undefined }
    );
    consumidor.on('Prueba', async (sobre) => {
      aplicados.push(String(sobre.payload['marca']));
    });

    await consumidor.iniciar();
    entregar(mensaje('aaaaaaaa-1111-4111-8111-111111111111', 'Prueba', { marca: 'primera' }));
    await esperarA(() => confirmados.length === 1);

    // Esto es lo que fallaba: el manejador no se ejecutaba NUNCA, y aun asi el
    // mensaje se confirmaba y la marca quedaba escrita.
    expect(aplicados).toEqual(['primera']);
    expect(confirmados).toHaveLength(1);

    const marca = await knex('processed_event')
      .where({ consumer: CONSUMIDOR, event_id: 'aaaaaaaa-1111-4111-8111-111111111111' })
      .first();
    expect(marca).toBeDefined();
  });

  it('la SEGUNDA entrega del mismo evento no lo vuelve a aplicar', async () => {
    if (saltar()) return;

    const { broker, confirmados, entregar } = brokerFalso();
    const aplicados: string[] = [];

    const consumidor = new EventConsumer(
      knex,
      broker,
      { cola: 'prueba', patrones: ['prueba.#'], consumidor: CONSUMIDOR, prefetch: 1 },
      { info: () => undefined, error: () => undefined }
    );
    consumidor.on('Prueba', async () => {
      aplicados.push('aplicado');
    });

    await consumidor.iniciar();
    const id = 'bbbbbbbb-2222-4222-8222-222222222222';

    entregar(mensaje(id, 'Prueba', { marca: 'uno' }));
    await esperarA(() => confirmados.length === 1);
    entregar(mensaje(id, 'Prueba', { marca: 'dos' }));
    await esperarA(() => confirmados.length === 2);

    expect(aplicados).toEqual(['aplicado']);
    // Las dos se confirman: la repetida no es un error, es el broker haciendo
    // su trabajo de entregar al menos una vez.
    expect(confirmados).toHaveLength(2);
  });

  /**
   * Si el efecto falla, la marca tiene que irse con el. Sobrevivir dejaria el
   * evento marcado como aplicado sin haberlo aplicado, y el reintento lo
   * descartaria: la perdida silenciosa que la tabla existe para evitar.
   */
  it('si el manejador falla, la marca se revierte y el evento se deriva', async () => {
    if (saltar()) return;

    const { broker, rechazados, entregar } = brokerFalso();

    const consumidor = new EventConsumer(
      knex,
      broker,
      { cola: 'prueba', patrones: ['prueba.#'], consumidor: CONSUMIDOR, prefetch: 1 },
      { info: () => undefined, error: () => undefined }
    );
    consumidor.on('Prueba', async () => {
      throw new Error('el efecto no se pudo aplicar');
    });

    await consumidor.iniciar();
    const id = 'cccccccc-3333-4333-8333-333333333333';
    entregar(mensaje(id, 'Prueba', {}));
    await esperarA(() => rechazados.length === 1);

    expect(rechazados).toHaveLength(1);
    const marca = await knex('processed_event')
      .where({ consumer: CONSUMIDOR, event_id: id })
      .first();
    expect(marca).toBeUndefined();
  });
});
