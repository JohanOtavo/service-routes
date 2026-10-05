/**
 * El caso de uso que puebla `statistics_snapshot` (A-3).
 *
 * Que demuestra. Que el caso de uso no tiene opinion sobre el SQL: solo recorre el
 * catalogo, junta los puntos y los entrega al repositorio. Y las dos decisiones suyas
 * que si tienen riesgo de reloj: la fecha por defecto y el fallo de una metrica
 * desconocida.
 *
 * Con dobles. Lo que MySQL hace al calcular esta en
 * `db/tests/estadisticas.int.test.ts`; aqui lo que se decide antes de tocar la base.
 */
import { AppError } from '@punto-amigo/shared';

import {
  CATALOGO_METRICAS,
  CalculateStatistics,
  buscarMetrica,
  exigirMetrica,
} from '../src/application/use-cases/CalculateStatistics';
import type { PuntoCalculado } from '../src/domain';

interface CalculadoraFalsa {
  calcular: jest.Mock<Promise<PuntoCalculado[]>, [string, string]>;
}

interface SnapshotFalso {
  guardar: jest.Mock<Promise<number>, [string, readonly PuntoCalculado[], Date]>;
}

function dobles(): { calculadora: CalculadoraFalsa; snapshots: SnapshotFalso } {
  return {
    calculadora: {
      calcular: jest.fn(async (metrica: string) => [
        { metrica, dimension: 'TOTAL', valor: 1 },
      ]) as unknown as CalculadoraFalsa['calcular'],
    },
    snapshots: {
      guardar: jest.fn(async () => 1) as unknown as SnapshotFalso['guardar'],
    },
  };
}

const caso = (calculadora: CalculadoraFalsa, snapshots: SnapshotFalso): CalculateStatistics =>
  new CalculateStatistics({ calcular: calculadora.calcular }, { guardar: snapshots.guardar });

describe('el catalogo de metricas', () => {
  it('cada metrica declara su formula, su granularidad y de quien depende', () => {
    // Sin esto, el catalogo podria crecer anadiendo un nombre sin explicar de donde
    // sale el numero, que es justo lo que hace imposible auditar un reporte.
    for (const definicion of CATALOGO_METRICAS) {
      expect(definicion.descripcion.length).toBeGreaterThan(10);
      expect(definicion.formula.length).toBeGreaterThan(5);
      expect(['diaria', 'instantanea']).toContain(definicion.granularidad);
      expect(definicion.requiere.length).toBeGreaterThan(0);
    }
  });

  it('exigir una metrica que no existe dice cuales hay', () => {
    expect(() => exigirMetrica('no_existe')).toThrow(AppError);
    // El mensaje lista el catalogo porque quien recibe el error es una persona
    // preguntandose por que una metrica no se guarda, no un log para maquinas.
    expect(() => exigirMetrica('no_existe')).toThrow(/necesidades_publicadas/);
  });

  it('buscar devuelve undefined en vez de lanzar', () => {
    expect(buscarMetrica('tasa_cobertura')?.granularidad).toBe('instantanea');
    expect(buscarMetrica('no_existe')).toBeUndefined();
  });
});

describe('el calculo de estadisticas', () => {
  it('recorre todo el catalogo y guarda los puntos juntos', async () => {
    const { calculadora, snapshots } = dobles();

    const resultado = await caso(calculadora, snapshots).ejecutar('2026-03-15');

    expect(calculadora.calcular).toHaveBeenCalledTimes(CATALOGO_METRICAS.length);
    expect(snapshots.guardar).toHaveBeenCalledTimes(1);

    const [fecha, puntos] = snapshots.guardar.mock.calls[0];
    expect(fecha).toBe('2026-03-15');
    expect(puntos).toHaveLength(CATALOGO_METRICAS.length);
    expect(resultado).toEqual({ puntos: 1, metricas: CATALOGO_METRICAS.length });
  });

  it('usa la fecha que le pasan, sin ajustarla', async () => {
    const { calculadora, snapshots } = dobles();

    await caso(calculadora, snapshots).ejecutar('2026-03-15');

    // Es la fecha la que va al indice unico de la tabla. Si el caso de uso la
    // cambiara, la clave del upsert dejaria de coincidir con la de la consulta.
    for (const [, dia] of calculadora.calcular.mock.calls) {
      expect(dia).toBe('2026-03-15');
    }
  });

  it('sin fecha usa hoy en hora local, no en UTC', async () => {
    const { calculadora, snapshots } = dobles();

    await caso(calculadora, snapshots).ejecutar();

    const puntos = snapshots.guardar.mock.calls[0][1];
    const esperada = (() => {
      const ahora = new Date();
      return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(
        ahora.getDate()
      ).padStart(2, '0')}`;
    })();

    // Cerca de medianoche, `toISOString()` devuelve el dia siguiente y el reporte de
    // "hoy" aparece manana. La fecha local es la del servidor de base de datos.
    expect(puntos).toBeDefined();
    expect(snapshots.guardar.mock.calls[0][0]).toBe(esperada);
  });

  it('guardar devuelve cuantas filas quedaron, no cuantas metricas hay', async () => {
    const { calculadora, snapshots } = dobles();
    snapshots.guardar.mockResolvedValue(9);

    const resultado = await caso(calculadora, snapshots).ejecutar('2026-03-15');

    // Son magnitudes distintas: una metrica con desglose deja varias filas.
    expect(resultado.puntos).toBe(9);
    expect(resultado.metricas).toBe(CATALOGO_METRICAS.length);
  });
});
