# Grafo de eventos — Punto Amigo

Quién publica cada evento, quién lo escucha y qué cambia cuando llega. Es la
pieza que el backlog señalaba como la más importante del grupo H: **sin ella no
se puede seguir un dato desde que nace en un servicio hasta que aparece en la
vista de otro**.

- Fecha: **4 de octubre de 2026**
- Extraído del código, no de un diseño: los emisores salen de los casos de uso
  (`services/*/src/application`), los consumidores de los `consumidor.on(...)`
  de cada `main.ts`, y las tablas réplica del esquema real
- Cierra: el «grafo de eventos entre servicios» del grupo H

---

## 1. Cómo viaja un evento

```
caso de uso ──escribe en la MISMA transaccion──> outbox_event (su esquema)
                                                      │
                                      OutboxRelay ────┤ cada 1 s
                                                      v
                                        RabbitMQ: punto-amigo.events (topic)
                                                      │
                            una cola duradera por servicio consumidor
                                                      v
                    EventConsumer ──> processed_event ──> manejador ──> replica
                                     (misma transaccion)
```

Tres garantías, y conviene saber cuál es cuál:

| Garantía | Cómo se consigue |
|---|---|
| No hay cambio sin evento, ni evento sin cambio | el caso de uso escribe el evento en `outbox_event` **dentro de la misma transacción** que el cambio de negocio |
| La entrega es *al menos una vez* | si el broker confirma y el proceso muere antes de marcar la fila, el relevo la reenvía. Perder un evento no tendría arreglo; repetirlo sí |
| Repetir no duplica efectos | el consumidor inserta en `processed_event` (clave primaria `consumer, event_id`) **antes** de ejecutar el efecto y en su misma transacción |

**Clave de enrutado:** `contexto.agregado.evento`, todo en *snake_case*
(`routingKey()` en `packages/shared/src/events/`). Así,
`CategoryCreated` del agregado `Categoria` en catalog sale como
`catalog.categoria.category_created`.

| Servicio | Contexto |
|---|---|
| auth-service | `iam` |
| provider-service | `provider` |
| catalog-service | `catalog` |
| request-service | `request` |
| rating-service | `rating` |

## 2. Quién escucha qué

| Servicio | Cola duradera | Patrones a los que se ata |
|---|---|---|
| provider-service | `provider-service.iam` | `iam.usuario.user_account_suspended` |
| catalog-service | `catalog-service.replicas` | `provider.prestador.*`, `rating.calificacion.*`, `rating.reputacion.*` |
| request-service | `request-service.replicas` | `iam.usuario.*`, `provider.prestador.*`, `catalog.servicio.*`, `catalog.categoria.*` |
| rating-service | `rating-service.solicitudes` | `request.solicitud.*` |
| notification-service | `notification-service.avisos` | `iam.#`, `provider.#`, `request.#`, `rating.#` |
| admin-reporting-service | `admin-reporting-service.auditoria` | `iam.#`, `provider.#` |

Cada cola lleva su `.dlq`: un mensaje que falla repetidamente se deriva en lugar
de rebotar para siempre y bloquear a los demás (SRS RF96, RNF82). **Un `.dlq`
con cualquier valor distinto de cero merece una mirada**, y por eso está en el
panel de Grafana.

Un patrón con comodín entrega más de lo que el servicio maneja: lo que llega sin
manejador se confirma y se descarta. No es un error —suscribirse por familia
evita tener que tocar la configuración al añadir un evento— pero explica por qué
una cola puede tener tráfico que no produce ningún efecto.

## 3. El grafo

