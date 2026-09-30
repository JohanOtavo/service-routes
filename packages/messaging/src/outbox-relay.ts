import type { Knex } from 'knex';
import { routingKey } from '@punto-amigo/shared';
import type { Broker, Logger } from './broker';

export interface OutboxRelayConfig {
  /** Cada cuanto se barre la tabla, en ms. */
  intervaloMs: number;
  /** Eventos por barrido. Acota la memoria y el tiempo de cada ciclo. */
  lote: number;
  /** Intentos antes de dejar de reintentar un evento concreto. */
  maxIntentos: number;
  /** Contexto para la clave de enrutado: iam, catalog, request... */
  contexto: string;
}

interface FilaOutbox {
  id_outbox: number;
  event_id: string;
  event_name: string;
  event_version: number;
  aggregate_type: string;
  aggregate_id: string;
  correlation_id: string;
  causation_id: string | null;
  payload: unknown;
  occurred_at: Date;
  attempts: number;
}

/**
 * Relevo del outbox: lleva al broker lo que la transaccion de negocio dejo
 * escrito.
 *
 * Es la segunda mitad del patron. El caso de uso escribe el evento en la misma
 * transaccion que el cambio, de modo que no puede haber uno sin el otro; este
 * proceso lo publica despues, con reintentos, de modo que un broker caido
 * retrasa la entrega pero no la pierde (SRS RNF37, RNF46).
 *
 * La entrega es "al menos una vez" a proposito: si el broker confirma y el
 * proceso muere antes de marcar la fila, el evento se reenvia. Eso es aceptable
 * porque todo consumidor es idempotente (SRS RF95); lo contrario —perder un
 * evento— no tendria arreglo.
 */
export class OutboxRelay {
  private temporizador: NodeJS.Timeout | null = null;
  private ejecutando = false;
  private detenido = false;

  constructor(
    private readonly knex: Knex,
    private readonly broker: Broker,
    private readonly config: OutboxRelayConfig,
    private readonly logger: Logger
  ) {}

  iniciar(): void {
    if (this.temporizador !== null) return;
    this.detenido = false;
    // unref: un proceso que solo tenga este temporizador pendiente debe poder
    // terminar en lugar de quedarse vivo por el.
    this.temporizador = setInterval(() => void this.ciclo(), this.config.intervaloMs);
    this.temporizador.unref();
    this.logger.info('relevo del outbox iniciado', { intervaloMs: this.config.intervaloMs });
  }

  async detener(): Promise<void> {
    this.detenido = true;
    if (this.temporizador !== null) {
      clearInterval(this.temporizador);
      this.temporizador = null;
    }
    // Espera a que termine el ciclo en curso: cortarlo a la mitad dejaria
    // eventos publicados sin marcar, que luego se reenviarian.
    while (this.ejecutando) await new Promise((r) => setTimeout(r, 50));
  }

  /** Un barrido. Publico para poder invocarlo desde las pruebas sin esperar. */
  async ciclo(): Promise<number> {
    // Solapar ciclos publicaria dos veces las mismas filas.
    if (this.ejecutando || this.detenido) return 0;
    if (!this.broker.disponible) return 0;

    this.ejecutando = true;
    let publicados = 0;

    try {
      const pendientes = await this.knex<FilaOutbox>('outbox_event')
        .whereNull('published_at')
        .where('attempts', '<', this.config.maxIntentos)
        .orderBy('occurred_at', 'asc')
        .limit(this.config.lote);

      for (const fila of pendientes) {
        if (this.detenido) break;

        try {
          const clave = routingKey(this.config.contexto, fila.aggregate_type, fila.event_name);

          const sobre = {
            eventId: fila.event_id,
            eventName: fila.event_name,
            eventVersion: fila.event_version,
            aggregateType: fila.aggregate_type,
            aggregateId: fila.aggregate_id,
            occurredAt: fila.occurred_at.toISOString(),
            correlationId: fila.correlation_id,
            ...(fila.causation_id === null ? {} : { causationId: fila.causation_id }),
            producer: this.config.contexto,
            // MySQL devuelve JSON ya interpretado; si llegara como texto se
            // reinterpreta para no publicar una cadena dentro de otra.
            payload: typeof fila.payload === 'string' ? JSON.parse(fila.payload) : fila.payload,
          };

          await this.broker.publicar(clave, Buffer.from(JSON.stringify(sobre)), fila.event_id);

          await this.knex('outbox_event')
            .where({ id_outbox: fila.id_outbox })
            .update({ published_at: new Date() });

          publicados += 1;
        } catch (error) {
          const mensaje = error instanceof Error ? error.message : String(error);

          await this.knex('outbox_event')
            .where({ id_outbox: fila.id_outbox })
            .increment('attempts', 1)
            .update({ last_error: mensaje.slice(0, 500) });

          this.logger.error('no se pudo publicar un evento', {
            eventId: fila.event_id,
            eventName: fila.event_name,
            intentos: fila.attempts + 1,
            mensaje,
          });

          // Si el broker se cayo, el resto del lote fallara igual: se corta y
          // se reintenta en el siguiente ciclo.
          if (!this.broker.disponible) break;
        }
      }
    } catch (error) {
      this.logger.error('fallo el ciclo del relevo', {
        mensaje: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.ejecutando = false;
    }

    return publicados;
  }

  /**
   * Eventos que agotaron sus intentos.
   *
   * No se reintentan mas, pero tampoco desaparecen: quedan visibles para que
   * alguien los revise. Un contador en aumento aqui significa que algo esta
   * roto de forma sistematica, no puntual (SRS RNF82).
   */
  async atascados(): Promise<number> {
    const [fila] = await this.knex('outbox_event')
      .whereNull('published_at')
      .where('attempts', '>=', this.config.maxIntentos)
      .count<{ n: number }[]>({ n: '*' });

    return Number(fila?.n ?? 0);
  }
}
