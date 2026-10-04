# provider-service

> Documentacion extraida del codigo el **4 de octubre de 2026** (Fase 9). Cuando
> este documento y el codigo no coincidan, manda el codigo: evitar esa deriva es
> justamente para lo que sirve tener esto escrito.
>
> Vive en el repositorio de codigo y no en `09-microservices/services/`, que es
> donde `00-sdd-guide.md` lo pediria. Es la misma decision pendiente que el resto
> de los documentos de entrega: **AT-003**.

## Responsabilidad

Es el dueno del perfil de prestador: quien ofrece servicios, con que especialidad y en que estado. Ningun otro servicio escribe esa informacion.

| Campo | Valor |
|---|---|
| Numero en el catalogo | 03 |
| Puerto interno | 3002 · **no se publica** |
| Esquema propio | `pa_provider`, con su usuario MySQL y privilegio minimo |
| Alcanzable desde | solo el gateway, con `x-internal-secret` |
| Casos de uso | `ManageProviderProfile` · `ReviewProviderProfile` · `SyncAccountState` |

## Lo que hace

- Alta y edicion del perfil de prestador, uno por usuario
- Validacion del perfil por un administrador, con registro de quien y cuando
- Rechazo del perfil, con motivo
- Cambio de estado del prestador: ACTIVE, INACTIVE, SUSPENDED
- Baja logica del perfil (`deleted_at`), nunca borrado fisico

## Lo que NO hace

- No guarda la cuenta ni las credenciales: eso es de auth-service
- No guarda los servicios que ofrece: eso es de catalog-service
- No calcula reputacion: eso es de rating-service
- No revela el telefono: lo sirve request-service, y solo tras el acuerdo

## API

Todas las rutas van detras del gateway, que verifica el token y pone la
identidad en `x-internal-user-id` y `x-internal-roles`. El servicio **no**
vuelve a verificar el JWT: confia en esas cabeceras porque el gateway las borra
de toda peticion entrante y porque exige el secreto compartido (SRS RNF24,
RNF25).

| Metodo | Ruta | Que hace |
|---|---|---|
| `POST` | `/api/v1/providers` | Crea el perfil del usuario autenticado |
| `GET` | `/api/v1/providers/me` | El perfil propio |
| `GET` | `/api/v1/providers/pending` | Los perfiles por validar · ADMINISTRADOR |
| `GET` | `/api/v1/providers` | Listado paginado |
| `GET` | `/api/v1/providers/:id` | Ficha publica · **no exige token** |
| `PATCH` | `/api/v1/providers/:id` | Edita el perfil |
| `DELETE` | `/api/v1/providers/:id` | Baja logica |
| `GET` | `/api/v1/providers/:id/full` | Ficha con su historial de validacion · ADMINISTRADOR |
| `POST` | `/api/v1/providers/:id/validate` | Valida el perfil · ADMINISTRADOR |
| `POST` | `/api/v1/providers/:id/reject` | Lo rechaza, con motivo · ADMINISTRADOR |
| `PATCH` | `/api/v1/providers/:id/status` | Cambia el estado · ADMINISTRADOR |

Mas `GET /health` y `GET /metrics`, que no forman parte del API publica y por eso
quedan fuera del contrato OpenAPI.

## Lo demas

- [data-model.md](data-model.md) — su esquema y sus replicas
- [events.md](events.md) — que publica y que escucha
- [decisions.md](decisions.md) — por que esta hecho asi
- [runbook.md](runbook.md) — como se arranca y donde mirar cuando falla
