# Los nueve procesos — índice

Un documento por servicio, con la misma estructura que pide
`09-microservices/_template/service/`: responsabilidad y API, modelo de datos,
eventos, decisiones y runbook.

- Fecha: **4 de octubre de 2026** (Fase 9)
- Cierra: los **seis servicios sin documentación** del grupo H del
  [backlog](../01-BACKLOG.md)
- Extraído del código: rutas de cada `app.ts`, tablas de `information_schema`,
  eventos de los `EventName.*` de cada caso de uso, puertos de los esquemas Zod

---

## El catálogo

| # | Servicio | Puerto | Esquema | Documentación |
|---|---|---|---|---|
| 01 | api-gateway | 8080 · **publicado** | — (Redis para la lista de denegación) | `friend-point-docs/09-microservices/services/01-api-gateway/` |
| 02 | auth-service | 3001 | `pa_auth` | `friend-point-docs/09-microservices/services/02-auth-service/` · **contradice al código**: ver abajo |
| 03 | [provider-service](03-provider-service/README.md) | 3002 | `pa_provider` | aquí |
| 04 | [catalog-service](04-catalog-service/README.md) | 3003 | `pa_catalog` | aquí |
| 05 | [request-service](05-request-service/README.md) | 3004 | `pa_request` | aquí |
| 06 | [rating-service](06-rating-service/README.md) | 3005 | `pa_rating` | aquí |
| 07 | [notification-service](07-notification-service/README.md) | 3006 | `pa_notification` | aquí |
| 08 | [admin-reporting-service](08-admin-reporting-service/README.md) | 3007 | `pa_admin` | aquí |

**Solo el gateway publica su puerto** (SRS-GW-01, RNF25). Los ocho de dentro
solo son alcanzables desde la red interna de Docker, y exigen además el secreto
compartido en toda ruta que no sea `/health` ni `/metrics`.

## Dos avisos sobre la documentación que ya existía

### `02-auth-service` declara una pila que no es la del sistema

Ese documento especifica **PostgreSQL, Redis y puerto 8081**. El código usa
**MySQL y el puerto 3001**, y el SRS dice lo mismo que el código. Está registrado
como pregunta abierta bloqueante **O-11**
([09-PREGUNTAS-ABIERTAS.md](../09-PREGUNTAS-ABIERTAS.md)): la respuesta no tiene
duda —manda el código—, lo que falta es corregir el documento, que vive en el
repositorio congelado.

### La ficha del catálogo marca los ocho servicios como *Planned*

`09-microservices/service-catalog.md` §Service registry los da por 🔴 *Planned*
y lo justifica con que «la arquitectura de microservicios no ha sido aprobada
todavía». Los tres ADRs están aceptados desde el 30/09/2026 y los nueve procesos
corren. Es **TD-011** en el [backlog técnico](../08-BACKLOG-TECNICO.md).

## Lo que no se repite en cada documento

Lo común a los nueve está en dos sitios, para no copiarlo nueve veces:

| Qué | Dónde |
|---|---|
| Quién publica cada evento y quién lo escucha, y qué hacer cuando algo no llega | [07-GRAFO-DE-EVENTOS.md](../07-GRAFO-DE-EVENTOS.md) |
| Registro con `correlation_id`, métricas, paneles, carga y caducidad de tokens | [05-OBSERVABILIDAD.md](../05-OBSERVABILIDAD.md) |
| Respaldo y restauración de los siete esquemas | [03-RUNBOOK-RESPALDOS.md](../03-RUNBOOK-RESPALDOS.md) |
| Qué datos personales guarda cada uno | [04-POLITICA-DATOS-PERSONALES.md](../04-POLITICA-DATOS-PERSONALES.md) |
| Entornos, guardias de producción y lo que falta para desplegar | [06-ENTORNOS-Y-DESPLIEGUE.md](../06-ENTORNOS-Y-DESPLIEGUE.md) |

## Por qué están aquí y no en el repositorio de documentación

Porque `friend-point-docs` está congelado desde el 30/09/2026 y la organización
de los dos repositorios es una decisión sin tomar: **AT-003**. Mientras no se
tome, estos documentos viven junto al código que describen, que es lo que hace
más probable que se actualicen con él.
