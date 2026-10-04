# Matriz de trazabilidad — Punto Amigo

Qué requisito del SRS toca qué código, y cuál de ellos tiene además una prueba
que lo nombre.

- Fecha: **4 de octubre de 2026** (Fase 9)
- Requisitos: `friend-point-docs/04-requirements/srs-punto-amigo-es.md`, que es
  el catálogo real: **193 RF y 89 RNF**
- Reemplaza a `04-requirements/traceability-matrix.md`, que usa identificadores
  (`RF1.1`, `NFR-001`) que **no existen** en ese SRS, tiene doce capítulos en *To
  be defined* y declara ocho brechas abiertas. Es el pendiente **TD-013**

---

## 1. Cómo se construyó, y qué vale

Se extrajo del código, no de una planilla: cada archivo del repositorio que
nombra un requisito en un comentario queda registrado aquí, y se separa si esa
cita está en código fuente o en una prueba.

**Lo que esto prueba y lo que no.** Una cita en un comentario es evidencia de
*intención*: alguien escribió ese código pensando en ese requisito. No prueba que
el requisito esté cumplido. La columna «¿Prueba?» es la señal fuerte: ahí hay una
comprobación que corre en cada `npm run verify` y que falla si el comportamiento
cambia.

Se construye así a propósito. Una matriz mantenida a mano se desincroniza en la
primera semana —la que este documento reemplaza es la demostración— mientras que
una cita en el código viaja con el código que la justifica.

## 2. Resumen

| Medida | Valor |
|---|---|
| Requisitos del SRS | 282 (193 RF + 89 RNF) |
| Citados por el código | **164** · 58 % |
| RF citados | 139 de 193 · 72 % |
| RNF citados | 25 de 89 · 28 % |
| Con una prueba que los nombre | **57** · 35 % de los citados |
| Citas a identificadores que no están en el SRS | 0 |

Dos lecturas que conviene no mezclar:

- **La cobertura de RF es alta y la de RNF baja**, y en buena parte es esperable:
  muchos requisitos no funcionales hablan de proceso, documentación, capacitación
  o despliegue, y no se implementan en una función. Los que sí son de código
  —aislamiento de esquemas, límite de peticiones, registro con identificador de
  correlación, idempotencia— están citados.
- **107 requisitos citados no tienen ninguna prueba que los nombre.** No
  significa que no estén probados: significa que, si alguien rompe ese
  comportamiento, ninguna prueba va a decir qué requisito se llevó por delante.

## 3. Requisitos funcionales con trazabilidad

