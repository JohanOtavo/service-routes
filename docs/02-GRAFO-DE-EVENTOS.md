# Grafo de eventos — Punto Amigo

Quién publica cada evento, a qué cola llega y quién lo atiende. Este documento
es una lectura del código, no una descripción de intenciones: si el código y un
comentario se contradicen, aquí gana el código y el comentario queda anotado como
deuda.

**Cómo verificar cada cifra de este documento:**

| Afirmación | Fuente |
|---|---|
| Los 31 nombres de evento | `packages/shared/src/events/envelope.ts:14` |
| Quién publica | `services/*/src/application/**/*.ts` — toda referencia a `EventName.X` ahí es una publicación |
| Quién atiende | `services/*/src/main.ts` — toda referencia a `EventName.X` ahí es un manejador |
| Qué patrón llega a qué cola | `services/*/src/main.ts` → `EventConsumer` (`cola`, `patrones`) |
| La clave de enrutamiento real | `packages/messaging/src/outbox-relay.ts:97` |

## Topología en una línea

De los 8 servicios, **5 publican** (auth, catalog, provider, rating, request) y
**6 consumen** (4 de los anteriores más notification y admin-reporting).
`auth-service` solo publica y `api-gateway` no hace ninguna de las dos cosas: es el
punto de entrada, no un participant del bus. El solapamiento es intencionado: los
servicios se replican datos entre sí a través de eventos, no de llamadas.

| Cifra | Valor |
|---|---|
| Eventos declarados | 31 |
| Eventos que alguien publica | 29 |
| Eventos con al menos un manejador | 23 |
| Publicados pero sin ningún manejador | 6 |
| Declarados y nunca publicados | 2 |
| Colas de consumidor | 6 (+ 6 colas de fallidos) |

## Cómo funciona el transporte

**Publicación.** El caso de uso no publica en RabbitMQ: escribe el evento en
`<esquema>.outbox_event` dentro de la misma transacción que el cambio de negocio.
Así no puede haber estado cambiado sin evento, ni evento sin cambio. Un `OutboxRelay`
en el mismo proceso lo lee después y lo publica
(`packages/messaging/src/outbox-relay.ts:97`). Un broker caído retrasa la entrega,
no la pierde.

**Clave de enrutamiento.** `<contexto>.<agregado>.<evento>`, los tres en
`snake_case` (`packages/shared/src/events/envelope.ts:127`). El contexto lo fija
cada servicio (`iam`, `catalog`, `provider`, `rating`, `request`) y el agregado y el
evento salen de la fila del outbox. Ejemplo: `UserRegistered` con agregado `Usuario`
en auth-service se publica como `iam.usuario.user_registered`.

**Por qué esto importa.** Los consumidores se suscriben por patrón, no evento a
evento. Añadir un evento nuevo no obliga a tocar ninguna cola, y un consumidor
nuevo se interesa por un contexto entero sin enumerar sus eventos.

**Entrega.** «Al menos una vez»: si el broker confirma y el proceso muere antes de
marcar la fila, el evento se reenvía. Por eso todo consumidor es idempotente —la
marca va en `processed_event`, insertada **antes** del efecto y en la misma
transacción (`packages/messaging/src/consumer.ts:128`)—. Perder un evento no
tendría arreglo; duplicarlo, sí.

**Y esa asimetría era un problema abierto. Ya no lo es del todo.** Existía la
ausencia de un comando de re-emisión de la outbox, y el riesgo de que al
republicar un evento con su `event_id` original el consumidor lo descartara por la
clave primaria `(consumer, event_id)` sin avisar. Desde A-4 hay
`node db/cli.js reemit <servicio>`: emite **con `event_id` nuevo**, encola filas
sin publicar para que las recoja el propio `OutboxRelay` y conserva
`occurred_at` para que el orden entre esquemas siga respetando las claves
foráneas. La marca del destino no hay que borrarla porque el evento ya no
comparte identificador.

