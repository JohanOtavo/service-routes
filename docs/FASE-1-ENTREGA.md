# Fase 1 — Base de datos. Entrega

Estado: **construida, con la puerta de calidad del repositorio pendiente de cerrar**.
Siete esquemas aislados, 55 tablas (43 de negocio y 12 del patrón de eventos), siete
usuarios con privilegio mínimo y 31 pruebas negativas que comprueban los invariantes
contra MySQL real.

> Documento escrito después de la Fase 2, que es cuando el esquema se ejerció de
> verdad. Las cifras salen de consultar la base viva y de leer los archivos, no
> de recordar lo que se construyó.

> **Alcance de la afirmación.** La Fase 1 está construida y sus invariantes se
> comprobaron contra MySQL real en el momento de la entrega. **No** se ha vuelto a
> ejecutar `db/verify-invariants.sh` desde entonces, y `npm run verify` no forma parte
> de su evidencia: requiere Docker, y el 2/10/2026 Docker Desktop estaba detenido.
> El estado medido de las puertas de calidad del repositorio está en
> [00-FLUJO-DEL-PROYECTO.md](00-FLUJO-DEL-PROYECTO.md) §1. La deuda heredada de esta
> fase está en [01-BACKLOG.md](01-BACKLOG.md) grupo A.

---

## 1. Qué se construyó

### Esquema por servicio (SRS-DIST, RNF28)

Un esquema y un usuario por servicio. Ningún servicio puede leer la base de
otro, ni por error ni a propósito: no es una convención, es una restricción del
motor.

| Esquema | Tablas | Contenido |
|---|---|---|
| `pa_auth` | 9 | `rol`, `usuario`, `usuario_rol`, `refresh_session`, `password_recovery_token`, `token_denylist`, `login_attempt`, `login_lockout`, `outbox_event` |
| `pa_provider` | 5 | `prestador`, `provider_validation_log`, `usuario_ref`, `outbox_event`, `processed_event` |
| `pa_catalog` | 6 | `categoria_servicio`, `servicio`, `prestador_ref`, `service_rating_summary`, `outbox_event`, `processed_event` |
| `pa_request` | 16 | `necesidad`, `propuesta`, `solicitud_servicio`, `historial_solicitud`, `motivo_cancelacion`, `cancelacion`, `incomparecencia`, `restriccion_usuario`, `idempotency_key`, cuatro réplicas y las dos de mensajería |
| `pa_rating` | 8 | `calificacion`, `reputacion`, `tasa_cancelacion`, `cancelacion_ref`, `solicitud_ref`, `usuario_ref`, `outbox_event`, `processed_event` |
| `pa_notification` | 4 | `notificacion`, `notification_preference`, `usuario_ref`, `processed_event` |
| `pa_admin` | 7 | `audit_record`, `content_moderation`, `statistics_snapshot`, `backup_record`, `system_parameter`, `outbox_event`, `processed_event` |

Comprobado en la base en marcha: **69 tablas** (55 de negocio más las 14 de
control de migraciones de Knex), **36 restricciones CHECK**, **29 claves
foráneas**, **174 índices**, **7 usuarios de servicio**.

### Archivos

```
db/
  init/01-schemas-and-users.sh   crea esquemas y usuarios al primer arranque
  helpers.js                      piezas comunes a todas las migraciones
  migrations/<esquema>/*.js        11 migraciones
  seeds/auth, seeds/catalog        2 seeds de desarrollo
  cli.js                           migrate | rollback | seed | status | reset
  compile-sql.js                   compila el DDL sin conectarse
  verify-invariants.sh             31 pruebas negativas contra MySQL real
  Dockerfile + entrypoint.sh       imagen del migrador
  knexfile.js
```

---

## 2. Las decisiones que importan

### 2.1 Privilegio mínimo, y por qué `DROP USER` antes de `CREATE USER`

Cada usuario recibe `SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX,
REFERENCES, TRIGGER, DROP` **solo sobre su esquema**. Nada global, y nunca
`GRANT OPTION`.

El script borra el usuario antes de crearlo, en lugar de usar `CREATE USER IF
NOT EXISTS`. La razón es concreta: si el usuario ya existía con permisos sobre
otro esquema, `CREATE USER IF NOT EXISTS` no los quita. Y `REVOKE ALL PRIVILEGES
ON *.*` tampoco, porque solo toca los privilegios *globales*: un `GRANT` sobre
`pa_auth.*` concedido antes sobrevive intacto. Borrar y recrear es la única forma
de garantizar que el usuario empiece sin nada.