| ID | Requisito | Prioridad | Dónde está | ¿Prueba? |
|---|---|---|---|---|
| `RF1` | El sistema debe permitir a una persona registrarse creando una cuenta con nombre, correo electrónico, contraseña y teléfono. | Alta | `db/migrations/auth/20260930000100_identity.js`, `services/auth-service/src/application/use-cases/RegisterUser.ts`, `services/auth-service/src/domain/value-objects/Email.ts` | — |
| `RF3` | El sistema debe exigir la confirmación de la contraseña durante el registro y rechazar el registro si ambas no coinciden. | Alta | `services/auth-service/src/domain/value-objects/PlainPassword.ts` | — |
| `RF4` | El sistema debe rechazar el registro cuando el correo electrónico ya se encuentre asociado a una cuenta existente. | Alta | `db/migrations/auth/20260930000100_identity.js`, `services/auth-service/src/domain/value-objects/Email.ts` | — |
| `RF5` | El sistema debe almacenar las contraseñas protegidas mediante bcrypt o Argon2id y nunca en texto plano. | Alta | `db/migrations/auth/20260930000100_identity.js`, `services/auth-service/src/application/use-cases/RegisterUser.ts`, `services/auth-service/src/domain/value-objects/PlainPassword.ts` | — |
| `RF6` | El sistema debe permitir a un usuario registrado iniciar sesión con sus credenciales. | Alta | `db/migrations/auth/20260930000200_sessions_and_lockout.js`, `services/auth-service/src/application/use-cases/AuthenticateUser.ts` | — |
| `RF7` | El sistema debe emitir un token de acceso JWT y un token de renovación al autenticar correctamente a un usuario. | Alta | `services/auth-service/src/infrastructure/security/JwtTokenService.ts` | — |
| `RF8` | El sistema debe permitir renovar el token de acceso mediante el token de renovación vigente. | Alta | `services/auth-service/src/application/use-cases/RefreshSession.ts`, `services/auth-service/src/infrastructure/persistence/KnexSessionRepository.ts`, `services/auth-service/src/infrastructure/security/JwtTokenService.ts` | — |
| `RF9` | El sistema debe rechazar las credenciales inválidas con un mensaje que no revele si el correo está registrado. | Alta | `packages/shared/src/errors/app-error.ts`, `services/auth-service/src/application/use-cases/AuthenticateUser.ts` | — |
| `RF10` | El sistema debe permitir al usuario cerrar su sesión e invalidar el token de renovación correspondiente. | Alta | `db/migrations/auth/20260930000200_sessions_and_lockout.js`, `packages/service-kit/src/http.ts`, `services/api-gateway/src/security/TokenVerifier.ts` · +2 | — |
| `RF11` | El sistema debe expirar las sesiones inactivas transcurrido el periodo de inactividad configurado. | Alta | `services/auth-service/src/infrastructure/persistence/KnexSessionRepository.ts` | — |
| `RF12` | El sistema debe permitir a un usuario iniciar el proceso de recuperación de contraseña desde su correo registrado. | Alta | `apps/web/src/api/esquemas.ts`, `apps/web/src/api/hooks.ts`, `apps/web/src/paginas/Recuperar.tsx` · +1 | — |
| `RF13` | El sistema debe emitir un token de recuperación de un solo uso y con vigencia limitada. | Alta | `apps/web/src/api/hooks.ts`, `apps/web/src/paginas/Restablecer.tsx`, `db/migrations/auth/20260930000200_sessions_and_lockout.js` · +1 | — |
| `RF14` | El sistema debe rechazar un token de recuperación vencido o ya utilizado e informar que el mecanismo ya no es válido. | Alta | `db/migrations/auth/20260930000200_sessions_and_lockout.js`, `db/migrations/auth/20260930000300_outbox.js`, `services/auth-service/src/application/use-cases/PasswordRecovery.ts` | — |
| `RF15` | El sistema debe permitir a los administradores asignar a un usuario los roles Administrador, Oferente o Solicitante. | Alta | `db/migrations/auth/20260930000100_identity.js`, `services/auth-service/src/application/use-cases/ManageAccounts.ts` | — |
| `RF19` | El sistema debe permitir a cada usuario consultar y modificar la información de su propia cuenta. | Alta | `db/migrations/auth/20260930000100_identity.js`, `services/auth-service/src/application/use-cases/ManageAccounts.ts` | — |
| `RF20` | El sistema debe registrar los eventos de autenticación, incluyendo los inicios de sesión exitosos y los intentos fallidos. | Alta | `db/migrations/auth/20260930000200_sessions_and_lockout.js`, `db/migrations/auth/20260930000300_outbox.js`, `services/auth-service/src/application/use-cases/AuthenticateUser.ts` · +1 | — |
| `RF22` | El sistema debe permitir a un usuario con rol Oferente crear su perfil de prestador indicando nombre, especialidad, teléfono, correo y disponibilidad. | Alta | `apps/web/src/paginas/MiPerfilPrestador.tsx`, `db/migrations/provider/20260930000100_provider.js`, `services/provider-service/src/application/use-cases/ManageProviderProfile.ts` · +2 | — |
| `RF23` | El sistema debe garantizar que un usuario tenga como máximo un perfil de prestador. | Alta | `db/migrations/provider/20260930000100_provider.js`, `services/provider-service/src/application/use-cases/ManageProviderProfile.ts`, `services/provider-service/src/domain/index.ts` · +1 | — |
| `RF24` | El sistema debe asignar al perfil recién creado el estado Pendiente de validación. | Alta | `db/migrations/provider/20260930000100_provider.js`, `services/provider-service/src/application/use-cases/ManageProviderProfile.ts`, `services/provider-service/src/domain/index.ts` | — |
| `RF25` | El sistema debe impedir que un perfil pendiente de validación sea visible públicamente. | Alta | `db/migrations/provider/20260930000100_provider.js`, `services/provider-service/src/application/use-cases/ManageProviderProfile.ts`, `services/provider-service/src/domain/index.ts` | sí |
| `RF26` | El sistema debe permitir a los administradores validar un perfil de prestador, registrando quién realizó la acción y cuándo. | Alta | `apps/web/src/paginas/Administracion.tsx`, `db/migrations/provider/20260930000100_provider.js`, `services/provider-service/src/application/use-cases/ManageProviderProfile.ts` · +3 | sí |
| `RF27` | El sistema debe permitir a los administradores rechazar un perfil de prestador indicando el motivo. | Alta | `apps/web/src/paginas/Administracion.tsx`, `db/migrations/provider/20260930000100_provider.js`, `services/provider-service/src/application/use-cases/ReviewProviderProfile.ts` · +2 | sí |
| `RF28` | El sistema debe permitir a un Oferente modificar su propio perfil y denegar la modificación del perfil de otro usuario. | Alta | `apps/web/src/paginas/MiPerfilPrestador.tsx`, `services/provider-service/src/application/use-cases/ManageProviderProfile.ts`, `services/provider-service/src/domain/index.ts` | sí |
| `RF29` | El sistema debe gestionar los estados del perfil de prestador: Pendiente de validación, Activo, Suspendido e Inactivo. | Alta | `services/admin-reporting-service/src/application/use-cases/RecordAuditTrail.ts`, `services/catalog-service/src/application/use-cases/SyncProviderRef.ts`, `services/provider-service/src/application/use-cases/ManageProviderProfile.ts` · +3 | sí |
| `RF30` | El sistema debe rechazar cualquier transición de estado del perfil que no esté contemplada en el modelo de estados. | Alta | `services/catalog-service/src/application/use-cases/SyncProviderRef.ts`, `services/provider-service/src/application/use-cases/ReviewProviderProfile.ts`, `services/provider-service/src/domain/index.ts` | sí |
| `RF31` | El sistema debe permitir consultar la información pública de un prestador validado. | Alta | `services/api-gateway/src/config/routes.ts`, `services/notification-service/src/domain/index.ts`, `services/provider-service/src/domain/index.ts` · +1 | sí |
| `RF32` | El sistema debe suspender el perfil de prestador cuando la cuenta de usuario asociada sea suspendida. | Media | `db/migrations/provider/20260930000100_provider.js`, `services/catalog-service/src/application/use-cases/SyncProviderRef.ts`, `services/provider-service/src/application/use-cases/SyncAccountState.ts` · +2 | sí |
| `RF33` | El sistema debe permitir a un Oferente validado publicar un servicio indicando nombre, descripción y categoría. | Alta | `db/migrations/catalog/20260930000100_catalog.js`, `services/catalog-service/src/application/use-cases/ManageServiceCatalog.ts`, `services/catalog-service/src/domain/index.ts` | — |
| `RF34` | El sistema debe rechazar la publicación de un servicio cuando el perfil del prestador no se encuentre en estado Activo. | Alta | `services/catalog-service/src/application/use-cases/ManageServiceCatalog.ts`, `services/catalog-service/src/domain/index.ts` | sí |
| `RF35` | El sistema debe permitir al Oferente propietario modificar la información de sus propios servicios. | Alta | `services/catalog-service/src/application/use-cases/ManageServiceCatalog.ts` | — |
| `RF36` | El sistema debe denegar la modificación de un servicio a cualquier usuario que no sea su propietario ni administrador. | Alta | `services/catalog-service/src/application/use-cases/ManageServiceCatalog.ts`, `services/catalog-service/src/domain/index.ts` | — |
| `RF37` | El sistema debe permitir al Oferente propietario activar y desactivar sus servicios. | Alta | `services/catalog-service/src/application/use-cases/ManageServiceCatalog.ts` | — |
| `RF38` | El sistema debe excluir los servicios inactivos de los resultados de búsqueda pública. | Alta | `services/catalog-service/src/application/use-cases/ManageServiceCatalog.ts` | — |
| `RF40` | El sistema debe permitir a los administradores crear categorías de servicio. | Alta | — | sí |
| `RF41` | El sistema debe permitir a los administradores modificar las categorías de servicio registradas. | Alta | — | sí |
| `RF42` | El sistema debe garantizar que el nombre de cada categoría sea único. | Alta | `db/migrations/catalog/20260930000100_catalog.js`, `services/catalog-service/src/application/use-cases/ManageCategories.ts`, `services/catalog-service/src/infrastructure/persistence/KnexCategoriaRepository.ts` | — |
| `RF43` | El sistema debe impedir la eliminación de una categoría que tenga servicios activos asociados. | Alta | `db/migrations/catalog/20260930000100_catalog.js`, `services/catalog-service/src/application/use-cases/ManageCategories.ts`, `services/catalog-service/src/domain/index.ts` | sí |
| `RF44` | El sistema debe permitir consultar el catálogo de categorías disponibles. | Alta | `services/catalog-service/src/application/use-cases/ManageCategories.ts`, `services/catalog-service/src/infrastructure/persistence/KnexCategoriaRepository.ts` | sí |
| `RF45` | El sistema debe permitir buscar servicios activos mediante texto libre sobre el nombre y la descripción. | Alta | `db/migrations/catalog/20260930000100_catalog.js`, `services/api-gateway/src/config/routes.ts`, `services/catalog-service/src/application/use-cases/SearchCatalog.ts` · +3 | sí |
| `RF49` | El sistema debe limitar el tamaño máximo de página en los listados para acotar el costo de la respuesta. | Media | `services/catalog-service/src/application/use-cases/SearchCatalog.ts`, `services/catalog-service/src/domain/index.ts`, `services/catalog-service/src/infrastructure/http/app.ts` · +1 | — |
| `RF50` | El sistema debe mostrar un mensaje explícito cuando ningún servicio coincida con los criterios de búsqueda. | Alta | `apps/web/src/paginas/MiPerfilPrestador.tsx`, `services/catalog-service/src/application/use-cases/SearchCatalog.ts` | — |
| `RF51` | El sistema debe permitir consultar el detalle completo de un servicio, incluida su categoría y su prestador. | Alta | `services/catalog-service/src/infrastructure/http/app.ts` | — |
| `RF52` | El sistema debe permitir consultar la lista de servicios activos de un prestador determinado. | Alta | `apps/web/src/paginas/MiPerfilPrestador.tsx`, `db/migrations/catalog/20260930000100_catalog.js`, `services/catalog-service/src/application/ports.ts` · +2 | sí |
| `RF53` | El sistema debe mostrar la calificación promedio y el número de calificaciones de cada servicio. | Media | `db/migrations/catalog/20260930000100_catalog.js`, `services/catalog-service/src/application/ports.ts`, `services/catalog-service/src/application/use-cases/SearchCatalog.ts` · +4 | sí |
| `RF54` | El sistema debe permitir a un Solicitante autenticado crear una solicitud directa sobre un servicio publicado. | Alta | `db/migrations/request/20260930000200_service_requests.js`, `services/request-service/src/domain/index.ts` | — |
| `RF60` | El sistema debe permitir al Oferente consultar las solicitudes recibidas para sus propios servicios, filtradas por estado. | Alta | `db/migrations/request/20260930000200_service_requests.js`, `services/request-service/src/application/use-cases/ManageRequests.ts`, `services/request-service/src/infrastructure/http/app.ts` | sí |
| `RF61` | El sistema debe permitir al Solicitante consultar sus propias solicitudes y su estado actual. | Alta | `db/migrations/request/20260930000200_service_requests.js` | — |
| `RF62` | El sistema debe permitir al Oferente destinatario aceptar una solicitud en estado Pendiente. | Alta | `services/request-service/src/application/use-cases/ManageRequests.ts` | — |
| `RF66` | El sistema debe rechazar toda transición de estado no permitida e informar las transiciones válidas. | Alta | `services/request-service/src/application/use-cases/ManageRequests.ts` | — |
| `RF68` | El sistema debe tratar como duplicada una petición de creación que repita una clave de idempotencia ya procesada y devolver el resultado original. | Media | `db/migrations/request/20260930000200_service_requests.js` | — |
| `RF70` | El sistema debe cancelar automáticamente las solicitudes pendientes de un servicio cuando dicho servicio sea desactivado. | Media | `db/migrations/request/20260930000200_service_requests.js`, `services/request-service/src/application/use-cases/ManageRequests.ts`, `services/request-service/src/domain/index.ts` · +2 | sí |
| `RF71` | El sistema debe registrar una entrada de historial por cada cambio de estado de una solicitud. | Alta | `db/migrations/request/20260930000200_service_requests.js` | — |
| `RF74` | El sistema debe escribir la entrada de historial dentro de la misma transacción en que se aplica el cambio de estado. | Alta | `db/migrations/request/20260930000200_service_requests.js` | — |
| `RF77` | El sistema no debe permitir la modificación ni la eliminación de las entradas de historial ya registradas. | Alta | `db/migrations/request/20260930000200_service_requests.js`, `services/request-service/src/domain/index.ts` | — |
| `RF78` | El sistema debe permitir a un Solicitante calificar al Oferente y el servicio recibido cuando la solicitud haya sido finalizada. | Media | `db/migrations/rating/20260930000100_ratings.js`, `services/rating-service/src/application/use-cases/SubmitRating.ts`, `services/rating-service/src/domain/index.ts` · +1 | sí |
| `RF80` | El sistema debe permitir acompañar la calificación con un comentario opcional. | Media | `services/rating-service/src/domain/index.ts` | — |
| `RF81` | El sistema debe verificar que exista una solicitud completada entre ambas partes antes de aceptar la calificación. | Media | `db/migrations/rating/20260930000100_ratings.js`, `services/rating-service/src/domain/index.ts` | sí |
| `RF82` | El sistema debe permitir como máximo una calificación por parte y por solicitud de servicio finalizada. | Media | `db/migrations/rating/20260930000100_ratings.js`, `db/verify-invariants.sh`, `services/rating-service/src/application/use-cases/SubmitRating.ts` · +2 | sí |
| `RF83` | El sistema debe permitir consultar públicamente las calificaciones y el promedio de un servicio. | Media | `db/migrations/rating/20260930000100_ratings.js`, `services/rating-service/src/application/use-cases/QueryReputation.ts`, `services/rating-service/src/domain/index.ts` · +1 | sí |
| `RF84` | El sistema debe recalcular el promedio de calificación del servicio cuando se registre una nueva calificación. | Media | `db/migrations/catalog/20260930000100_catalog.js`, `services/catalog-service/src/application/ports.ts`, `services/catalog-service/src/application/use-cases/SyncRatingSummary.ts` · +4 | sí |
| `RF85` | El sistema debe permitir a los administradores ocultar una calificación cuyo comentario sea reportado como inapropiado. | Baja | `db/migrations/rating/20260930000100_ratings.js`, `services/rating-service/src/application/use-cases/QueryReputation.ts`, `services/rating-service/src/domain/index.ts` · +1 | sí |
| `RF86` | El sistema debe generar una notificación dirigida al Oferente cuando reciba una nueva solicitud de servicio. | Alta | `db/migrations/notification/20260930000100_notifications.js`, `services/notification-service/src/domain/index.ts` | — |
| `RF87` | El sistema debe generar una notificación dirigida al Solicitante cuando su solicitud sea aceptada o rechazada. | Alta | `services/notification-service/src/domain/index.ts` | — |
| `RF88` | El sistema debe generar una notificación dirigida al Solicitante cuando su solicitud sea marcada como finalizada. | Alta | `services/notification-service/src/domain/index.ts` | — |
| `RF89` | El sistema debe generar una notificación de bienvenida cuando se registre un nuevo usuario. | Media | `services/auth-service/src/application/use-cases/RegisterUser.ts` | — |
| `RF90` | El sistema debe generar una notificación dirigida al Oferente cuando su perfil de prestador sea validado. | Media | `services/notification-service/src/application/use-cases/CreateFromEvent.ts` | — |
| `RF91` | El sistema debe gestionar los estados No leída y Leída para cada notificación. | Alta | `services/notification-service/src/domain/index.ts` | — |
| `RF92` | El sistema debe permitir a un usuario marcar como leídas sus propias notificaciones. | Alta | `services/notification-service/src/application/use-cases/CreateFromEvent.ts`, `services/notification-service/src/domain/index.ts` | — |
| `RF93` | El sistema debe permitir a cada usuario consultar únicamente sus propias notificaciones, con paginación y contador de no leídas. | Alta | `apps/web/src/paginas/Avisos.tsx`, `services/notification-service/src/application/use-cases/ManageInbox.ts`, `services/notification-service/src/domain/index.ts` | sí |
| `RF94` | El sistema debe entregar notificaciones administrativas a los usuarios con rol Administrador ante eventos críticos. | Media | `services/notification-service/src/application/use-cases/ManageInbox.ts` | — |
| `RF95` | El sistema debe procesar cada evento una sola vez, descartando los eventos cuyo identificador ya haya sido procesado. | Alta | `apps/web/src/paginas/Avisos.tsx`, `db/helpers.js`, `db/migrations/notification/20260930000100_notifications.js` · +4 | sí |
| `RF96` | El sistema debe derivar a una cola de mensajes fallidos los eventos que no puedan procesarse tras agotar los reintentos configurados. | Alta | `db/migrations/notification/20260930000100_notifications.js`, `packages/messaging/src/broker.ts`, `services/notification-service/src/domain/index.ts` | — |
| `RF97` | El sistema debe permitir a los administradores consultar la lista de usuarios registrados y su estado. | Alta | `db/migrations/auth/20260930000100_identity.js`, `services/admin-reporting-service/src/application/use-cases/RecordAuditTrail.ts`, `services/auth-service/src/application/use-cases/ManageAccounts.ts` | — |
| `RF100` | El sistema debe permitir a los administradores eliminar lógicamente una cuenta de usuario conservando su historial. | Alta | `db/migrations/auth/20260930000100_identity.js`, `services/auth-service/src/application/use-cases/ManageAccounts.ts`, `services/auth-service/src/domain/entities/Usuario.ts` | — |
| `RF101` | El sistema debe registrar una entrada de auditoría por cada acción relevante, con fecha y hora, actor, acción, recurso afectado y resultado. | Alta | `apps/web/src/paginas/Administracion.tsx`, `db/migrations/admin/20260930000100_audit_and_reporting.js`, `services/admin-reporting-service/src/application/use-cases/RecordAuditTrail.ts` · +4 | sí |
| `RF102` | El sistema debe permitir a los administradores consultar y filtrar los registros de auditoría por rango de fechas, actor, tipo de acción y recurso. | Alta | `db/migrations/admin/20260930000100_audit_and_reporting.js`, `services/admin-reporting-service/src/application/use-cases/QueryAuditTrail.ts`, `services/admin-reporting-service/src/domain/index.ts` | — |
| `RF103` | El sistema no debe exponer operaciones de modificación ni de eliminación sobre los registros de auditoría. | Alta | `apps/web/src/paginas/Administracion.tsx`, `db/migrations/admin/20260930000100_audit_and_reporting.js`, `db/verify-invariants.sh` · +3 | sí |
| `RF104` | El sistema debe permitir a los administradores marcar como inapropiado un servicio, una necesidad publicada, una propuesta, un perfil de prestador ... | Media | `db/migrations/admin/20260930000100_audit_and_reporting.js`, `services/catalog-service/src/domain/index.ts` | sí |
| `RF105` | El sistema debe permitir a los administradores gestionar los parámetros generales de configuración del sistema. | Baja | `apps/web/src/paginas/Administracion.tsx`, `db/migrations/admin/20260930000100_audit_and_reporting.js`, `services/admin-reporting-service/src/application/use-cases/ManageReports.ts` · +5 | sí |
| `RF106` | El sistema debe registrar la ejecución, el resultado y la ubicación de cada respaldo programado de la base de datos. | Alta | `db/migrations/admin/20260930000100_audit_and_reporting.js`, `services/admin-reporting-service/src/domain/index.ts`, `services/admin-reporting-service/src/infrastructure/persistence/KnexSupportRepositories.ts` | — |
| `RF107` | El sistema debe exponer el estado del procedimiento de restauración de respaldos para consulta de los administradores. | Alta | `db/migrations/admin/20260930000100_audit_and_reporting.js`, `services/admin-reporting-service/src/domain/index.ts`, `services/admin-reporting-service/src/infrastructure/persistence/KnexSupportRepositories.ts` | — |
| `RF108` | El sistema debe construir la información de auditoría exclusivamente a partir de los eventos consumidos, sin consultar la base de datos de otro mic... | Alta | `db/migrations/admin/20260930000100_audit_and_reporting.js`, `services/admin-reporting-service/src/application/use-cases/CalculateStatistics.ts`, `services/admin-reporting-service/src/application/use-cases/RecordAuditTrail.ts` · +1 | — |
| `RF109` | El sistema debe generar un reporte de usuarios registrados por rol y por estado. | Media | `db/migrations/admin/20260930000100_audit_and_reporting.js`, `services/admin-reporting-service/src/application/use-cases/CalculateStatistics.ts`, `services/admin-reporting-service/src/domain/index.ts` | — |
| `RF111` | El sistema debe generar un reporte de solicitudes de servicio agrupadas por estado. | Media | `db/migrations/request/20260930000200_service_requests.js` | — |
| `RF112` | El sistema debe generar un reporte de calificaciones registradas y de la puntuación promedio por servicio. | Media | `services/admin-reporting-service/src/application/use-cases/CalculateStatistics.ts`, `services/admin-reporting-service/src/domain/index.ts` | — |
| `RF113` | El sistema debe permitir acotar cualquier reporte mediante un rango de fechas seleccionable. | Media | `db/migrations/request/20260930000200_service_requests.js`, `services/admin-reporting-service/src/application/use-cases/CalculateStatistics.ts`, `services/admin-reporting-service/src/domain/index.ts` · +1 | sí |
| `RF115` | El sistema debe proporcionar una vista consolidada de la actividad de la plataforma y de los eventos relevantes del sistema. | Media | `db/migrations/admin/20260930000100_audit_and_reporting.js`, `services/admin-reporting-service/src/application/use-cases/ManageReports.ts`, `services/admin-reporting-service/src/domain/index.ts` | sí |
| `RF116` | El sistema debe emitir una alerta administrativa cuando se produzca una condición crítica configurada. | Media | `db/migrations/admin/20260930000100_audit_and_reporting.js`, `services/admin-reporting-service/src/domain/index.ts` | — |
| `RF117` | El sistema debe permitir a un Solicitante autenticado publicar una necesidad indicando título, descripción del trabajo requerido y categoría. | Alta | `db/migrations/request/20260930000100_needs_and_proposals.js`, `services/request-service/src/domain/index.ts` | — |
| `RF120` | El sistema debe asignar automáticamente el estado Abierta a toda necesidad recién publicada y registrar su fecha de publicación. | Alta | `services/request-service/src/application/use-cases/ManageNeeds.ts`, `services/request-service/src/infrastructure/http/app.ts` | sí |
| `RF121` | El sistema debe asignar a cada necesidad una fecha de vigencia y cerrarla automáticamente al vencer, impidiendo que reciba nuevas propuestas. | Alta | `db/migrations/request/20260930000100_needs_and_proposals.js` | — |
| `RF125` | El sistema debe limitar el número de necesidades simultáneamente abiertas por usuario, según el parámetro configurado. | Media | `db/migrations/request/20260930000100_needs_and_proposals.js`, `services/request-service/src/domain/index.ts`, `services/request-service/src/main.ts` | sí |
| `RF127` | El sistema debe gestionar los estados de la necesidad: Abierta, Adjudicada, Vencida, Cerrada y Cancelada. | Alta | `services/request-service/src/application/use-cases/ManageNeeds.ts` | — |
| `RF128` | El sistema debe rechazar cualquier transición de estado de la necesidad que no esté contemplada en el modelo de estados. | Alta | `services/request-service/src/application/use-cases/ManageNeeds.ts` | — |
| `RF130` | El sistema debe permitir a un Oferente con perfil validado consultar las necesidades en estado Abierta. | Alta | `db/migrations/request/20260930000100_needs_and_proposals.js`, `services/api-gateway/src/config/routes.ts`, `services/request-service/src/application/use-cases/ManageNeeds.ts` · +1 | — |
| `RF134` | El sistema debe excluir del listado público las necesidades adjudicadas, vencidas, cerradas o canceladas. | Alta | `db/migrations/request/20260930000100_needs_and_proposals.js` | — |
| `RF136` | El sistema no debe exponer los datos de contacto del Solicitante mientras la necesidad no haya sido adjudicada. | Alta | `services/api-gateway/src/config/routes.ts`, `services/request-service/src/application/use-cases/ManageNeeds.ts`, `services/request-service/src/domain/index.ts` · +1 | sí |
| `RF137` | El sistema debe permitir a un Oferente con perfil validado enviar una propuesta indicando precio, tiempo estimado y un mensaje. | Alta | `apps/web/src/paginas/Necesidad.tsx`, `services/request-service/src/application/use-cases/ManageProposals.ts`, `services/request-service/src/infrastructure/http/app.ts` | sí |
| `RF138` | El sistema debe permitir al Oferente asociar opcionalmente a su propuesta uno de sus servicios publicados. | Media | `apps/web/src/paginas/Necesidad.tsx`, `db/migrations/request/20260930000100_needs_and_proposals.js`, `services/request-service/src/application/use-cases/ManageProposals.ts` | — |
| `RF139` | El sistema debe permitir como máximo una propuesta vigente por Oferente y por necesidad. | Alta | `db/migrations/request/20260930000100_needs_and_proposals.js`, `db/verify-invariants.sh` | sí |
| `RF144` | El sistema debe permitir al Oferente retirar su propuesta mientras no haya sido adjudicada. | Media | `db/verify-invariants.sh`, `services/request-service/src/application/use-cases/ManageProposals.ts` | — |
| `RF145` | El sistema debe permitir al Oferente consultar las propuestas que ha enviado y su estado. | Alta | `apps/web/src/paginas/MisPropuestas.tsx`, `db/migrations/request/20260930000100_needs_and_proposals.js` | — |
| `RF146` | El sistema debe permitir al autor de la necesidad consultar las propuestas recibidas con el precio, el tiempo estimado, el mensaje y la reputación ... | Alta | `db/migrations/request/20260930000100_needs_and_proposals.js`, `services/request-service/src/application/use-cases/ManageProposals.ts`, `services/request-service/src/infrastructure/http/app.ts` | — |
| `RF148` | El sistema debe mostrar a cada Oferente únicamente su propia propuesta, sin revelarle las propuestas de los demás. | Alta | `services/request-service/src/application/use-cases/ManageProposals.ts`, `services/request-service/src/domain/index.ts`, `services/request-service/src/infrastructure/http/app.ts` | sí |
| `RF149` | El sistema debe gestionar los estados de la propuesta: Enviada, Aceptada, Rechazada, Retirada y Descartada. | Alta | `db/migrations/request/20260930000100_needs_and_proposals.js`, `services/request-service/src/application/use-cases/ManageRequests.ts` | sí |
| `RF150` | El sistema debe permitir al autor de la necesidad adjudicar una de las propuestas recibidas. | Alta | `db/migrations/request/20260930000200_service_requests.js` | — |
| `RF153` | El sistema debe registrar en cada solicitud de servicio su origen: Directa o Por adjudicación. | Alta | `services/request-service/src/application/use-cases/ManageRequests.ts`, `services/request-service/src/infrastructure/http/app.ts` | sí |
| `RF154` | El sistema debe permitir al autor de la necesidad rechazar explícitamente una propuesta sin adjudicar ninguna otra. | Media | `services/request-service/src/infrastructure/http/app.ts` | — |
| `RF156` | El sistema debe revelar los datos de contacto de ambas partes una vez efectuada la adjudicación. | Alta | `db/migrations/request/20261003000100_provider_ref_phone.js`, `services/notification-service/src/domain/index.ts`, `services/provider-service/src/domain/index.ts` · +4 | sí |
| `RF157` | El sistema debe descartar automáticamente las propuestas vigentes cuando su necesidad venza, se cierre o se cancele. | Alta | `services/request-service/src/application/use-cases/ManageRequests.ts`, `services/request-service/src/infrastructure/http/app.ts` | — |
| `RF158` | El sistema debe permitir a los administradores consultar las necesidades y las propuestas con fines de supervisión. | Media | `db/migrations/request/20260930000200_service_requests.js`, `services/request-service/src/domain/index.ts` | — |
| `RF159` | El sistema debe permitir que un mismo usuario tenga asignados simultáneamente los roles Solicitante y Oferente sobre una única cuenta. | Alta | `db/migrations/auth/20260930000100_identity.js`, `db/seeds/auth/01_roles_and_users.js`, `services/auth-service/src/domain/value-objects/UserRole.ts` | — |
| `RF160` | El sistema debe asignar por defecto el rol Solicitante a toda cuenta recién registrada. | Alta | `services/auth-service/src/application/use-cases/RegisterUser.ts`, `services/auth-service/src/domain/entities/Usuario.ts`, `services/auth-service/src/domain/value-objects/UserRole.ts` | — |
| `RF161` | El sistema debe permitir a un usuario solicitar la activación del rol Oferente desde su cuenta existente, sin necesidad de crear una cuenta adicional. | Alta | `services/admin-reporting-service/src/application/use-cases/RecordAuditTrail.ts`, `services/auth-service/src/application/use-cases/ManageAccounts.ts`, `services/auth-service/src/domain/entities/Usuario.ts` · +1 | — |
| `RF163` | El sistema debe ofrecer un conmutador de modo de uso a los usuarios que tengan ambos roles, que determine qué vista de la aplicación se presenta si... | Media | `db/migrations/auth/20260930000100_identity.js` | — |
| `RF164` | El sistema debe permitir al Oferente calificar al Solicitante una vez finalizada la solicitud de servicio. | Media | `db/migrations/rating/20260930000100_ratings.js`, `db/verify-invariants.sh`, `services/rating-service/src/application/use-cases/SubmitRating.ts` · +2 | sí |
| `RF165` | El sistema debe calcular y mantener la reputación de cada usuario de forma separada para su actuación como Oferente y como Solicitante. | Media | `apps/web/src/paginas/Contrataciones.tsx`, `apps/web/src/paginas/MiCuenta.tsx`, `db/migrations/rating/20260930000100_ratings.js` · +4 | sí |
| `RF166` | El sistema debe mantener ocultas las calificaciones de una solicitud hasta que ambas partes hayan calificado o hasta que venza el plazo establecido... | Media | `db/migrations/rating/20260930000100_ratings.js`, `services/rating-service/src/application/use-cases/SubmitRating.ts`, `services/rating-service/src/domain/index.ts` · +2 | sí |
| `RF167` | El sistema debe mostrar la reputación del Oferente en el listado de propuestas recibidas y la del Solicitante en el detalle de la necesidad. | Media | `db/migrations/rating/20260930000100_ratings.js`, `db/migrations/request/20260930000100_needs_and_proposals.js`, `services/rating-service/src/application/use-cases/QueryReputation.ts` · +2 | sí |
| `RF168` | El sistema debe generar una notificación dirigida al Solicitante cuando su necesidad reciba una nueva propuesta. | Alta | `db/migrations/notification/20260930000100_notifications.js`, `services/notification-service/src/domain/index.ts` | — |
| `RF170` | El sistema debe generar una notificación dirigida al Oferente cuando su propuesta sea descartada o rechazada. | Alta | `services/notification-service/src/domain/index.ts` | — |
| `RF171` | El sistema debe generar una notificación dirigida al Solicitante cuando su necesidad esté próxima a vencer sin haber sido adjudicada. | Media | `services/notification-service/src/domain/index.ts` | — |
| `RF172` | El sistema debe generar una notificación dirigida a los Oferentes cuya especialidad corresponda a la categoría de una necesidad recién publicada, s... | Media | `db/migrations/notification/20260930000100_notifications.js`, `db/migrations/provider/20260930000100_provider.js`, `services/notification-service/src/application/use-cases/CreateFromEvent.ts` · +2 | — |
| `RF173` | El sistema debe permitir a cada usuario configurar qué notificaciones desea recibir. | Media | `db/migrations/notification/20260930000100_notifications.js`, `services/notification-service/src/domain/index.ts` | — |
| `RF174` | El sistema debe permitir al Oferente cancelar una solicitud en estado Aceptada, indicando un motivo. | Alta | `db/migrations/request/20260930000300_cancellations.js`, `services/request-service/src/application/use-cases/CancelRequest.ts`, `services/request-service/src/domain/index.ts` | sí |
| `RF178` | El sistema debe calcular la antelación de la cancelación respecto de la fecha acordada y asignarle el peso correspondiente a su franja. | Alta | `services/rating-service/src/domain/index.ts` | sí |
| `RF179` | El sistema debe registrar cada cancelación con la parte que la efectúa, el estado de origen, el motivo, la antelación, el peso aplicado y si computa. | Alta | `services/rating-service/src/domain/index.ts` | sí |
| `RF180` | El sistema debe calcular la tasa de cancelación de cada usuario por separado como Oferente y como Solicitante, sobre una ventana móvil configurable. | Alta | `db/migrations/rating/20260930000200_cancellation_rate.js`, `services/rating-service/src/application/use-cases/TrackCancellationRate.ts`, `services/rating-service/src/domain/index.ts` | sí |
| `RF181` | El sistema debe emitir un aviso al usuario cuando su tasa de cancelación alcance el primer umbral. | Media | `services/rating-service/src/domain/index.ts` | sí |
| `RF182` | El sistema debe restringir el envío de propuestas al Oferente, y el número de necesidades abiertas al Solicitante, cuando alcancen el segundo umbral. | Alta | `db/migrations/request/20260930000300_cancellations.js` | — |
| `RF183` | El sistema debe abrir una revisión administrativa cuando un usuario alcance el tercer umbral. | Alta | `db/migrations/rating/20260930000200_cancellation_rate.js`, `services/rating-service/src/application/use-cases/TrackCancellationRate.ts`, `services/rating-service/src/domain/index.ts` | sí |
| `RF184` | El sistema debe reabrir la necesidad cuando el Oferente cancele una solicitud originada por adjudicación. | Alta | `db/migrations/request/20260930000300_cancellations.js`, `services/request-service/src/application/use-cases/CancelRequest.ts`, `services/request-service/src/domain/index.ts` | sí |
| `RF185` | El sistema debe notificar la reapertura a los Oferentes cuyas propuestas habían sido descartadas en esa adjudicación. | Alta | `services/request-service/src/application/use-cases/CancelRequest.ts`, `services/request-service/src/domain/index.ts` | — |
| `RF186` | El sistema debe ampliar la vigencia de la necesidad reabierta según el parámetro configurado. | Media | `services/request-service/src/application/use-cases/CancelRequest.ts`, `services/request-service/src/domain/index.ts` | sí |
| `RF187` | El sistema debe permitir a cualquiera de las partes declarar la incomparecencia de la otra, transcurrida la fecha acordada más un margen configurable. | Alta | `db/migrations/request/20260930000300_cancellations.js` | — |
| `RF190` | El sistema debe escalar la incomparecencia disputada a revisión administrativa y no computar la falta a ninguna de las partes mientras no se resuelva. | Alta | `db/migrations/request/20260930000300_cancellations.js` | — |
| `RF191` | El sistema debe permitir a un Administrador excusar, reclasificar o confirmar una cancelación, dejando constancia de quién resolvió y por qué. | Alta | `db/migrations/request/20260930000300_cancellations.js` | — |
| `RF192` | El sistema debe mostrar la tasa de cancelación en el perfil público del usuario cuando supere el primer umbral. | Media | `apps/web/src/paginas/MiCuenta.tsx`, `db/migrations/rating/20260930000200_cancellation_rate.js`, `services/rating-service/src/application/use-cases/QueryReputation.ts` · +2 | sí |
| `RF193` | El sistema no debe habilitar la calificación de una solicitud cancelada; el efecto sobre la reputación proviene de la propia cancelación. | Alta | `db/migrations/request/20260930000300_cancellations.js`, `services/request-service/src/domain/index.ts` | — |

