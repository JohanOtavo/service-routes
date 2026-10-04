# Eventos — provider-service

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
| `ServiceProviderProfileCreated` | Alta del perfil | catalog, request |
| `ServiceProviderProfileUpdated` | Edicion, incluido el telefono que se revela tras el acuerdo | catalog, request |
| `ServiceProviderProfileValidated` | El perfil pasa a ACTIVE: hasta aqui no puede proponer | catalog, request, notification |
| `ProviderStatusChanged` | Cambio de estado | catalog, request, notification, admin |

## Que consume

| Evento | De quien | Efecto |
|---|---|---|
| `UserAccountSuspended` | auth-service | Deja al prestador fuera de juego cuando se suspende la cuenta. Se ata a la clave exacta `iam.usuario.user_account_suspended`, no a un comodin |

El consumidor inserta en `processed_event` **antes** de aplicar el efecto y en su
misma transaccion: la segunda entrega del mismo evento choca con la clave
primaria y se descarta. La entrega es *al menos una vez* a proposito, porque
repetir un evento tiene arreglo y perderlo no.

## El grafo completo

[07-GRAFO-DE-EVENTOS.md](../../07-GRAFO-DE-EVENTOS.md): los 29 eventos del
sistema, quien los consume, los seis que nadie escucha, y el orden de
comprobacion cuando algo no llega.
