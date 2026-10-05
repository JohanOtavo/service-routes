/**
 * Planificador del calculo de estadisticas (A-3, RF113).
 *
 * SRS: RF113. Ver `CalculateStatistics` para el calculo y `ADR-005` para el acceso a
 * los datos de origen.
 *
 * Tres decisiones de arranque que conviene explicar:
 *
 * 1. Corre una vez al levantar y luego en cada tick. Sin esa primera vuelta, un
 *    servicio recien desplegado devolveria series vacias hasta dentro de un periodo,
 *    y el sintoma es indistinguible del que acabamos de arreglar.
 * 2. El error de una vuelta no se propaga al proceso. El calculo depende de tablas
 *    que son de otros servicios; que una de ellas no responda no puede tumbar el
 *    servicio de auditoria. Se registra y se reintenta en el siguiente tick.
 * 3. `setInterval` va con `.unref()` para que el tick pendiente no mantenga vivo el
 *    proceso al apagar: sin eso, un `docker stop` esperaria al temporizador y el
 *    contenedor tardaria en morir.
 *
 * El solape tambien esta resuelto por construccion: cada vuelta mide lo que ve y
 * escribe por upsert, asi que dos vueltas simultaneas del mismo tick convergen al
 * mismo estado.
 */

export interface EstadisticasSchedulerOptions {
  /** Milisegundos entre calculos. */
  intervaloMs: number;
  /**
   * Ejecutar una vuelta al arrancar. Se desactiva en los tests para no escribir en
   * la base sin que nadie lo haya pedido.
   */
  alArrancar?: boolean;
}

interface LoggerLike {
  info(mensaje: string, contexto?: Record<string, unknown>): void;
  error(mensaje: string, contexto?: Record<string, unknown>): void;
}

export interface CalculateStatisticsLike {
  ejecutar(fecha?: string): Promise<{ puntos: number; metricas: number }>;
}

export class EstadisticasScheduler {
  private temporizador: NodeJS.Timeout | undefined;

  constructor(
    private readonly calculo: CalculateStatisticsLike,
    private readonly logger: LoggerLike,
    private readonly opciones: EstadisticasSchedulerOptions
  ) {}

  /**
   * Arranca el planificador y devuelve.
   *
   * No espera a la primera vuelta: el arranque del servicio de auditoria no depende
   * de que las metricas salgan. Un fallo aqui se registra y el servicio sigue dando
   * servicio, que es lo que evita que el modulo de reportes pueda tumbar la
   * plataforma.
   */
  async iniciar(): Promise<void> {
    if (this.opciones.alArrancar !== false) {
      await this.vuelta('arranque');
    }

    this.temporizador = setInterval(() => {
      void this.vuelta('periodico');
    }, this.opciones.intervaloMs);
    this.temporizador.unref?.();
  }

  /** Detiene el planificador. Idempotente. */
  detener(): void {
    if (this.temporizador !== undefined) {
      clearInterval(this.temporizador);
      this.temporizador = undefined;
    }
  }

  /**
   * Una vuelta del calculo.
   *
   * Es publica para que los tests puedan forzarla sin esperar al temporizador, que es
   * la unica forma de probar esto sin dormir.
   */
  async vuelta(origen: string): Promise<void> {
    const inicio = Date.now();
    try {
      const resultado = await this.calculo.ejecutar();
      this.logger.info('estadisticas calculadas', {
        origen,
        puntos: resultado.puntos,
        metricas: resultado.metricas,
        ms: Date.now() - inicio,
      });
    } catch (error) {
      this.logger.error('fallo el calculo de estadisticas', {
        origen,
        mensaje: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
