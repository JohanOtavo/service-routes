# Eventos — request-service

> Documentacion extraida del codigo el **4 de octubre de 2026** (Fase 9). Cuando
> este documento y el codigo no coincidan, manda el codigo: evitar esa deriva es
> justamente para lo que sirve tener esto escrito.
>
> Vive en el repositorio de codigo y no en `09-microservices/services/`, que es
> donde `00-sdd-guide.md` lo pediria. Es la misma decision pendiente que el resto
> de los documentos de entrega: **AT-003**.

## Que publica

El caso de uso escribe el evento en `outbox_event` **dentro de la misma
transaccion** que el cambio, y el relevo lo publica despues con reintentos: no
puede haber cambio sin evento ni evento sin cambio (SRS RNF37, RNF46).

| Evento | Cuando | Quien lo escucha |
|---|---|---|
| `NeedPublished · NeedClosed · NeedReopened` | Ciclo de vida de la necesidad | *nadie, por ahora* |
| `ProposalSubmitted` | Propuesta enviada | notification |
| `ProposalAwarded` | Propuesta adjudicada | notification |
| `ProposalDiscarded` | Propuesta descartada | *nadie, por ahora* |
| `ServiceRequestCreated` | Se creo la contratacion | rating, notification |
| `ServiceRequestAccepted · ServiceRequestRejected · ServiceRequestCompleted` | Cambios de estado | rating, notification |
| `ServiceRequestCancelled` | Cancelacion: alimenta la tasa | rating, notification |
| `ServiceRequestStatusChanged` | Cambio de estado generico | *nadie, por ahora* |

## Que consume

| Evento | De quien | Efecto |
|---|---|---|
| `UserRegistered` | auth-service | Alta en `usuario_ref`, que es clave ajena de `necesidad` y de `solicitud_servicio` |
| `UserProfileUpdated` | auth-service | Refresca `usuario_ref` |
| `UserAccountSuspended` | auth-service | Marca la cuenta suspendida |
| `ServiceProviderProfileCreated/Updated/Validated` | provider-service | Alimenta `prestador_ref`, de donde sale el telefono que se revela tras el acuerdo |
| `ProviderStatusChanged` | provider-service | Estado del prestador |
| `CategoryCreated · CategoryUpdated` | catalog-service | `categoria_ref`. **Sin esto no se puede publicar una necesidad** |
| `ServicePublished · ServiceUpdated · ServiceDeactivated` | catalog-service | `servicio_ref` |

El consumidor inserta en `processed_event` **antes** de aplicar el efecto y en su
misma transaccion: la segunda entrega del mismo evento choca con la clave
primaria y se descarta. La entrega es *al menos una vez* a proposito, porque
repetir un evento tiene arreglo y perderlo no.

## El grafo completo

[07-GRAFO-DE-EVENTOS.md](../../07-GRAFO-DE-EVENTOS.md): los 29 eventos del
sistema, quien los consume, los seis que nadie escucha, y el orden de
comprobacion cuando algo no llega.
