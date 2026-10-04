# request-service

> Documentacion extraida del codigo el **4 de octubre de 2026** (Fase 9). Cuando
> este documento y el codigo no coincidan, manda el codigo: evitar esa deriva es
> justamente para lo que sirve tener esto escrito.
>
> Vive en el repositorio de codigo y no en `09-microservices/services/`, que es
> donde `00-sdd-guide.md` lo pediria. Es la misma decision pendiente que el resto
> de los documentos de entrega: **AT-003**.

## Responsabilidad

Es el dueno del agregado completo de la intermediacion: necesidades, propuestas, solicitudes de servicio y cancelaciones. Es el servicio con mas reglas de negocio del sistema.

| Campo | Valor |
|---|---|
| Numero en el catalogo | 05 |
| Puerto interno | 3004 · **no se publica** |
| Esquema propio | `pa_request`, con su usuario MySQL y privilegio minimo |
| Alcanzable desde | solo el gateway, con `x-internal-secret` |
| Casos de uso | `ManageNeeds` · `ManageProposals` · `ManageRequests` · `CancelRequest` · `SyncReplicas` |

## Lo que hace

- Publicacion, edicion y cierre de necesidades
- Envio, edicion y retirada de propuestas
- Adjudicacion de una propuesta, que crea la solicitud de servicio
- Contratacion directa de un servicio del catalogo
- Cambios de estado de la solicitud: aceptada, rechazada, completada
- Cancelacion con su politica: franja, peso, revision e incomparecencia
- **Revela el contacto de la contraparte**, y solo tras el acuerdo

## Lo que NO hace

- No calcula la tasa de cancelacion: emite el evento y rating-service la calcula
- No guarda el catalogo ni el perfil: los replica
- No envia avisos: los emite como eventos y notification-service los convierte

## API

Todas las rutas van detras del gateway, que verifica el token y pone la
identidad en `x-internal-user-id` y `x-internal-roles`. El servicio **no**
vuelve a verificar el JWT: confia en esas cabeceras porque el gateway las borra
de toda peticion entrante y porque exige el secreto compartido (SRS RNF24,
RNF25).

| Metodo | Ruta | Que hace |
|---|---|---|
| `POST` | `/api/v1/needs` | Publica una necesidad |
| `GET` | `/api/v1/needs/mine` | Las necesidades propias |
| `GET` | `/api/v1/needs` | Las necesidades abiertas |
| `GET` | `/api/v1/needs/:id` | Ficha de una necesidad |
| `PATCH` | `/api/v1/needs/:id` | La edita |
| `POST` | `/api/v1/needs/:id/close` | La cierra |
| `POST` | `/api/v1/needs/:id/proposals` | Envia una propuesta · exige perfil de prestador |
| `GET` | `/api/v1/needs/:id/proposals` | Las propuestas recibidas |
| `POST` | `/api/v1/needs/:id/award` | Adjudica una propuesta y crea la solicitud |
| `GET` | `/api/v1/proposals/mine` | Las propuestas enviadas |
| `PATCH` | `/api/v1/proposals/:id` | Edita la propuesta |
| `DELETE` | `/api/v1/proposals/:id` | La retira |
| `POST` | `/api/v1/requests` | Contratacion directa de un servicio |
| `GET` | `/api/v1/requests/cancellation-reasons` | El catalogo de motivos de cancelacion |
| `GET` | `/api/v1/requests/mine` | Las contrataciones propias |
| `GET` | `/api/v1/requests/:id` | Detalle, **con el contacto si ya hay acuerdo** |
| `PATCH` | `/api/v1/requests/:id/status` | Cambia el estado |
| `POST` | `/api/v1/requests/:id/cancel` | Cancela, y devuelve el peso que tuvo |

Mas `GET /health` y `GET /metrics`, que no forman parte del API publica y por eso
quedan fuera del contrato OpenAPI.

## Lo demas

- [data-model.md](data-model.md) — su esquema y sus replicas
- [events.md](events.md) — que publica y que escucha
- [decisions.md](decisions.md) — por que esta hecho asi
- [runbook.md](runbook.md) — como se arranca y donde mirar cuando falla
