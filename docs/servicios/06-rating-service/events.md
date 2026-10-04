# Eventos — rating-service

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
| `RatingSubmitted` | Se registro una calificacion | catalog, notification |
| `ReputationRecalculated` | La media del usuario cambio | catalog |
| `CancellationThresholdReached` | Alguien cruzo el umbral de cancelaciones | notification |

## Que consume

| Evento | De quien | Efecto |
|---|---|---|
| `ServiceRequestCreated · ServiceRequestAccepted · ServiceRequestRejected` | request-service | Alimenta `solicitud_ref`, que es como el servicio sabe que contrataciones existen |
| `ServiceRequestCompleted` | request-service | Habilita calificar: sin esto, una calificacion sobre esa contratacion se rechaza |
| `ServiceRequestCancelled` | request-service | Alta en `cancelacion_ref` y recalculo de la tasa |

El consumidor inserta en `processed_event` **antes** de aplicar el efecto y en su
misma transaccion: la segunda entrega del mismo evento choca con la clave
primaria y se descarta. La entrega es *al menos una vez* a proposito, porque
repetir un evento tiene arreglo y perderlo no.

## El grafo completo

[07-GRAFO-DE-EVENTOS.md](../../07-GRAFO-DE-EVENTOS.md): los 29 eventos del
sistema, quien los consume, los seis que nadie escucha, y el orden de
comprobacion cuando algo no llega.
