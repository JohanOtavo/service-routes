/**
 * El planificador del calculo de estadisticas (A-3).
 *
 * Que demuestra. Que arrancar el calculo no puede tumbar el servicio de auditoria.
 * Es la unica propiedad del planificador que no se ve mirando el codigo: que un fallo
 * se registra y se sigue. Y que hay una vuelta al arrancar, porque sin ella un
 * despliegue recien hecho devuelve series vacias durante un periodo entero, que es
 * exactamente el sintoma que A-3 vino a arreglar.
 *
 * Con dobles, no con MySQL: aqui no hay consulta que probar, hay temporizadores y
 * manejo de errores. Lo que SQL calcula ya lo comprueba `db/tests/estadisticas.int.test.ts`.
 */
import { EstadisticasScheduler } from '../src/infrastructure/scheduling/EstadisticasScheduler';

interface LoggerFalso {
  info: jest.Mock<void, [string, Record<string, unknown>?]>;
  error: jest.Mock<void, [string, Record<string, unknown>?]>;
}

const loggerFalso = (): LoggerFalso => ({
  info: jest.fn() as unknown as LoggerFalso['info'],
  error: jest.fn() as unknown as LoggerFalso['error'],
});

describe('el planificador de estadisticas', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('calcula una vez al arrancar, sin esperar al primer tick', async () => {
    const calcular = jest.fn().mockResolvedValue({ puntos: 6, metricas: 6 });
    const planificador = new EstadisticasScheduler({ ejecutar: calcular }, loggerFalso(), {
      intervaloMs: 3_600_000,
    });

    await planificador.iniciar();
    planificador.detener();

    expect(calcular).toHaveBeenCalledTimes(1);
  });

  it('un fallo del calculo se registra y no se propaga', async () => {
    const calcular = jest.fn().mockRejectedValue(new Error('pa_request no responde'));
    const logger = loggerFalso();
    const planificador = new EstadisticasScheduler({ ejecutar: calcular }, logger, {
      intervaloMs: 3_600_000,
    });

    // Si `iniciar` propagara, esto seria un rechazo y la prueba fallaria aqui. La
    // auditoria tiene que seguir disponible aunque las metricas no se puedan calcular.
    await expect(planificador.iniciar()).resolves.toBeUndefined();
    planificador.detener();

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'fallo el calculo de estadisticas',
      expect.objectContaining({ mensaje: 'pa_request no responde' })
    );
  });

  it('con alArrancar desactivado no calcula hasta que pasa el intervalo', async () => {
    jest.useFakeTimers();
    const calcular = jest.fn().mockResolvedValue({ puntos: 0, metricas: 0 });

    const planificador = new EstadisticasScheduler({ ejecutar: calcular }, loggerFalso(), {
      intervaloMs: 1_000,
      alArrancar: false,
    });

    await planificador.iniciar();
    expect(calcular).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1_000);
    expect(calcular).toHaveBeenCalledTimes(1);

    planificador.detener();
  });

  it('detener corta los ticks', async () => {
    jest.useFakeTimers();
    const calcular = jest.fn().mockResolvedValue({ puntos: 0, metricas: 0 });

    const planificador = new EstadisticasScheduler({ ejecutar: calcular }, loggerFalso(), {
      intervaloMs: 1_000,
    });

    await planificador.iniciar();
    expect(calcular).toHaveBeenCalledTimes(1);

    planificador.detener();
    jest.advanceTimersByTime(10_000);
    expect(calcular).toHaveBeenCalledTimes(1);

    // Detener dos veces no debe romper: `cerrar` puede recibir SIGTERM y SIGINT.
    expect(() => planificador.detener()).not.toThrow();
  });
});