Después de conceder, el script **verifica** contra `information_schema` que
ningún usuario tenga privilegios fuera de su esquema. Si los tiene, el arranque
falla.

### 2.2 Las réplicas son copias, no una segunda fuente de verdad

Las tablas `*_ref` (`usuario_ref`, `prestador_ref`, `servicio_ref`,
`categoria_ref`, `reputacion_ref`, `solicitud_ref`, `cancelacion_ref`) son
copias locales de datos que posee otro servicio, alimentadas por eventos.

Existen porque la alternativa es peor. Sin ellas, aceptar una contratación ya
acordada exigiría preguntarle por HTTP al catálogo si el servicio sigue activo,
y una caída del catálogo impediría cerrar contrataciones que no dependen de él.
El precio es consistencia eventual, y aquí es asumible: lo peor que pasa es
admitir una propuesta unos segundos después de que el perfil se suspendiera.

Ninguna réplica guarda más de lo que su servicio necesita. `usuario_ref` en
`pa_notification` deja `correo` y `telefono` en NULL a propósito, aunque el
helper común cree esas columnas: la entrega por correo está fuera del alcance,
así que serían datos de contacto replicados que nadie puede usar.

### 2.3 Outbox y consumo idempotente

Cada esquema que publica eventos tiene `outbox_event`; cada uno que los consume
tiene `processed_event` con clave primaria `(consumer, event_id)`.

El evento se escribe en la misma transacción que el cambio de negocio, y un
proceso aparte lo envía. Eso elimina el estado "la escritura se confirmó pero el
evento se perdió" (RNF37, RNF46). La clave compuesta de `processed_event` es la
que permite que el mismo evento llegue dos veces sin aplicarse dos veces: el
broker entrega *al menos* una vez.

### 2.4 La auditoría no se puede corregir

`audit_record` lleva dos disparadores, `trg_audit_no_update` y
`trg_audit_no_delete`, que rechazan cualquier UPDATE o DELETE (RF103). Una
bitácora corregible no prueba nada. Las correcciones se hacen añadiendo otro
asiento.

### 2.5 Los motivos de cancelación son datos, no código

`motivo_cancelacion` es una tabla y no una enumeración en el programa, porque
cada motivo lleva metadatos —si computa, si traslada la falta, si exige
validación, si exige texto libre— que son **parámetros a recalibrar con datos
reales**. Cambiarlos no debería exigir un despliegue. Un motivo desactivado deja
de poder elegirse, pero las cancelaciones que ya lo usaron lo conservan.

### 2.6 Las claves de idempotencia están en la base

`idempotency_key` tiene clave primaria `(id_usuario, idempotency_key,
operacion)` y guarda un hash del cuerpo, para detectar la misma clave reenviada
con otro contenido. Está en `pa_request` porque es ahí donde un doble clic
duplicaría una contratación.

---

## 3. Verificación: 31 pruebas negativas

`db/verify-invariants.sh` no comprueba que la base funcione: comprueba que
**rechace** lo que el modelo prohíbe. Cada caso intenta violar un invariante y
pasa cuando MySQL lo rechaza. Si la escritura se acepta, el invariante existe en
la documentación y no en el sistema.

Grupos que cubre:

| Grupo | Qué intenta |
|---|---|
| Agregado Necesidad/Propuesta | estados inventados, proponerse a sí mismo, propuesta duplicada vigente, precio y plazo no positivos |
| Solicitud de servicio | origen fuera del modelo, `ADJUDICACION` sin necesidad ni propuesta, solicitante igual a oferente |
| Auditoría inmutable (RF103) | `UPDATE` y `DELETE` sobre `audit_record` |
| Calificaciones | puntuación fuera de 1–5, dos calificaciones de la misma parte, calificarse a sí mismo |
| Política de cancelación (SRS 10.2) | franja inventada, peso fuera de rango, dos cancelaciones de la misma solicitud, nadie declara su propia incomparecencia, umbral y faceta fuera del modelo |
| Aislamiento entre esquemas (RNF28) | `pa_auth_svc` alcanzando `pa_request`, `pa_request_svc` alcanzando `pa_auth`, `pa_catalog_svc` alcanzando `pa_admin` |

Resultado actual: **31 pasaron, 0 fallaron**.

### `compile-sql.js`

Compila cada migración al DDL que generaría **sin conectarse a nada**. Sirve
para revisar el esquema resultante y para detectar errores de sintaxis sin
levantar MySQL. Encontró dos defectos reales mientras se escribía el esquema.

