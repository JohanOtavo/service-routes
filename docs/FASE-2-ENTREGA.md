# Fase 2 — Backend seguro. Entrega

Estado: **completa**. Ocho microservicios construidos, probados y corriendo
detrás del gateway. 187 pruebas unitarias y 131 de integración contra MySQL
real, todas en verde. `npm audit` sin vulnerabilidades altas ni críticas.

---

## 1. Qué se construyó

| Servicio | Puerto | Esquema | Endpoints | Qué resuelve |
|---|---|---|---|---|
| `api-gateway` | 8080 | — | — | Única entrada pública. Verifica el token, inyecta identidad, cortocircuito por servicio |
| `auth-service` | 3001 | `pa_auth` | 12 | Identidad, sesiones, roles, administración de cuentas |
| `provider-service` | 3002 | `pa_provider` | 10 | Perfiles de prestador y su validación administrativa |
| `catalog-service` | 3003 | `pa_catalog` | 9 | Servicios publicados, categorías y búsqueda pública |
| `request-service` | 3004 | `pa_request` | 16 | **El núcleo**: necesidades, propuestas, contrataciones y cancelación |
| `rating-service` | 3005 | `pa_rating` | 5 | Calificaciones bidireccionales, reputación por faceta, tasa de cancelación |
| `notification-service` | 3006 | `pa_notification` | 4 | Avisos dentro de la plataforma |
| `admin-reporting-service` | 3007 | `pa_admin` | 7 | Auditoría, parámetros del sistema, informes |

63 endpoints, todos documentados en `contracts/openapi/` y **verificados**: una
prueba lee el router de Express de cada servicio y exige que coincida con su
contrato en los dos sentidos.

### Los dos flujos del negocio

El cambio que pediste —que el solicitante también pueda publicar— está
implementado y convergiendo en una sola entidad:

```
CATÁLOGO    solicitante elige servicio → solicitud PENDIENTE → oferente acepta
DEMANDA     solicitante publica necesidad → oferentes proponen → adjudica
                                          → solicitud ACEPTADA (no pasa por PENDIENTE)
```

Las dos terminan en la misma `solicitud_servicio`, distinguidas por `origen`.
A partir de ahí el ciclo de vida, el historial, la cancelación y la
calificación son uno solo. Dos entidades separadas habrían duplicado todo eso
sin que ninguna regla fuera diferente.

### La política de cancelación

Inventada por analogía con el transporte por aplicación, como pediste, con una
diferencia que lo cambia todo: **aquí no hay cobro**. Un conductor que cancela
paga una penalización; un oferente, no. Todo el peso disuasorio recae sobre la
reputación y la visibilidad.

- **Dos relojes.** La gracia (2 h) se mide desde que se *aceptó*: permite
  deshacer un arrepentimiento inmediato. El resto se mide desde la *fecha
  acordada*, porque lo que daña a la contraparte es quedarse sin margen.
- **Pesos** 0 / 0,5 / 1 / 1,5 según la franja. El numerador de la tasa suma
  pesos, no cancelaciones.
- **Ventana móvil de 90 días**, para que la tasa pueda *bajar*. Completar una
  contratación también la recalcula: si no, el único modo de mejorar sería
  cancelar otra vez.
- **Mínimo de 5 contrataciones** para que la tasa signifique algo.
- **Motivos excusados** no se dan por buenos por elegirlos: abren revisión. Si
  bastara con elegirlos, todo el mundo elegiría ése.
- **Retractación del oferente sobre una adjudicación**: la necesidad vuelve a
  ABIERTA con la vigencia ampliada. Al adjudicar se descartaron todas las demás
  propuestas, así que el solicitante quedó peor que antes de publicar, y no hay
  dinero con el que compensarlo.

---

## 2. Trazabilidad con el SRS

| Requisitos | Dónde | Verificado por |
|---|---|---|
| RF01–RF21 Identidad, sesión, recuperación | `auth-service` | 15 int. + 16 unit. |
| RF22–RF32 Perfil de prestador y validación | `provider-service` | 20 int. + 14 unit. |
| RF40–RF53 Catálogo, categorías, búsqueda | `catalog-service` | 17 int. + 12 unit. |
| RF60–RF70 Contratación directa | `request-service` | 30 int. |
| RF78–RF85 Calificaciones | `rating-service` | 17 int. + 55 unit. |
| RF90–RF95 Notificaciones | `notification-service` | 12 int. |
| RF96–RF100 Administración de cuentas | `auth-service` | int. |
| RF101–RF115 Auditoría, parámetros, informes | `admin-reporting-service` | 17 int. + 16 unit. |
| RF120–RF136 Necesidades (demanda) | `request-service` | int. + 31 unit. |
| RF137–RF153 Propuestas y adjudicación | `request-service` | int. + unit. |
| RF154–RF167 Acuerdo, contacto, reputación | `request` + `rating` | int. |
| RF174–RF186 Política de cancelación | `request-service` | 10 int. + unit. |
| RF192 Visibilidad de la tasa | `rating-service` | int. |
| RNF23–RNF26 RBAC, CORS, cabeceras | todos | int. negativas |
| RNF37/RNF46 Outbox y consistencia | `packages/messaging` | 3 int. |
| RNF78 Correlación | `service-kit` | — |
| RNF84 Contacto solo tras acuerdo | `request-service` | int. |

