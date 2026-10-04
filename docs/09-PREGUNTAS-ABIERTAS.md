# Preguntas abiertas — Punto Amigo

El registro que `15-project-control/README.md` prescribe y que **no existía**.
Las doce preguntas vienen de `srs-microservices.md` §11, con sus identificadores
originales `O-01` a `O-12`.

- Fecha: **4 de octubre de 2026**
- Formato: el que pide la gobernanza — pregunta, contexto, para qué hace falta,
  quién responde, estado
- **Siete de las doce ya estaban contestadas por el código o por una ADR
  aceptada, y nadie había cerrado la pregunta.** Eso era el trabajo: cerrar el
  registro, no volver a diseñar el sistema
- Cinco estaban marcadas `Blocking: Yes` en el SRS. De esas cinco, **cuatro
  quedan cerradas aquí**

---

## Cerradas

| # | Pregunta | Respuesta | Fecha | Dónde está la prueba |
|---|---|---|---|---|
| O-01 | ¿Se adopta la arquitectura de microservicios? *(bloqueante)* | **Sí.** ADR-003 aceptada | 30/09/2026 | Ocho servicios y un gateway en `services/`. La ficha `service-catalog.md` todavía los marca como *Planned*: es TD-011 |
| O-02 | ¿Base por servicio en una instancia MySQL compartida con esquemas separados, o instancias separadas? *(bloqueante)* | **Una instancia, siete esquemas aislados**, con un usuario MySQL por servicio y privilegio mínimo sobre su propio esquema. ADR-004 | 30/09/2026 | `db/init/01-schemas-and-users.sh` y la prueba de aislamiento que ejecuta: siete esquemas, siete usuarios, aislamiento verificado en cada arranque |
| O-03 | ¿RabbitMQ o Kafka? *(bloqueante)* | **RabbitMQ**, intercambio *topic* duradero `punto-amigo.events`. ADR-005 | 30/09/2026 | `packages/messaging/`, [07-GRAFO-DE-EVENTOS.md](07-GRAFO-DE-EVENTOS.md) |
| O-04 | ¿Caducidad del access token y vida del refresco? *(bloqueante)* | **Access 900 s, refresco 604.800 s, enlace de recuperación 1.800 s de un solo uso, y la lista de denegación caduca cuando caduca el access token** | 4/10/2026 | [05-OBSERVABILIDAD.md](05-OBSERVABILIDAD.md) §5, con prueba de regresión que falla con el valor anterior |
| O-05 | ¿Se añade `CANCELADA` al objeto de valor `RequestStatus`? *(bloqueante)* | **Sí, y ya está en el código**: una solicitud puede cancelarse, la cancelación alimenta la tasa, y hay un umbral que emite `CancellationThresholdReached` | antes del 30/09/2026 | `services/request-service/src/domain/`. Falta corregirlo en `02-domain/entities-and-rules.md`, que es trabajo de la Fase 9 |
| O-10 | ¿Mecanismo de autenticación entre servicios: secreto compartido, mTLS o JWT interno? *(bloqueante)* | **Secreto compartido en local**, comparado en tiempo constante y exigido en toda ruta que no sea `/health` ni `/metrics`. Decisión T-04. **El mecanismo de producción sigue abierto** y depende de la nube: queda dentro de AT-001 | 30/09/2026 (local) | `requireInternalCaller` en `packages/service-kit/src/http.ts` |
| O-12 | ¿Entran al MVP canales de notificación más allá de la bandeja intraaplicación? | **No.** Push y correo de producto descartados; solo sobrevive el **correo transaccional** de recuperación de contraseña | 3/10/2026 | [02-DECISIONES.md](02-DECISIONES.md) §2 y §4 |

## Abiertas

| # | Pregunta | Contexto | Hace falta para | Quién responde | Estado |
|---|---|---|---|---|---|
| O-06 | Asignar códigos RF a HU-009, HU-013, HU-016, HU-017, HU-019, HU-020, HU-021, HU-023 y HU-029 | Nueve historias de usuario sin requisito funcional asociado. La matriz de trazabilidad declara literalmente una brecha de «implementación sin HU/RF» | Cerrar la trazabilidad (TD-013) y el Go/No-Go | Equipo, sobre el SRS | 🟡 Abierta · trabajo de documentación, sin decisión de producto |
| O-07 | Crear una historia de usuario para RF8.1 o eliminar el requisito | Un requisito funcional sin historia: o sobra el requisito o falta la historia | Lo mismo que O-06 | **Tú**: es alcance de producto | 🔴 Sin responder |
| O-08 | Objetivo de carga representativo, en peticiones por segundo | La estrategia de pruebas fija el P95 y la tasa de error, pero **no a qué carga**. La prueba de la Fase 8 eligió 90 peticiones/s y dio P95 de 6,98 ms; es un valor de trabajo, no un objetivo acordado | Que AT-007 signifique algo frente a una expectativa real de uso | **Tú** | 🟡 Abierta · hay una propuesta medida: 90 peticiones/s sostenidas, con margen de sobra |
| O-09 | Periodo de retención de respaldos y RTO | El runbook describe el procedimiento y la restauración está probada, pero cuánto se guarda y en cuánto hay que volver a estar en pie depende de dónde viva | Cerrar la operación de producción | **Tú**, después de AT-001 | 🔴 Bloqueada por AT-001 |
| O-11 | Reconciliar `09-microservices/services/02-auth-service/` con la pila real *(bloqueante)* | Ese documento especifica **PostgreSQL, Redis y puerto 8081**; el SRS, `06-data/models.md` y el código dicen **MySQL y puerto 3001** | Que la documentación de servicio no contradiga al sistema | Equipo | 🟡 Abierta · **la respuesta no tiene duda, manda el código**; lo que falta es corregir el documento, que vive en el repositorio congelado. Es TD-002 en cuanto se decida AT-003 |

## Lo que este registro deja a la vista

Cuatro de las cinco preguntas bloqueantes llevaban meses contestadas por el
código. La quinta, O-11, tiene respuesta evidente y lo que le falta es un
documento corregido en otro repositorio.

Eso no es un problema de diseño, es de registro: **el sistema avanzó y el
cuaderno no**. Y tiene consecuencia práctica, porque el Go/No-Go de la Fase 10
exige revisar las preguntas abiertas: con el registro sin cerrar, la revisión
habría mirado cinco bloqueantes que ya no bloqueaban nada y habría pasado por
encima de las que sí —O-08 y O-09— que son decisiones reales sin tomar.

## Cómo se cierra una

1. Se escribe la respuesta **con dónde está la prueba**: un archivo, una prueba
   o una ADR. Una respuesta sin prueba vuelve a abrirse en seis semanas.
2. Si la respuesta es arquitectónica, se convierte en ADR en
   `05-architecture/decisions/`; si es de producto, en
   [02-DECISIONES.md](02-DECISIONES.md).
3. Si el código ya la contesta pero un documento dice lo contrario, la pregunta
   **no está cerrada**: queda abierta hasta que el documento se corrija. Es
   exactamente el caso de O-11.