```
            auth-service (iam)
                   │
   UserRegistered  │  UserProfileUpdated · UserAccountSuspended · UserRoleAssigned
                   ├──────────────> request-service      (usuario_ref)
                   ├──────────────> notification-service (usuario_ref + aviso)
                   ├──────────────> provider-service     (solo suspension)
                   └──────────────> admin-reporting      (auditoria)

        provider-service (provider)
                   │
   ServiceProviderProfileCreated/Updated/Validated · ProviderStatusChanged
                   ├──────────────> catalog-service     (prestador_ref)
                   ├──────────────> request-service     (prestador_ref)
                   ├──────────────> notification-service (aviso)
                   └──────────────> admin-reporting      (auditoria)

         catalog-service (catalog)
                   │
   CategoryCreated/Updated · ServicePublished/Updated/Deactivated
                   └──────────────> request-service  (categoria_ref, servicio_ref)

         request-service (request)
                   │
   ServiceRequestCreated/Accepted/Rejected/Completed/Cancelled
                   ├──────────────> rating-service       (solicitud_ref, cancelacion_ref)
                   └──────────────> notification-service (aviso)
                   │
   ProposalSubmitted · ProposalAwarded
                   └──────────────> notification-service (aviso)

          rating-service (rating)
                   │
   RatingSubmitted · ReputationRecalculated
                   ├──────────────> catalog-service      (reputacion del prestador)
                   └──────────────> notification-service (aviso)
                   │
   CancellationThresholdReached
                   └──────────────> notification-service (aviso)
```

## 4. Tabla completa

Veintinueve eventos. «Efecto» dice qué cambia al llegar, no qué significa.

| Evento | Emite | Consume | Efecto en el consumidor |
|---|---|---|---|
| `UserRegistered` | auth | request, notification | alta en `usuario_ref`; aviso de bienvenida |
| `UserProfileUpdated` | auth | request, notification | refresca `usuario_ref`. **Lleva dos papeles**: ver §6 |
| `UserAccountSuspended` | auth | provider, request, notification, admin | marca la cuenta suspendida en las réplicas; el prestador pasa a inactivo; aviso; auditoría |
| `UserRoleAssigned` | auth | admin | auditoría del cambio de rol |
| `UserAuthenticated` | auth | *nadie* | — ver §5 |
| `ServiceProviderProfileCreated` | provider | catalog, request | alta en `prestador_ref` |
| `ServiceProviderProfileUpdated` | provider | catalog, request | refresca `prestador_ref`, incluido el teléfono que se revela tras el acuerdo |
| `ServiceProviderProfileValidated` | provider | catalog, request, notification | el perfil pasa a ACTIVE: hasta aquí no puede proponer; aviso |
| `ProviderStatusChanged` | provider | catalog, request, notification, admin | estado en `prestador_ref`; aviso; auditoría |
| `CategoryCreated` | catalog | request | alta en `categoria_ref`. **Sin esto no se puede publicar una necesidad**: su categoría «no está activa» |
| `CategoryUpdated` | catalog | request | refresca `categoria_ref` |
| `ServicePublished` | catalog | request | alta en `servicio_ref` |
| `ServiceUpdated` | catalog | request | refresca `servicio_ref` |
| `ServiceDeactivated` | catalog | request | marca el servicio inactivo en `servicio_ref` |
| `ServiceRequestCreated` | request | rating, notification | alta en `solicitud_ref`; aviso al prestador |
| `ServiceRequestAccepted` | request | rating, notification | estado en `solicitud_ref`; aviso |
| `ServiceRequestRejected` | request | rating, notification | estado en `solicitud_ref`; aviso |
| `ServiceRequestCompleted` | request | rating, notification | habilita calificar; aviso |
| `ServiceRequestCancelled` | request | rating, notification | alta en `cancelacion_ref`, que alimenta la tasa de cancelación; aviso |
| `ProposalSubmitted` | request | notification | aviso al solicitante |
| `ProposalAwarded` | request | notification | aviso al prestador adjudicado |
| `ProposalDiscarded` | request | *nadie* | — ver §5 |
| `NeedPublished` | request | *nadie* | — ver §5 |
| `NeedClosed` | request | *nadie* | — ver §5 |
| `NeedReopened` | request | *nadie* | — ver §5 |
| `ServiceRequestStatusChanged` | request | *nadie* | — ver §5 |
| `RatingSubmitted` | rating | catalog, notification | reputación del prestador en catalog; aviso |
| `ReputationRecalculated` | rating | catalog | reputación recalculada |
| `CancellationThresholdReached` | rating | notification | aviso de que se cruzó el umbral de cancelaciones |