## 4. Requisitos no funcionales con trazabilidad

| ID | Requisito | Prioridad | Dónde está | ¿Prueba? |
|---|---|---|---|---|
| `RNF19` | Cuando una funcionalidad no esté disponible por la falla de un microservicio, la interfaz debe indicar qué capacidad está afectada y mantener utili... | Alta | `apps/web/src/api/cliente.ts` | sí |
| `RNF21` | Las contraseñas deben almacenarse protegidas mediante bcrypt con factor de costo igual o superior a 12, o mediante Argon2id. | Alta | `db/migrations/auth/20260930000100_identity.js`, `services/auth-service/src/application/use-cases/AuthenticateUser.ts`, `services/auth-service/src/domain/value-objects/PlainPassword.ts` · +1 | — |
| `RNF22` | La autenticación debe realizarse mediante JWT. El tiempo de expiración del token debe ser definido por el equipo y registrado en una decisión de ar... | Alta | `db/migrations/auth/20260930000200_sessions_and_lockout.js`, `services/auth-service/src/application/use-cases/AuthenticateUser.ts`, `services/auth-service/src/infrastructure/security/JwtTokenService.ts` | — |
| `RNF23` | La puerta de enlace debe verificar el token en cada solicitud protegida, y cada microservicio debe verificar de forma independiente el rol del soli... | Alta | `apps/web/src/App.tsx`, `apps/web/src/Disposicion.tsx`, `apps/web/src/autenticacion/ContextoModo.tsx` · +6 | — |
| `RNF24` | Las llamadas entre microservicios deben estar autenticadas; un servicio debe rechazar una llamada que no presente una credencial interna válida. | Alta | `packages/service-kit/src/http.ts`, `services/api-gateway/src/proxy/forward.ts` | sí |
| `RNF25` | Los microservicios no deben ser alcanzables desde la red pública. | Alta | `packages/service-kit/src/http.ts` | — |
| `RNF26` | Toda comunicación en los entornos desplegados debe realizarse mediante HTTPS con TLS 1.2 o superior. | Alta | `packages/shared/src/config/env.ts`, `services/auth-service/src/infrastructure/http/app.ts` | — |
| `RNF28` | Cada microservicio debe utilizar credenciales de base de datos propias, restringidas exclusivamente a su propio esquema. | Alta | `db/init/01-schemas-and-users.sh`, `db/verify-invariants.sh` | — |
| `RNF31` | La puerta de enlace debe aplicar limitación de tasa a los endpoints de autenticación para mitigar ataques de prueba masiva de credenciales. | Media | `k6/carga.js`, `services/auth-service/src/infrastructure/http/app.ts` | — |
| `RNF36` | La indisponibilidad de los microservicios de notificaciones, calificaciones o administración y reportes no debe impedir el flujo principal de búsqu... | Alta | `db/migrations/request/20260930000100_needs_and_proposals.js`, `services/api-gateway/src/proxy/CircuitBreaker.ts` | — |
| `RNF37` | La indisponibilidad del intermediario de mensajes no debe ocasionar pérdida de eventos; los eventos deben permanecer en la tabla outbox hasta que s... | Alta | `db/helpers.js`, `packages/messaging/src/broker.ts`, `packages/messaging/src/outbox-relay.ts` · +2 | — |
| `RNF44` | Toda llamada síncrona entre microservicios debe tener tiempo máximo de espera, política de reintentos acotada con retroceso exponencial y cortocirc... | Alta | `services/api-gateway/src/proxy/CircuitBreaker.ts` | — |
| `RNF46` | Una escritura fallida no debe dejar estado parcial: la transacción de negocio y su registro en la tabla outbox deben confirmarse ambas o ninguna. | Alta | `db/helpers.js`, `packages/messaging/src/outbox-relay.ts`, `packages/service-kit/src/outbox.ts` · +4 | — |
| `RNF48` | Ante un error inesperado, el sistema debe mostrar un mensaje comprensible al usuario y registrar el detalle técnico junto al identificador de corre... | Alta | `packages/service-kit/src/http.ts`, `packages/shared/src/errors/app-error.ts` | — |
| `RNF53` | Entre microservicios, la integridad debe mantenerse mediante replicación por eventos y validación en el punto de uso; no deben existir llaves forán... | Alta | `db/helpers.js`, `db/seeds/auth/01_roles_and_users.js` | — |
| `RNF54` | Un modelo de lectura replicado debe tratarse como eventualmente consistente; una decisión de escritura no debe basarse en un valor replicado cuando... | Alta | `db/helpers.js`, `db/migrations/catalog/20260930000100_catalog.js`, `services/catalog-service/src/application/use-cases/ManageServiceCatalog.ts` · +2 | — |
| `RNF74` | La restauración debe probarse periódicamente y su resultado debe quedar registrado. | Alta | `db/migrations/admin/20260930000100_audit_and_reporting.js` | — |
| `RNF77` | Todo registro de aplicación debe ser estructurado e incluir el identificador de correlación, el nombre del servicio, el nivel y la marca de tiempo. | Alta | `packages/service-kit/src/observabilidad.ts`, `services/auth-service/src/main.ts` | — |
| `RNF78` | El identificador de correlación debe generarse en la puerta de enlace y propagarse en cada llamada síncrona y en cada evento. | Alta | `db/migrations/admin/20260930000100_audit_and_reporting.js`, `packages/service-kit/src/http.ts`, `packages/service-kit/src/observabilidad.ts` · +1 | — |
| `RNF81` | El microservicio de administración y reportes debe conservar el registro de auditoría inmutable construido a partir de los eventos consumidos. | Alta | `db/migrations/admin/20260930000100_audit_and_reporting.js`, `services/admin-reporting-service/src/domain/index.ts` | — |
| `RNF82` | La profundidad de las colas de mensajes fallidos debe monitorearse y generar una alerta administrativa cuando deje de estar vacía. | Media | `packages/messaging/src/broker.ts`, `packages/messaging/src/outbox-relay.ts` | — |
| `RNF84` | Los datos de contacto de las partes no deben exponerse por ninguna vía —interfaz, API o notificación— antes de que exista una adjudicación o una so... | Alta | `services/notification-service/src/domain/index.ts`, `services/provider-service/src/domain/index.ts`, `services/request-service/src/application/use-cases/ManageRequests.ts` · +2 | sí |
| `RNF86` | El sistema debe limitar la cantidad de necesidades publicadas y de propuestas enviadas por usuario y por ventana de tiempo, para mitigar el uso abu... | Media | `db/migrations/request/20260930000100_needs_and_proposals.js`, `services/request-service/src/domain/index.ts`, `services/request-service/src/main.ts` | — |
| `RNF88` | El sistema debe registrar en la auditoría toda publicación de necesidad, todo envío de propuesta y toda adjudicación, con su actor y su marca de ti... | Alta | `db/migrations/admin/20260930000100_audit_and_reporting.js` | — |
| `RNF89` | El cierre automático de las necesidades vencidas debe ejecutarse de forma idempotente, de modo que su repetición no altere el resultado. | Alta | `db/helpers.js`, `packages/messaging/src/consumer.ts` | — |

