import { randomUUID } from 'node:crypto';
import { buildEnvelope } from '@punto-amigo/shared';
/** Evento a publicar. Lo declara el kit para que cada servicio no lo repita. */
export interface EventoAPublicar {
  eventName: string;
  aggregateType: string;
  aggregateId: string | number;
  payload: Record<string, unknown>;
}

export interface IEventPublisher {
  enqueue(evento: EventoAPublicar, correlationId: string): Promise<void>;
}
import { requireTransaction } from './transaction';

/**
 * Publicador de eventos por outbox.
 *
 * No habla con el broker. Escribe el evento en la tabla `outbox_event` dentro de
 * la transaccion del cambio de negocio, y un proceso aparte lo envia despues.
 *
 * Esa separacion es lo que impide el estado "la escritura se confirmo pero el
 * evento se perdio" (SRS RNF37, RNF46). Publicar directamente al broker desde
 * aqui reintroduciria el problema: si el envio fallara tras confirmar la
 * transaccion, el usuario existiria y su bienvenida no llegaria nunca.
 *
 * `requireTransaction` falla si no hay transaccion abierta. Es deliberado:
 * perder eventos en silencio es peor que un arranque ruidoso.
 */
export class OutboxEventPublisher implements IEventPublisher {
  constructor(private readonly producer: string) {}

  async enqueue(evento: EventoAPublicar, correlationId: string): Promise<void> {
    const trx = requireTransaction();

    const sobre = buildEnvelope({
      eventId: randomUUID(),
      eventName: evento.eventName as never,
      aggregateType: evento.aggregateType,
      aggregateId: evento.aggregateId,
      correlationId,
      producer: this.producer,
      payload: evento.payload,
      occurredAt: new Date(),
    });

    await trx('outbox_event').insert({
      event_id: sobre.eventId,
      event_name: sobre.eventName,
      event_version: sobre.eventVersion,
      aggregate_type: sobre.aggregateType,
      aggregate_id: sobre.aggregateId,
      correlation_id: sobre.correlationId,
      causation_id: sobre.causationId ?? null,
      payload: JSON.stringify(sobre.payload),
      occurred_at: new Date(sobre.occurredAt),
    });
  }
}