Dos límites que quedan escritos, y que no los arregla el comando:
- **Los efectos tienen que ser idempotentes**, como ya lo son. Reemitir dos veces
  el mismo evento no duplica nada porque los receptores hacen UPSERT; lo que no
  toleraría es un efecto que no lo fuera.
- **Una réplica con clave foránea hacia otra hay que reconstruirla en orden.** Por
  ejemplo `servicio.id_prestador` contra `prestador_ref`. El comando conserva el
  orden original, pero la reconstrucción completa de `pa_catalog` sigue sin
  verificarse con datos reales: es lo que queda abierto de
  [`01-BACKLOG.md`](01-BACKLOG.md) A-2.

**Fallos.** Un manejador que lanza se reintenta con retroceso exponencial acotado
hasta `BROKER_MAX_RETRIES` (5 por defecto). Agotados los intentos, el mensaje se
deriva a `<cola>.dlq` (`packages/messaging/src/broker.ts:130`). Un mensaje
**inválido** —sobre que no parsea— no se reintenta: va directo a la cola de
fallidos, porque reintentar no lo va a arreglar.

## Tabla de eventos

«Cola» es la cola física a la que llega el mensaje por el patrón, no quién lo
atiende. Varias filas comparten cola: el fan-out es de RabbitMQ, no del código.

| Evento | Clave de enrutamiento | Llega a | Atendido por |
|---|---|---|---|
| `UserRegistered` | `iam.usuario.user_registered` | auditoria, avisos, replicas | notification, request |
| `UserAuthenticated` | `iam.usuario.user_authenticated` | auditoria, avisos, replicas | **nadie** |
| `UserRoleAssigned` | `iam.usuario.user_role_assigned` | auditoria, avisos, replicas | admin-reporting |
| `UserProfileUpdated` | `iam.usuario.user_profile_updated` | auditoria, avisos, replicas | request |
| `UserAccountSuspended` | `iam.usuario.user_account_suspended` | auditoria, avisos, iam, replicas | admin-reporting, notification, provider, request |
| `ServiceProviderProfileCreated` | `provider.prestador.service_provider_profile_created` | auditoria, replicas, avisos | catalog, notification, request |
| `ServiceProviderProfileValidated` | `provider.prestador.service_provider_profile_validated` | auditoria, replicas, avisos | catalog, notification, request |
| `ServiceProviderProfileUpdated` | `provider.prestador.service_provider_profile_updated` | auditoria, replicas, avisos | catalog, request |
| `ProviderStatusChanged` | `provider.prestador.provider_status_changed` | auditoria, replicas, avisos | admin-reporting, catalog, notification, request |
| `ServicePublished` | `catalog.servicio.service_published` | replicas | request |
| `ServiceUpdated` | `catalog.servicio.service_updated` | replicas | request |
| `ServiceDeactivated` | `catalog.servicio.service_deactivated` | replicas | request |
| `CategoryCreated` | `catalog.categoria.category_created` | replicas | request |
| `CategoryUpdated` | `catalog.categoria.category_updated` | replicas | request |
| `NeedPublished` | `request.necesidad.need_published` | avisos | **nadie** |
| `NeedClosed` | `request.necesidad.need_closed` | avisos | **nadie** |
| `NeedReopened` | `request.necesidad.need_reopened` | avisos | **nadie** |
| `ProposalSubmitted` | `request.propuesta.proposal_submitted` | avisos | notification |
| `ProposalAwarded` | `request.propuesta.proposal_awarded` | avisos | notification |
| `ProposalDiscarded` | `request.propuesta.proposal_discarded` | avisos | **nadie** |
| `ServiceRequestCreated` | `request.solicitud.service_request_created` | avisos, solicitudes | notification, rating |
| `ServiceRequestAccepted` | `request.solicitud.service_request_accepted` | avisos, solicitudes | notification, rating |
| `ServiceRequestRejected` | `request.solicitud.service_request_rejected` | avisos, solicitudes | notification, rating |
| `ServiceRequestCompleted` | `request.solicitud.service_request_completed` | avisos, solicitudes | notification, rating |
| `ServiceRequestCancelled` | `request.solicitud.service_request_cancelled` | avisos, solicitudes | notification, rating |
| `ServiceRequestStatusChanged` | `request.solicitud.service_request_status_changed` | avisos, solicitudes | **nadie** |
| `RatingSubmitted` | `rating.calificacion.rating_submitted` | replicas, avisos | catalog, notification |
| `ReputationRecalculated` | `rating.reputacion.reputation_recalculated` | replicas, avisos | catalog |
| `CancellationThresholdReached` | `rating.tasa_cancelacion.cancellation_threshold_reached` | avisos | notification |
| `NotificationCreated` | — | — | declarado y nunca publicado |
| `InappropriateContentRemoved` | — | — | declarado y nunca publicado |

