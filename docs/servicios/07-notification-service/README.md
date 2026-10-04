# notification-service

> Documentacion extraida del codigo el **4 de octubre de 2026** (Fase 9). Cuando
> este documento y el codigo no coincidan, manda el codigo: evitar esa deriva es
> justamente para lo que sirve tener esto escrito.
>
> Vive en el repositorio de codigo y no en `09-microservices/services/`, que es
> donde `00-sdd-guide.md` lo pediria. Es la misma decision pendiente que el resto
> de los documentos de entrega: **AT-003**.

## Responsabilidad

Convierte los eventos del sistema en avisos para las personas: la bandeja dentro de la aplicacion y el unico correo transaccional que existe, el de recuperacion de contrasena.

| Campo | Valor |
|---|---|
| Numero en el catalogo | 07 |
| Puerto interno | 3006 · **no se publica** |
| Esquema propio | `pa_notification`, con su usuario MySQL y privilegio minimo |
| Alcanzable desde | solo el gateway, con `x-internal-secret` |
| Casos de uso | `CreateFromEvent` · `ManageInbox` · `SendRecoveryEmail` |

## Lo que hace

- Crea un aviso por cada evento que le interesa, de catorce tipos distintos
- Sirve la bandeja: listado, contador de no leidos, marcar como leido
- Envia el correo de recuperacion de contrasena por SMTP, o lo registra si no hay SMTP configurado
- Guarda las preferencias de notificacion por usuario

## Lo que NO hace

- No envia push ni correo de producto: **descartados del MVP** el 3/10/2026
- No decide cuando ocurre algo: solo escucha eventos
- No reenvia avisos al reconstruir una replica: ignora los eventos marcados con `reemision`

## API

Todas las rutas van detras del gateway, que verifica el token y pone la
identidad en `x-internal-user-id` y `x-internal-roles`. El servicio **no**
vuelve a verificar el JWT: confia en esas cabeceras porque el gateway las borra
de toda peticion entrante y porque exige el secreto compartido (SRS RNF24,
RNF25).

| Metodo | Ruta | Que hace |
|---|---|---|
| `GET` | `/api/v1/notifications` | La bandeja, paginada |
| `GET` | `/api/v1/notifications/unread-count` | Cuantos sin leer |
| `POST` | `/api/v1/notifications/read-all` | Marca todo como leido |
| `POST` | `/api/v1/notifications/:id/read` | Marca uno como leido |

Mas `GET /health` y `GET /metrics`, que no forman parte del API publica y por eso
quedan fuera del contrato OpenAPI.

## Lo demas

- [data-model.md](data-model.md) — su esquema y sus replicas
- [events.md](events.md) — que publica y que escucha
- [decisions.md](decisions.md) — por que esta hecho asi
- [runbook.md](runbook.md) — como se arranca y donde mirar cuando falla
