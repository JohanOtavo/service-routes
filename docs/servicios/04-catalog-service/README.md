# catalog-service

> Documentacion extraida del codigo el **4 de octubre de 2026** (Fase 9). Cuando
> este documento y el codigo no coincidan, manda el codigo: evitar esa deriva es
> justamente para lo que sirve tener esto escrito.
>
> Vive en el repositorio de codigo y no en `09-microservices/services/`, que es
> donde `00-sdd-guide.md` lo pediria. Es la misma decision pendiente que el resto
> de los documentos de entrega: **AT-003**.

## Responsabilidad

Es el dueno del catalogo: las categorias de oficio y los servicios que cada prestador publica, con su precio y su estado.

| Campo | Valor |
|---|---|
| Numero en el catalogo | 04 |
| Puerto interno | 3003 · **no se publica** |
| Esquema propio | `pa_catalog`, con su usuario MySQL y privilegio minimo |
| Alcanzable desde | solo el gateway, con `x-internal-secret` |
| Casos de uso | `ManageCategories` · `ManageServiceCatalog` · `SearchCatalog` · `SyncProviderRef` · `SyncRatingSummary` |

## Lo que hace

- Alta, edicion y baja de los servicios de un prestador
- Busqueda y listado del catalogo, con filtros
- Alta y edicion de las categorias de oficio · ADMINISTRADOR
- Guarda el resumen de calificaciones por servicio, para poder ordenar sin preguntar a rating-service

## Lo que NO hace

- No calcula la reputacion: la recibe de rating-service y la guarda
- No valida al prestador: eso es de provider-service
- No gestiona necesidades ni propuestas: eso es de request-service

## API

Todas las rutas van detras del gateway, que verifica el token y pone la
identidad en `x-internal-user-id` y `x-internal-roles`. El servicio **no**
vuelve a verificar el JWT: confia en esas cabeceras porque el gateway las borra
de toda peticion entrante y porque exige el secreto compartido (SRS RNF24,
RNF25).

| Metodo | Ruta | Que hace |
|---|---|---|
| `GET` | `/api/v1/services/mine` | Los servicios del prestador autenticado |
| `POST` | `/api/v1/services` | Publica un servicio |
| `GET` | `/api/v1/services` | Busca en el catalogo · **no exige token** |
| `GET` | `/api/v1/services/:id` | Ficha de un servicio · **no exige token** |
| `PATCH` | `/api/v1/services/:id` | Edita el servicio |
| `DELETE` | `/api/v1/services/:id` | Lo desactiva |
| `GET` | `/api/v1/categories` | Las categorias activas · **no exige token** |
| `POST` | `/api/v1/categories` | Crea una categoria · ADMINISTRADOR |
| `PATCH` | `/api/v1/categories/:id` | La edita · ADMINISTRADOR |

Mas `GET /health` y `GET /metrics`, que no forman parte del API publica y por eso
quedan fuera del contrato OpenAPI.

## Lo demas

- [data-model.md](data-model.md) — su esquema y sus replicas
- [events.md](events.md) — que publica y que escucha
- [decisions.md](decisions.md) — por que esta hecho asi
- [runbook.md](runbook.md) — como se arranca y donde mirar cuando falla