Abreviaturas de la columna «Llega a»: `auditoria` =
`admin-reporting-service.auditoria`, `avisos` = `notification-service.avisos`,
`solicitudes` = `rating-service.solicitudes`, `replicas` =
`request-service.replicas` o `catalog-service.replicas` según el contexto,
`iam` = `provider-service.iam`.

`ServiceRequestCreated` se publica desde dos sitios del mismo caso de uso (alta
directa y adjudicación de una propuesta) y en los dos casos con el agregado
`Solicitud`, así que su clave no varía.

## Colas y sus suscripciones

| Cola | Se suscribe a | Servicio | Qué mantiene |
|---|---|---|---|
| `admin-reporting-service.auditoria` | `iam.#`, `provider.#` | admin-reporting | Bitácora de auditoría (RF109–RF112) |
| `catalog-service.replicas` | `provider.prestador.*`, `rating.calificacion.*`, `rating.reputacion.*` | catalog | `prestador_ref` y resumen de valoración |
| `notification-service.avisos` | `iam.#`, `provider.#`, `request.#`, `rating.#` | notification | `usuario_ref` y avisos al usuario |
| `provider-service.iam` | `iam.usuario.user_account_suspended` | provider | Suspende el prestador cuando su cuenta se suspende |
| `rating-service.solicitudes` | `request.solicitud.*` | rating | Réplica mínima de la solicitud |
| `request-service.replicas` | `iam.usuario.*`, `provider.prestador.*`, `catalog.servicio.*`, `catalog.categoria.*` | request | `usuario_ref`, `prestador_ref`, `servicio_ref`, `categoria_ref` |

Cuatro servicios replican datos de otros. Ninguno lo hace con una llamada
síncrona: **esta es la razón de ser del bus**, y la que hace que
`api-gateway` no necesite conocer la topología interna.

`provider-service.iam` es el caso contrario y el modelo a seguir: no usa comodín,
se suscribe a una clave exacta y por eso recibe **un solo evento**, el que le
interesa, sin descartar ninguno. El resto del sistema hace lo contrario.
`notification-service.avisos` se suscribe a `iam.#`, `provider.#`, `request.#` y
`rating.#`, así que **recibe 24 eventos y atiende 13**: once llegan, no encuentra
manejador y los descarta en silencio. Ver «Deuda detectada».

## Deuda detectada

### 6 eventos que se publican y nadie atiende

Llegan a una cola, no encuentran manejador, y el consumidor los **confirma y los
descarta sin quejarse** (`packages/messaging/src/consumer.ts:101`). No van a la
cola de fallidos: no son un error, según el código.

