# admin-reporting-service

> Documentacion extraida del codigo el **4 de octubre de 2026** (Fase 9). Cuando
> este documento y el codigo no coincidan, manda el codigo: evitar esa deriva es
> justamente para lo que sirve tener esto escrito.
>
> Vive en el repositorio de codigo y no en `09-microservices/services/`, que es
> donde `00-sdd-guide.md` lo pediria. Es la misma decision pendiente que el resto
> de los documentos de entrega: **AT-003**.

## Responsabilidad

Es el dueno de la auditoria y de los informes: registra lo que hacen los administradores, guarda los parametros del sistema y calcula las series que alimentan los informes.

| Campo | Valor |
|---|---|
| Numero en el catalogo | 08 |
| Puerto interno | 3007 · **no se publica** |
| Esquema propio | `pa_admin`, con su usuario MySQL y privilegio minimo |
| Alcanzable desde | solo el gateway, con `x-internal-secret` |
| Casos de uso | `RecordAuditTrail` · `QueryAuditTrail` · `ManageReports` · `CalculateStatistics` |

## Lo que hace

- Registra en auditoria los eventos administrativos que escucha
- Sirve la consulta de auditoria, con filtros · ADMINISTRADOR
- Informes de actividad, metricas y series temporales
- Lectura y escritura de los parametros del sistema
- Consulta del registro de respaldos, con su ultima restauracion probada
- Recalcula las series cada `STATS_SWEEP_MS` (una hora por omision)

## Lo que NO hace

- No modera contenido todavia: la tabla existe, el flujo no
- No ejecuta respaldos: los lee. El que respalda es `db/respaldo.sh`
- No escribe en los esquemas de los demas: lo que necesita, lo recibe por eventos

## API

Todas las rutas van detras del gateway, que verifica el token y pone la
identidad en `x-internal-user-id` y `x-internal-roles`. El servicio **no**
vuelve a verificar el JWT: confia en esas cabeceras porque el gateway las borra
de toda peticion entrante y porque exige el secreto compartido (SRS RNF24,
RNF25).

| Metodo | Ruta | Que hace |
|---|---|---|
| `GET` | `/api/v1/admin/audit` | La auditoria, con filtros · ADMINISTRADOR |
| `GET` | `/api/v1/admin/reports/activity` | Informe de actividad · ADMINISTRADOR |
| `GET` | `/api/v1/admin/reports/metrics` | Metricas agregadas · ADMINISTRADOR |
| `GET` | `/api/v1/admin/reports/series` | Series temporales · ADMINISTRADOR |
| `GET` | `/api/v1/admin/backups` | Los respaldos registrados · ADMINISTRADOR |
| `GET` | `/api/v1/admin/parameters` | Los parametros del sistema · ADMINISTRADOR |
| `GET` | `/api/v1/admin/parameters/:clave` | Uno concreto · ADMINISTRADOR |
| `PUT` | `/api/v1/admin/parameters` | Cambia un parametro · ADMINISTRADOR |

Mas `GET /health` y `GET /metrics`, que no forman parte del API publica y por eso
quedan fuera del contrato OpenAPI.

## Lo demas

- [data-model.md](data-model.md) — su esquema y sus replicas
- [events.md](events.md) — que publica y que escucha
- [decisions.md](decisions.md) — por que esta hecho asi
- [runbook.md](runbook.md) — como se arranca y donde mirar cuando falla
