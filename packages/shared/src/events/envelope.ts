/**
 * Sobre de los eventos de dominio.
 *
 * Es el unico contrato que comparten los ocho servicios, y por eso vive aqui:
 * si cada uno lo declarara por su cuenta, divergirian en cuanto alguien anadiera
 * un campo.
 *
 * SRS: seccion 3.6 de srs-microservices.md, RNF78 (identificador de correlacion),
 * RF95 (el consumidor descarta duplicados por eventId).
 */
import { z } from 'zod';

/** Nombres de evento publicados por el sistema (02-domain/domain-events.md). */
export const EventName = {
  // Identidad
  UserRegistered: 'UserRegistered',
  UserAuthenticated: 'UserAuthenticated',
  UserRoleAssigned: 'UserRoleAssigned',
  UserProfileUpdated: 'UserProfileUpdated',
  UserAccountSuspended: 'UserAccountSuspended',
  // Prestadores
  ServiceProviderProfileCreated: 'ServiceProviderProfileCreated',
  ServiceProviderProfileValidated: 'ServiceProviderProfileValidated',
  /**
   * Datos del perfil cambiados por su dueno.
   *
   * NO esta en la lista de eventos del SRS; lo anade la implementacion porque
   * sin el, `pa_catalog.prestador_ref` conserva el nombre y la especialidad
   * antiguos para siempre, y el catalogo publica datos que ya no son ciertos.
   * `ProviderStatusChanged` no sirve: lleva estado, no datos del perfil.
   * Pendiente de reflejarlo en el SRS.
   */
  ServiceProviderProfileUpdated: 'ServiceProviderProfileUpdated',
  ProviderStatusChanged: 'ProviderStatusChanged',
  // Catalogo
  ServicePublished: 'ServicePublished',
  ServiceUpdated: 'ServiceUpdated',
  ServiceDeactivated: 'ServiceDeactivated',
  CategoryCreated: 'CategoryCreated',
  CategoryUpdated: 'CategoryUpdated',
  // Demanda
  NeedPublished: 'NeedPublished',
  NeedClosed: 'NeedClosed',
  NeedReopened: 'NeedReopened',
  ProposalSubmitted: 'ProposalSubmitted',
  ProposalAwarded: 'ProposalAwarded',
  ProposalDiscarded: 'ProposalDiscarded',
  // Contrataciones
  ServiceRequestCreated: 'ServiceRequestCreated',
  ServiceRequestAccepted: 'ServiceRequestAccepted',
  ServiceRequestRejected: 'ServiceRequestRejected',
  ServiceRequestCompleted: 'ServiceRequestCompleted',
  ServiceRequestCancelled: 'ServiceRequestCancelled',
  ServiceRequestStatusChanged: 'ServiceRequestStatusChanged',
  // Reputacion
  RatingSubmitted: 'RatingSubmitted',
  ReputationRecalculated: 'ReputationRecalculated',
  CancellationThresholdReached: 'CancellationThresholdReached',
  // Notificacion y administracion
  NotificationCreated: 'NotificationCreated',
  InappropriateContentRemoved: 'InappropriateContentRemoved',
} as const;

export type EventNameValue = (typeof EventName)[keyof typeof EventName];

const uuid = z.string().uuid();

export const eventEnvelopeSchema = z.object({
  /** Identidad del evento. El consumidor la usa para no aplicarlo dos veces. */
  eventId: uuid,
  eventName: z.string().min(1).max(80),
  /**
   * Version del contrato del payload.
   *
   * Anadir un campo NO la incrementa; quitarlo o cambiar su significado si, y
   * entonces ambas versiones conviven durante la migracion (SRS-MSG-05).
   */
  eventVersion: z.number().int().positive(),
  aggregateType: z.string().min(1).max(60),
  aggregateId: z.string().min(1).max(64),
  /** Cuando ocurrio el hecho, no cuando se publico. */
  occurredAt: z.string().datetime(),
  /** Se genera en la puerta de enlace y atraviesa todo el sistema (RNF78). */
  correlationId: uuid,
  /** Evento que provoco este, cuando lo hubo. Permite reconstruir la cadena. */
  causationId: uuid.optional(),
  producer: z.string().min(1).max(60),
  payload: z.record(z.unknown()),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export interface BuildEnvelopeInput {
  eventId: string;
  eventName: EventNameValue;
  aggregateType: string;
  aggregateId: string | number;
  correlationId: string;
  causationId?: string;
  producer: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  eventVersion?: number;
}

export function buildEnvelope(input: BuildEnvelopeInput): EventEnvelope {
  return eventEnvelopeSchema.parse({
    eventId: input.eventId,
    eventName: input.eventName,
    eventVersion: input.eventVersion ?? 1,
    aggregateType: input.aggregateType,
    aggregateId: String(input.aggregateId),
    occurredAt: input.occurredAt.toISOString(),
    correlationId: input.correlationId,
    ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
    producer: input.producer,
    payload: input.payload,
  });
}

/**
 * Clave de enrutamiento del broker: `<contexto>.<agregado>.<evento>`.
 *
 * Permite que un consumidor se suscriba a todo un contexto sin enumerar cada
 * evento, y que uno nuevo no obligue a reconfigurar las colas existentes.
 */
export function routingKey(context: string, aggregate: string, event: string): string {
  const snake = (s: string): string =>
    s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
  return `${snake(context)}.${snake(aggregate)}.${snake(event)}`;
}
