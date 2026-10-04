import amqp from 'amqplib';
import type { Knex } from 'knex';
import { Broker } from '../src/broker';
import { EventConsumer } from '../src/consumer';

jest.mock('amqplib');

const conectar = amqp.connect as jest.MockedFunction<typeof amqp.connect>;

/**
 * Lo que se prueba aqui es el arranque, no el camino feliz.
 *
 * El defecto que motiva estas pruebas: la reconexion colgaba del evento
 * 'close' de una conexion existente, asi que cuando el servicio arrancaba
 * antes que RabbitMQ no habia nada de lo que colgarla. El broker se quedaba
 * `disponible === false` de forma permanente, el relevo del outbox devolvia 0
 * en cada ciclo sin un solo intento, y el servicio parecia sano.
 */

function canalFalso(): unknown {
  return {
    assertExchange: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

function conexionFalsa(): unknown {
  return {
    createConfirmChannel: jest.fn().mockResolvedValue(canalFalso()),
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  };
}

const CONFIG = {
  host: 'broker',
  port: 5672,
  user: 'u',
  password: 'p',
  exchange: 'punto-amigo.events',
  maxRetries: 3,
};

const logger = { info: jest.fn(), error: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
});

test('reintenta en segundo plano cuando el primer intento falla', async () => {
  // Arrange: el broker todavia esta arrancando y rechaza la conexion; en el
  // segundo intento ya responde.
  conectar
    .mockRejectedValueOnce(new Error('connect ECONNREFUSED 172.18.0.6:5672'))
    .mockResolvedValue(conexionFalsa() as Awaited<ReturnType<typeof amqp.connect>>);

  const broker = new Broker(CONFIG, logger);

  // Act: el arranque falla, y el que llama lo registra. Igual que antes.
  await expect(broker.conectar()).rejects.toThrow('ECONNREFUSED');
  expect(broker.disponible).toBe(false);

  // La primera espera del retroceso es de 1 s.
  await new Promise((listo) => setTimeout(listo, 1_400));

  // Assert: la reconexion ocurrio sola, sin que nadie volviera a llamar.
  expect(broker.disponible).toBe(true);
  expect(logger.info).toHaveBeenCalledWith('reconectado al broker', { intento: 1 });

  await broker.cerrar();
}, 10_000);

test('no reintenta despues de cerrar', async () => {
  conectar.mockRejectedValue(new Error('connect ECONNREFUSED'));

  const broker = new Broker(CONFIG, logger);
  await expect(broker.conectar()).rejects.toThrow('ECONNREFUSED');
  await broker.cerrar();

  const intentosAlCerrar = conectar.mock.calls.length;
  await new Promise((listo) => setTimeout(listo, 1_400));

  // Un apagado que deje un bucle de reconexion vivo impide que el proceso
  // termine y deja a Jest avisando de un handle abierto.
  expect(conectar.mock.calls.length).toBe(intentosAlCerrar);
  expect(logger.info).not.toHaveBeenCalledWith('reconectado al broker', expect.anything());
}, 10_000);

test('el consumidor se vuelve a suscribir cuando llega el broker', async () => {
  // Arrange: el broker rechaza el primer intento, como cuando RabbitMQ todavia
  // esta arrancando, y acepta el segundo.
  const canal = {
    assertExchange: jest.fn().mockResolvedValue(undefined),
    assertQueue: jest.fn().mockResolvedValue(undefined),
    bindQueue: jest.fn().mockResolvedValue(undefined),
    prefetch: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockResolvedValue({ consumerTag: 'c1' }),
    close: jest.fn().mockResolvedValue(undefined),
  };
  conectar.mockRejectedValueOnce(new Error('connect ECONNREFUSED')).mockResolvedValue({
    createConfirmChannel: jest.fn().mockResolvedValue(canal),
    on: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  } as unknown as Awaited<ReturnType<typeof amqp.connect>>);

  const broker = new Broker(CONFIG, logger);
  const consumidor = new EventConsumer(
    {} as unknown as Knex,
    broker,
    {
      cola: 'notification-service.avisos',
      patrones: ['#'],
      consumidor: 'notification',
      prefetch: 5,
    },
    logger
  );
  consumidor.on('UserProfileUpdated', async () => undefined);

  // Act: es la secuencia exacta de `main`: conectar falla, iniciar falla, y
  // nadie vuelve a llamar a ninguno de los dos.
  await expect(broker.conectar()).rejects.toThrow('ECONNREFUSED');
  await expect(consumidor.iniciar()).rejects.toThrow('El broker no esta disponible.');
  expect(canal.consume).not.toHaveBeenCalled();

  await new Promise((listo) => setTimeout(listo, 1_400));

  // Assert: la suscripcion llego sola, y una sola vez. Dos `consume` en el
  // mismo canal entregarian cada evento dos veces.
  expect(canal.consume).toHaveBeenCalledTimes(1);

  await broker.cerrar();
}, 10_000);
