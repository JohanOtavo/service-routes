# Eventos — admin-reporting-service

> Documentacion extraida del codigo el **4 de octubre de 2026** (Fase 9). Cuando
> este documento y el codigo no coincidan, manda el codigo: evitar esa deriva es
> justamente para lo que sirve tener esto escrito.
>
> Vive en el repositorio de codigo y no en `09-microservices/services/`, que es
> donde `00-sdd-guide.md` lo pediria. Es la misma decision pendiente que el resto
> de los documentos de entrega: **AT-003**.

## Que publica

**Ninguno.** Este servicio no publica eventos, y por eso su esquema no tiene
`outbox_event`. Solo escucha.

## Que consume

| Evento | De quien | Efecto |
|---|---|---|
| `UserRoleAssigned` | auth-service | Auditoria del cambio de rol |
| `UserAccountSuspended` | auth-service | Auditoria de la suspension |
| `ProviderStatusChanged` | provider-service | Auditoria del cambio de estado |

El consumidor inserta en `processed_event` **antes** de aplicar el efecto y en su
misma transaccion: la segunda entrega del mismo evento choca con la clave
primaria y se descarta. La entrega es *al menos una vez* a proposito, porque
repetir un evento tiene arreglo y perderlo no.

## El grafo completo

[07-GRAFO-DE-EVENTOS.md](../../07-GRAFO-DE-EVENTOS.md): los 29 eventos del
sistema, quien los consume, los seis que nadie escucha, y el orden de
comprobacion cuando algo no llega.
