/**
 * El calculo de `statistics_snapshot` (A-3).
 *
 * La tabla existia, este servicio la leia, y nadie la escribia: los informes de
 * serie devolvian siempre vacio. Esto prueba el proceso que la puebla.
 *
 * Sin MySQL a proposito: lo que hay que comprobar es la ARITMETICA y la forma
 * de los puntos —que el TOTAL del dia sea la suma de sus dimensiones, que un
 * dia sin datos no escriba una fila, que el rango sea el pedido—. Que el UPSERT
 * no duplique es cosa de la clave unica, y eso se prueba contra el motor en
 * `admin-http.int.test.ts`.
 */
import {
  CalculateStatisticsUseCase,
  METRICA_AUDITORIA,
  METRICA_MODERACION,
} from '../src/application/use-cases/CalculateStatistics';
import type { ConteoAgrupado, IStatisticsSourceRepository, PuntoCalculado } from '../src/domain';

const AHORA = new Date('2026-10-03T12:00:00.000Z');

class FuenteFalsa implements IStatisticsSourceRepository {
  public rangos: { desde: Date; hasta: Date }[] = [];

  constructor(
    private readonly auditoria: ConteoAgrupado[],
    private readonly moderacion: ConteoAgrupado[]
  ) {}

  async conteoAuditoriaPorDiaYResultado(desde: Date, hasta: Date): Promise<ConteoAgrupado[]> {
    this.rangos.push({ desde, hasta });
    return this.auditoria;
  }

  async conteoModeracionPorDiaYTipo(desde: Date, hasta: Date): Promise<ConteoAgrupado[]> {
    this.rangos.push({ desde, hasta });
    return this.moderacion;
  }
}

const construir = (
  auditoria: ConteoAgrupado[],
  moderacion: ConteoAgrupado[]
): {
  caso: CalculateStatisticsUseCase;
  escritos: PuntoCalculado[];
  fuente: FuenteFalsa;
} => {
  const fuente = new FuenteFalsa(auditoria, moderacion);
  const escritos: PuntoCalculado[] = [];
  const caso = new CalculateStatisticsUseCase(
    {
      serie: jest.fn(),
      metricas: jest.fn(),
      registrar: async (puntos: readonly PuntoCalculado[]): Promise<number> => {
        escritos.push(...puntos);
        return puntos.length;
      },
    },
    fuente,
    { now: () => AHORA }
  );
  return { caso, escritos, fuente };
};

describe('calculo de estadisticas', () => {
  it('escribe un punto por dimension y uno con el total del dia', async () => {
    const { caso, escritos } = construir(
      [
        { fecha: '2026-10-02', dimension: 'EXITO', valor: 7 },
        { fecha: '2026-10-02', dimension: 'FALLO', valor: 3 },
      ],
      []
    );

    const cuantos = await caso.recalcular({ dias: 1 });

    expect(cuantos).toBe(3);
    expect(escritos).toEqual(
      expect.arrayContaining([
        { fecha: '2026-10-02', metrica: METRICA_AUDITORIA, dimension: 'EXITO', valor: 7 },
        { fecha: '2026-10-02', metrica: METRICA_AUDITORIA, dimension: 'FALLO', valor: 3 },
        { fecha: '2026-10-02', metrica: METRICA_AUDITORIA, dimension: 'TOTAL', valor: 10 },
      ])
    );
  });

  it('calcula el total por dia y no mezcla dos dias distintos', async () => {
    const { caso, escritos } = construir(
      [
        { fecha: '2026-10-01', dimension: 'EXITO', valor: 2 },
        { fecha: '2026-10-02', dimension: 'EXITO', valor: 5 },
        { fecha: '2026-10-02', dimension: 'DENEGADO', valor: 1 },
      ],
      []
    );

    await caso.recalcular({ dias: 3 });

    const totales = escritos.filter((p) => p.dimension === 'TOTAL');
    expect(totales).toEqual([
      { fecha: '2026-10-01', metrica: METRICA_AUDITORIA, dimension: 'TOTAL', valor: 2 },
      { fecha: '2026-10-02', metrica: METRICA_AUDITORIA, dimension: 'TOTAL', valor: 6 },
    ]);
  });

  it('separa las dos metricas en lugar de sumarlas', async () => {
    const { caso, escritos } = construir(
      [{ fecha: '2026-10-02', dimension: 'EXITO', valor: 4 }],
      [{ fecha: '2026-10-02', dimension: 'SERVICIO', valor: 2 }]
    );

    await caso.recalcular({ dias: 1 });

    expect(escritos.filter((p) => p.metrica === METRICA_AUDITORIA)).toHaveLength(2);
    expect(escritos.filter((p) => p.metrica === METRICA_MODERACION)).toHaveLength(2);
    expect(
      escritos.find((p) => p.metrica === METRICA_MODERACION && p.dimension === 'TOTAL')?.valor
    ).toBe(2);
  });

  it('no escribe nada cuando no hubo actividad', async () => {
    const { caso, escritos } = construir([], []);

    expect(await caso.recalcular({ dias: 7 })).toBe(0);
    expect(escritos).toEqual([]);
  });

  it('pide a la fuente el rango de dias que se le indica, cerrado por arriba en hoy', async () => {
    const { caso, fuente } = construir([], []);

    await caso.recalcular({ dias: 2 });

    /**
     * El rango se mide en dias completos, no en instantes.
     *
     * Con `dias: 2` y hoy 3/10, la ventana va del 2/10 a las 00:00 al 3/10 a
     * las 23:59:59.999. Tomar `now()` como tope dejaria fuera lo que ocurra en
     * lo que queda del dia, y el recalculo de mañana ya no lo recogeria si la
     * ventana se hubiera movido mas alla de ese dia.
     */
    expect(fuente.rangos).not.toHaveLength(0);
    for (const rango of fuente.rangos) {
      expect(rango.desde.toISOString()).toBe('2026-10-02T00:00:00.000Z');
      expect(rango.hasta.toISOString()).toBe('2026-10-03T23:59:59.999Z');
    }
  });

  it('rechaza un numero de dias que no sirve para nada', async () => {
    const { caso } = construir([], []);

    await expect(caso.recalcular({ dias: 0 })).rejects.toThrow();
    await expect(caso.recalcular({ dias: -1 })).rejects.toThrow();
  });
});