### Requisitos de seguridad del brief

| Exigencia | Estado |
|---|---|
| Argon2id, access ≤15 min, refresh rotativo en cookie httpOnly/Secure/SameSite=Strict | hecho |
| Revocación al cerrar sesión, bloqueo progresivo | hecho |
| RBAC en el servidor, en cada endpoint, denegación por defecto | hecho |
| Control a nivel de registro (IDOR) | hecho — y **404, nunca 403** |
| Validación por esquemas, respuestas sin datos internos | Zod `.strict()` en todo cuerpo |
| Solo consultas parametrizadas | Knex en todo; `ORDER BY` por lista blanca |
| Rate limiting, CORS restringido, CSP/HSTS, límites de tamaño | hecho |
| Secretos en entorno, `.env.example` | hecho |
| Logs de auditoría sin contraseñas ni datos personales | hecho, con depurador probado |
| Errores centralizados, sin stack traces en producción | hecho |
| OpenAPI de todos los endpoints | 63/63, **verificado por prueba** |
| Pruebas negativas de seguridad | sin token, rol incorrecto, IDOR, inyección, fuerza bruta |
| `npm audit` sin altas ni críticas | limpio (quedan 2 bajas en eslint) |

---

## 3. Cómo ejecutarlo

```bash
cd ../friend-point-development && docker compose --profile apps up -d
```

Comprobar que los once contenedores están sanos:

```bash
cd ../friend-point-development && docker compose ps
```

El gateway queda en `http://127.0.0.1:8080`. Ningún otro servicio publica
puerto: solo se llegan por la red interna de Docker.

### Pruebas

Unitarias, sin necesidad de base de datos:

```bash
cd ../friend-point-development && npx jest --selectProjects unit
```

De integración, contra el MySQL real del compose. `REQUIRE_INTEGRATION=1` hace
que un fallo de configuración se propague en vez de disfrazarse de "omitido":

```bash
cd ../friend-point-development && set -a && . ./.env && set +a && MYSQL_HOST=127.0.0.1 RABBITMQ_HOST=127.0.0.1 REDIS_HOST=127.0.0.1 REQUIRE_INTEGRATION=1 npx jest --selectProjects integration
```

Auditoría de dependencias:

```bash
cd ../friend-point-development && npm audit --audit-level=high
```

---

## 4. Decisiones tomadas

**Los servicios de dentro no vuelven a verificar el JWT.** El gateway ya
comprobó la firma con el algoritmo fijado y la lista de denegación, y reenvía la
identidad en `x-internal-user-id` / `-roles` / `-jti` después de borrar esas
cabeceras de toda petición entrante. Que cada servicio verificara el token otra
vez significaría darles a los ocho la clave pública y una conexión a Redis, y
una caída de Redis tumbaría ocho servicios en lugar de uno.

**Un fallo de propiedad responde 404, nunca 403.** Un 403 confirma que el
recurso existe, y con eso se recorren identificadores para averiguar qué tienen
los demás.

**El contacto se revela en un solo sitio**: el detalle de una contratación ya
aceptada. Ni el catálogo, ni el perfil público, ni el listado de contrataciones.
Es lo que impide que la plataforma sea un directorio del que las partes se van
sin dejar rastro.

**La reactivación de una cuenta NO devuelve el perfil de prestador a ACTIVE.**
RF32 define el arrastre en un solo sentido, y un perfil puede estar suspendido
por su propio contenido: reactivarlo en automático desharía esa decisión sin que
nadie la revisara.

**Se añadió `ServiceProviderProfileUpdated` al catálogo de eventos.** No está en
el SRS. Sin él, `pa_catalog.prestador_ref` conservaba el nombre antiguo para
siempre y el catálogo publicaba datos falsos. Hay que reflejarlo en el SRS.

---

## 5. Defectos encontrados y corregidos

Los que valen la pena contar, porque ninguno se vio leyendo código:

**Ningún consumidor de eventos ejecutaba nada.** `EventConsumer` decidía "ya
procesado" leyendo las filas que devolvía `onConflict().ignore()`. En MySQL eso
compila a `INSERT IGNORE` y Knex devuelve `[insertId]`, que en una tabla con
clave primaria compuesta y sin autoincremento vale **0 siempre**: en el alta
buena y en la repetida. Así que todo manejador se saltaba, la marca se escribía
y el mensaje se confirmaba. Un sistema de eventos que no aplicaba ninguno y no
se quejaba. Comprobado contra la base antes de tocarlo.

**`vistaPublica()` del prestador exponía teléfono y correo** en cuanto el perfil
estaba validado. Habría convertido el catálogo en un directorio de teléfonos.

**La lista blanca del gateway era demasiado ancha.** `:id` casaba con cualquier
texto, así que la entrada pública de `/providers/:id` cubría también
`/providers/pending` —la cola de revisión, que lista teléfonos y correos—.

**La auditoría escribía secretos.** El depurador censura por el nombre del
campo, y el asiento de un parámetro tiene campos llamados `clave`, `anterior` y
`nuevo`: ninguno suena a secreto. Crear un parámetro llamado `SMTP_PASSWORD`
escribía su contraseña en una tabla que por diseño no se puede corregir.

**Reabrir una necesidad acortaba el plazo.** Publicada con 30 días, una
retractación el primer día dejaba la vigencia en 15: la reparación empeoraba la
situación.

**Los usuarios sembrados no existían para nadie.** El seed los insertaba
directamente en `pa_auth` sin emitir `UserRegistered`, y varias tablas tienen
`usuario_ref` como clave foránea. Una cuenta de prueba podía iniciar sesión pero
no crear una solicitud.

**Tres vulnerabilidades altas**: `qs` vía express 4.21.2, y `mysql2` 3.11.5 con
una degradación del plugin de autenticación que filtra credenciales en claro.

---

## 6. Pendientes — necesitan tu decisión

Ninguno bloquea la Fase 3, pero conviene resolverlos.

### 6.1 El teléfono no llega al contacto posterior al acuerdo

`UserRegistered` no lleva teléfono, y es **deliberado** por parte de quien lo
emite: un evento se replica en varios servicios y solo debe llevar lo que sus
consumidores necesitan. La consecuencia es que lo que se revela tras el acuerdo
es nombre y correo, no teléfono. En servicios locales en Colombia, el teléfono
es el canal principal.

Opciones: (a) añadir el teléfono al evento, aceptando replicarlo; (b) que
request-service lo pida a auth-service solo en el momento de revelarlo, a costa
de acoplar el detalle de una contratación a que la identidad esté levantada;
(c) que el contacto del oferente salga de su perfil de prestador, donde él mismo
lo escribió como dato comercial, lo que exige replicarlo a `pa_request`.

Mi recomendación es (c): es el dato que el oferente declaró *para que lo
contacten*, a diferencia del teléfono personal de su cuenta.

### 6.2 Las réplicas no se pueden reconstruir

Si una tabla `*_ref` se pierde o se corrompe, no hay forma de rellenarla: los
eventos ya se consumieron y se confirmaron. Hoy se nota porque el seed de
`pa_catalog` borra `prestador_ref` en cada `docker compose up` de desarrollo y
el catálogo se queda sin prestadores hasta que alguien edita su perfil.

Hace falta un comando de re-emisión por servicio. No es difícil, pero es trabajo
que no estaba en el alcance.

### 6.3 El seed recrea los usuarios con identificadores nuevos

Cada `docker compose up` en desarrollo borra y recrea las cuentas de prueba, así
que los perfiles, servicios y solicitudes de la sesión anterior quedan
huérfanos. Se arregla haciendo el seed idempotente (no borrar si ya existe).

### 6.4 El SRS en inglés está desactualizado

`friend-point-docs/04-requirements/srs-microservices.md` quedó en la versión
anterior al flujo de demanda. El SRS en español (v2.1) sí está al día.

### 6.5 Contratos duplicados

Los `.yaml` de `friend-point-docs/07-api/contracts/openapi/` son anteriores a la
implementación. Los buenos están ahora en `friend-point-development/contracts/`,
porque allí una prueba los compara con el código. Conviene que el repositorio de
documentación apunte a ellos en lugar de guardar una copia.

### 6.6 Fuera del alcance del MVP, por si acaso

Pagos, entrega de notificaciones por correo o push, y el cálculo de las métricas
de `statistics_snapshot` (el servicio las lee; nadie las escribe todavía).

---

## 7. Lo que sigue

**Fase 3 — Frontend.** React PWA, sistema de diseño que propongo y apruebas, y
3D selectivo donde aporte realismo. Queda a la espera de tu confirmación.
