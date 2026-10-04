# rating-service

> Documentacion extraida del codigo el **4 de octubre de 2026** (Fase 9). Cuando
> este documento y el codigo no coincidan, manda el codigo: evitar esa deriva es
> justamente para lo que sirve tener esto escrito.
>
> Vive en el repositorio de codigo y no en `09-microservices/services/`, que es
> donde `00-sdd-guide.md` lo pediria. Es la misma decision pendiente que el resto
> de los documentos de entrega: **AT-003**.

## Responsabilidad

Es el dueno de la reputacion: las calificaciones entre las partes, la media por usuario y por servicio, y la tasa de cancelacion con su umbral.

| Campo | Valor |
|---|---|
| Numero en el catalogo | 06 |
| Puerto interno | 3005 · **no se publica** |
| Esquema propio | `pa_rating`, con su usuario MySQL y privilegio minimo |
| Alcanzable desde | solo el gateway, con `x-internal-secret` |
| Casos de uso | `SubmitRating` · `QueryReputation` · `TrackCancellationRate` |

## Lo que hace

- Alta de calificaciones, solo sobre contrataciones completadas
- Calculo de la reputacion por usuario y por servicio
- Calculo de la tasa de cancelacion, con el peso de cada cancelacion segun su franja
- Emision del aviso cuando alguien cruza el umbral de cancelaciones
- Baja de una calificacion · ADMINISTRADOR

## Lo que NO hace

- No decide si una contratacion esta completada: se lo dicen los eventos de request-service
- No guarda el catalogo: emite el resumen y catalog-service lo guarda

## API

Todas las rutas van detras del gateway, que verifica el token y pone la
identidad en `x-internal-user-id` y `x-internal-roles`. El servicio **no**
vuelve a verificar el JWT: confia en esas cabeceras porque el gateway las borra
de toda peticion entrante y porque exige el secreto compartido (SRS RNF24,
RNF25).

| Metodo | Ruta | Que hace |
|---|---|---|
| `POST` | `/api/v1/ratings` | Califica una contratacion completada |
| `GET` | `/api/v1/ratings/users/:id` | La reputacion de un usuario |
| `GET` | `/api/v1/ratings/users/:id/received` | Las calificaciones que recibio |
| `GET` | `/api/v1/ratings/services/:id` | Las calificaciones de un servicio |
| `DELETE` | `/api/v1/ratings/:id` | Da de baja una calificacion · ADMINISTRADOR |

Mas `GET /health` y `GET /metrics`, que no forman parte del API publica y por eso
quedan fuera del contrato OpenAPI.

## Lo demas

- [data-model.md](data-model.md) — su esquema y sus replicas
- [events.md](events.md) — que publica y que escucha
- [decisions.md](decisions.md) — por que esta hecho asi
- [runbook.md](runbook.md) — como se arranca y donde mirar cuando falla
