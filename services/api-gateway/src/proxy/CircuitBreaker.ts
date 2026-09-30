/**
 * Cortacircuitos por servicio aguas abajo.
 *
 * SRS RNF44 lo exige junto al tiempo de espera y los reintentos. Su papel no es
 * evitar el error —ese ya ocurrio— sino dejar de propagarlo: cuando un servicio
 * esta caido, seguir enviandole peticiones ata dos segundos de espera por cada
 * una, agota el pool de conexiones del gateway y termina arrastrando a los
 * servicios que si funcionan.
 *
 * Con el circuito abierto la respuesta es inmediata, y el gateway conserva
 * capacidad para atender todo lo demas (SRS RNF36).
 */
export type EstadoCircuito = 'CERRADO' | 'ABIERTO' | 'SEMIABIERTO';

export interface CircuitBreakerConfig {
  /** Fallos consecutivos que abren el circuito. */
  umbralFallos: number;
  /** Tiempo abierto antes de permitir una peticion de prueba, en ms. */
  esperaMs: number;
  /** Exitos seguidos en semiabierto que lo vuelven a cerrar. */
  exitosParaCerrar: number;
}

export const CONFIG_POR_DEFECTO: CircuitBreakerConfig = {
  umbralFallos: 5,
  esperaMs: 15_000,
  exitosParaCerrar: 2,
};

interface EstadoServicio {
  estado: EstadoCircuito;
  fallosConsecutivos: number;
  exitosConsecutivos: number;
  abiertoHasta: number;
}

export class CircuitBreaker {
  private readonly servicios = new Map<string, EstadoServicio>();

  constructor(
    private readonly config: CircuitBreakerConfig = CONFIG_POR_DEFECTO,
    /** Reloj inyectable: sin el, probar la reapertura obligaria a esperar. */
    private readonly ahora: () => number = () => Date.now()
  ) {}

  private estadoDe(servicio: string): EstadoServicio {
    let estado = this.servicios.get(servicio);
    if (estado === undefined) {
      estado = { estado: 'CERRADO', fallosConsecutivos: 0, exitosConsecutivos: 0, abiertoHasta: 0 };
      this.servicios.set(servicio, estado);
    }
    return estado;
  }

  /**
   * Indica si se puede intentar la llamada.
   *
   * Pasado el tiempo de espera, el circuito pasa a semiabierto y deja pasar
   * peticiones de prueba. Reabrir de golpe enviaria toda la carga acumulada a un
   * servicio que acaba de levantarse y volveria a tumbarlo.
   */
  permite(servicio: string): boolean {
    const s = this.estadoDe(servicio);

    if (s.estado === 'ABIERTO') {
      if (this.ahora() >= s.abiertoHasta) {
        s.estado = 'SEMIABIERTO';
        s.exitosConsecutivos = 0;
        return true;
      }
      return false;
    }

    return true;
  }

  registrarExito(servicio: string): void {
    const s = this.estadoDe(servicio);
    s.fallosConsecutivos = 0;

    if (s.estado === 'SEMIABIERTO') {
      s.exitosConsecutivos += 1;
      if (s.exitosConsecutivos >= this.config.exitosParaCerrar) {
        s.estado = 'CERRADO';
        s.exitosConsecutivos = 0;
      }
      return;
    }

    s.estado = 'CERRADO';
  }

  /**
   * Un fallo en semiabierto reabre de inmediato, sin volver a contar hasta el
   * umbral: el servicio acaba de demostrar que sigue sin estar listo.
   */
  registrarFallo(servicio: string): void {
    const s = this.estadoDe(servicio);
    s.fallosConsecutivos += 1;
    s.exitosConsecutivos = 0;

    if (s.estado === 'SEMIABIERTO' || s.fallosConsecutivos >= this.config.umbralFallos) {
      s.estado = 'ABIERTO';
      s.abiertoHasta = this.ahora() + this.config.esperaMs;
    }
  }

  estado(servicio: string): EstadoCircuito {
    return this.estadoDe(servicio).estado;
  }

  /** Instantanea para el endpoint de estado agregado (SRS-GW-08). */
  resumen(): Record<string, EstadoCircuito> {
    const salida: Record<string, EstadoCircuito> = {};
    for (const [servicio, estado] of this.servicios) salida[servicio] = estado.estado;
    return salida;
  }
}