| Evento | Llega a | Por qué puede ser correcto |
|---|---|---|
| `UserAuthenticated` | auditoria, avisos, replicas | Auditar un login encaja. Avisar al usuario de su propio login, no. |
| `NeedPublished` | avisos | Avisar a prestadores de una demanda nueva **debería** existir. |
| `NeedClosed` | avisos | Ídem. |
| `NeedReopened` | avisos | Ídem. |
| `ProposalDiscarded` | avisos | Avisar al prestador de que su propuesta se descartó **debería** existir. |
| `ServiceRequestStatusChanged` | avisos, solicitudes | Ver abajo: es deliberadamente genérico. |

Los tres `Need*` y `ProposalDiscarded` apuntan a la misma carencia: el registro de
demandas y propuestas no genera avisos, aunque el resto de la cadena de solicitudes
sí lo hace. Es un hueco funcional, no un descuido de cableado.

### `ServiceRequestStatusChanged`: la intención documentada no se cumple

`ManageRequests` publica, en cada cambio de estado, **dos** eventos: el específico
(`…Accepted`, `…Rejected`, `…Completed`, `…Cancelled`) y el genérico
`ServiceRequestStatusChanged`. El comentario del código explica por qué
(`services/request-service/src/application/use-cases/ManageRequests.ts:344`):

> El genérico `ServiceRequestStatusChanged` sirve a quien solo lleva la cuenta; los
> específicos permiten que rating-service se suscriba SOLO a `completed` y
> `cancelled` sin recibir y descartar todos los demás.

El genérico no tiene manejador: correcto, es para «llevar la cuenta».

Pero el objetivo del comentario —que rating-service reciba solo `completed` y
`cancelled`— **no se cumple**: `rating-service.solicitudes` se suscribe a
`request.solicitud.*`, así que recibe los seis eventos de solicitud y atiende
cinco; el que descarta es `ServiceRequestStatusChanged`. El patrón que sí cumpliría
lo comentado sería `request.solicitud.service_request_completed` más
`request.solicitud.service_request_cancelled`, no un comodín de una palabra.

Igual de importante: el patrón actual no está equivocado. Es correcto en todo lo
que importa y desperdicia en un detalle —el mensaje descartado no se marca en
`processed_event`, así que ni siquiera queda constancia de que pasó—. Por eso no es
un bug observable hoy: es una promesa que el código no cumple.

### 2 eventos declarados y nunca publicados

`NotificationCreated` e `InappropriateContentRemoved` están en el enum de
`EventName` y nadie los publica ni los atiende. `NotificationCreated` es
especialmente dudoso: el servicio de notificación sí crea filas de
`notificacion`, así que el evento parece faltar el que debería emitir. Antes de
conectar nada hay que decidir si el evento es superfluo (el que lee la tabla
`notificacion` ya lo tiene) o si falta el publicador. No está en
`01-BACKLOG.md`: es deuda nueva, y decidirlo requiere criterio del dominio, no
un caso de uso.

## Un evento que existe por una razón que el SRS no recoge

`ServiceProviderProfileUpdated` **no está en la lista de eventos del SRS**. El
propio código lo admite (`packages/shared/src/events/envelope.ts:24`): sin él,
`pa_catalog.prestador_ref` conserva el nombre y la especialidad antiguos para
siempre, y el catálogo publica datos que ya no son ciertos.

Es la clase de deuda que no aparece en ningún backlog: el código tiene razón y el
documento está desactualizado. Es una entrada para el SRS, no una tarea de código.

## Qué mirar antes de tocar el grafo

1. **Añadir un evento es barato**: basta con el enum y el `enqueue`. Ninguna cola
   cambia, porque todas se suscriben por patrón.
2. **Quitar un manejador es caro**: el mensaje se seguirá confirmando y descartando.
   Un manejador que se borra deja el efecto de su tabla sin actualizar y no hay
   ningún aviso.
3. **Cambiar un `aggregateType` rompe el enrutamiento en silencio**: la clave se
   deriva de él, así que el evento pasa a otra cola o a ninguna.
4. **`ServiceProviderProfileUpdated` no está en el SRS**: si el documento es la
   fuente de verdad para otro equipo, ahí falta la entrada.