No sustituye a aplicar las migraciones: no valida claves foráneas ni CHECK
contra datos.

---

## 4. Cómo ejecutarlo

Levantar la infraestructura. El migrador aplica las migraciones y, solo en
desarrollo o pruebas, carga los seeds:

```bash
cd ../friend-point-development && docker compose up -d
```

Ver el estado de las migraciones por esquema:

```bash
cd ../friend-point-development && node db/cli.js status
```

Las 31 pruebas negativas, contra la base levantada:

```bash
cd ../friend-point-development && set -a && . ./.env && set +a && bash db/verify-invariants.sh
```

Revisar el DDL sin levantar nada:

```bash
cd ../friend-point-development && node db/compile-sql.js request
```

> `cli.js` se niega a cargar seeds o a hacer `reset` si `NODE_ENV` no está en una
> lista blanca de `development` y `test`. Es una lista blanca y no un
> `!== 'production'`: un `NODE_ENV` mal escrito o vacío no debe contar como
> entorno seguro.

---

## 5. Defectos encontrados durante la Fase 1

Los cuatro se descubrieron ejecutando, no leyendo.

**Git dejó el script de arranque con CRLF.** MySQL fallaba con
`/bin/bash^M: bad interpreter`, el arranque se saltaba en silencio, los siete
usuarios no se creaban y todas las migraciones morían por permisos. Se arregló
con un `.gitattributes` que fuerza LF en todo archivo que un contenedor ejecute.

**Los disparadores exigían SUPER.** Con el registro binario activo, `CREATE
TRIGGER` lo pide, y concederlo le daría a un servicio el servidor entero. Se
resolvió con `--log-bin-trust-function-creators=ON`, que es exactamente el
permiso que falta y nada más.

**El migrador salía con código 226 sin dejar un solo registro.** Hacía `npm
install` en tiempo de ejecución sobre una imagen de node pelada. Se reemplazó
por una imagen construida, con su propio `package.json` y `entrypoint.sh`.

**El `healthcheck` de MySQL mentía.** `mysqladmin ping -h localhost` responde al
servidor *temporal* del arranque, que solo escucha por socket, así que el
migrador arrancaba antes de que el puerto TCP estuviera abierto y moría con
`ECONNREFUSED`. Se corrigió añadiendo `--protocol=TCP`, que es lo que de verdad
comprueba que el servidor esté listo para clientes.

---

## 6. Pendientes de la Fase 1

Dos de los pendientes de la Fase 2 nacen aquí, así que quedan anotados también
en este documento:

**Los seeds borran antes de insertar.** El de `pa_catalog` vacía `servicio`,
`prestador_ref`, `processed_event` y `categoria_servicio`; el de `pa_auth` borra
y recrea las cuentas de prueba con identificadores nuevos. Como el migrador
corre en cada `docker compose up` de desarrollo, los datos de la sesión anterior
desaparecen y los perfiles quedan huérfanos. Hacer los seeds idempotentes lo
resuelve.

**Las réplicas no se pueden reconstruir.** Si una tabla `*_ref` se pierde, no
hay forma de rellenarla: los eventos ya se consumieron y se confirmaron. Hace
falta un comando de re-emisión por servicio.

**`statistics_snapshot` no tiene quien la escriba.** El esquema la define y
`admin-reporting-service` la lee, pero nadie calcula las métricas todavía.

---

## 7. Trazabilidad

| Requisitos | Dónde |
|---|---|
| Modelo de datos completo (SRS sección 6) | las 12 migraciones |
| RF103 Auditoría inmutable | disparadores en `audit_record` |
| RF105 Parámetros del sistema | `system_parameter` |
| RF106, RF107 Respaldos y prueba de restauración | `backup_record` |
| RF125, RNF86 Límites anti-abuso | índices y columnas que los soportan |
| RF164–RF167 Calificación bidireccional y por faceta | `calificacion`, `reputacion` |
| RF174–RF186 Política de cancelación | `motivo_cancelacion`, `cancelacion`, `incomparecencia`, `restriccion_usuario`, `tasa_cancelacion` |
| RNF28 Aislamiento entre servicios | usuarios por esquema, comprobado contra MySQL real en la entrega |
| RNF37, RNF46 Consistencia eventual | `outbox_event`, `processed_event` |
| ADR-004 Esquema por servicio | `db/init/01-schemas-and-users.sh` |