## 5. Seis eventos que nadie consume

`UserAuthenticated`, `NeedPublished`, `NeedClosed`, `NeedReopened`,
`ProposalDiscarded` y `ServiceRequestStatusChanged` se publican y **ningún
servicio tiene manejador para ellos**. Los que caen en un patrón con comodín
(`iam.#`, `request.#`) llegan a una cola, se confirman y se descartan; los demás
no llegan a ninguna.

No es un defecto, y conviene que esté escrito para que no se lea como tal:

- Son el registro de hechos del dominio, y el patrón outbox los deja
  disponibles para un consumidor futuro sin tocar al emisor.
- `UserAuthenticated` es además la base de cualquier analítica de acceso que se
  quiera después, y escribirlo ahora cuesta una fila.

Lo que sí hay que vigilar: **cada evento sin consumidor es una fila en
`outbox_event` que se publica y se marca**. Si alguno dejara de interesar, el
sitio donde se borra es su caso de uso, no la configuración del broker.

## 6. Dos rarezas que hay que conocer antes de tocar esto

### El token de recuperación viaja sobre `UserProfileUpdated`

`PasswordRecovery` no emite un evento propio: publica `UserProfileUpdated` con
`accion: 'RECUPERACION_SOLICITADA'` y el **token dentro del payload**. Es el
único evento que transporta un secreto, y por eso su único consumidor con efecto
es notification-service, que lo convierte en el correo.

Consecuencia práctica: `UserProfileUpdated` llega también a `request-service`,
que lo usa para refrescar `usuario_ref`. Un cambio en ese payload toca dos
caminos que no se parecen en nada.

### Las semillas no llenan las réplicas, y `db:reemit` existe para eso

`db/seeds/` inserta filas y **no escribe en el outbox**: una base recién creada
tiene los usuarios y las categorías en su esquema propietario y las réplicas
vacías. Publicar una necesidad falla ahí, porque su categoría no está en
`categoria_ref`.

```bash
npm run db:reemit            # los siete servicios
npm run db:reemit provider   # solo uno
```

`db/reemit.js` re-encola los eventos de alta del estado actual con
`event_id` nuevos y `reemision: true` en el payload. Esa marca es la que permite
que notification-service **no** reenvíe correos de bienvenida al reconstruir una
réplica (`esReemision()` en `packages/shared/src/values/vacio.ts`).

El relevo publica, el consumidor aplica: `db:reemit` no publica nada por su
cuenta, para no rodear el camino que ya sabe reintentar y marcar.

## 7. Cuando algo no llega

El orden de comprobación, de más barato a más caro:

1. **¿Está en el outbox del emisor?**
   `select count(*) from <esquema>.outbox_event where published_at is null;`
   Si hay filas con `attempts = 0` y `published_at` nulo, el relevo no está
   publicando: casi siempre es el broker, y el registro del servicio lo dice.
2. **¿Se agotaron los intentos?** `attempts >= BROKER_MAX_RETRIES` con
   `last_error` escrito. Ahí está el motivo, literal.
3. **¿Llegó a la cola?**
   `docker exec pa-rabbitmq rabbitmqctl list_queues name messages_ready`
   Mensajes acumulados = consumidor parado o caído. El panel de Grafana lo
   muestra como «mensajes sin consumir».
4. **¿Se derivó a `.dlq`?** Entonces el manejador falló: el registro del
   consumidor lleva el `eventId` y el motivo.
5. **¿Se aplicó y no se ve?** `select * from <esquema>.processed_event where
   event_id = '...'` dice si ese consumidor ya lo dio por hecho. Un evento
   marcado como procesado no se vuelve a aplicar, por diseño.

Dos fallos reales que este orden habría acortado, y que están contados en
[FASE-8-ENTREGA.md](FASE-8-ENTREGA.md) §3: un broker que no reconectaba si
fallaba su primer intento —eventos apilados con `attempts = 0`— y una réplica a
la que le faltaba una columna, con el consumidor derivando a `.dlq` mientras el
servicio seguía respondiendo en verde.