## 5. La brecha: requisitos que el código no nombra

### Funcionales (54)

`RF2`, `RF16`, `RF17`, `RF18`, `RF21`, `RF39`, `RF46`, `RF47`, `RF48`, `RF55`, `RF56`, `RF57`, `RF58`, `RF59`, `RF63`, `RF64`, `RF65`, `RF67`, `RF69`, `RF72`, `RF73`, `RF75`, `RF76`, `RF79`, `RF98`, `RF99`, `RF110`, `RF114`, `RF118`, `RF119`, `RF122`, `RF123`, `RF124`, `RF126`, `RF129`, `RF131`, `RF132`, `RF133`, `RF135`, `RF140`, `RF141`, `RF142`, `RF143`, `RF147`, `RF151`, `RF152`, `RF155`, `RF162`, `RF169`, `RF175`, `RF176`, `RF177`, `RF188`, `RF189`

### No funcionales (64)

`RNF1`, `RNF2`, `RNF3`, `RNF4`, `RNF5`, `RNF6`, `RNF7`, `RNF8`, `RNF9`, `RNF10`, `RNF11`, `RNF12`, `RNF13`, `RNF14`, `RNF15`, `RNF16`, `RNF17`, `RNF18`, `RNF20`, `RNF27`, `RNF29`, `RNF30`, `RNF32`, `RNF33`, `RNF34`, `RNF35`, `RNF38`, `RNF39`, `RNF40`, `RNF41`, `RNF42`, `RNF43`, `RNF45`, `RNF47`, `RNF49`, `RNF50`, `RNF51`, `RNF52`, `RNF55`, `RNF56`, `RNF57`, `RNF58`, `RNF59`, `RNF60`, `RNF61`, `RNF62`, `RNF63`, `RNF64`, `RNF65`, `RNF66`, `RNF67`, `RNF68`, `RNF69`, `RNF70`, `RNF71`, `RNF72`, `RNF73`, `RNF75`, `RNF76`, `RNF79`, `RNF80`, `RNF83`, `RNF85`, `RNF87`

Esta lista es el trabajo que queda, y no todo él es código: parte son requisitos
de proceso que se cumplen con un documento o con una decisión. Clasificarlos uno
a uno es trabajo de la Fase 10, donde el Go/No-Go los exige.

## 6. Citas a identificadores que no están en el SRS

Ninguna: el código no inventa identificadores.

## 7. Cómo mantener esto

No a mano. Se regenera leyendo el código, y el criterio para que un requisito
aparezca es que **alguien lo cite en el comentario que explica por qué ese código
existe**. Esa es también la forma de subir la cobertura: al tocar un
comportamiento que un requisito exige, nombrarlo donde se implementa y en la
prueba que lo fija.
