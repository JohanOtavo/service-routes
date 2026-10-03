# Fase 5 — Datos y operación

**Estado: completada con una decisión abierta.** 3 de octubre de 2026.

Esta fase existe porque casi todo lo demás dependía de que los datos se pudieran
reproducir. Sus cinco elementos salían del backlog; cuatro están cerrados con
código y prueba, y el quinto es un borrador que necesita tus decisiones.

---

## 1. Lista de salida

| # | Elemento | Estado | Evidencia |
|---|---|---|---|
| A-1 · B-3 | Semillas idempotentes | **Cerrado** | 6 pruebas en `db/tests/seeds.int.test.ts`; `db:reset` + 3 × `db:seed` |
| A-2 · B-2 | Re-emisión de réplicas | **Cerrado** | 5 pruebas en `db/tests/reemit.int.test.ts`; `npm run db:reemit` real |
| A-3 | Escritor de `statistics_snapshot` | **Cerrado** | 6 unitarias + 2 de integración |
| AT-004 | Restauración de respaldos | **Cerrado** | 7 esquemas restaurados y verificados, 69 tablas comparadas |
| — | Política de datos personales | **Borrador** | [04-POLITICA-DATOS-PERSONALES.md](04-POLITICA-DATOS-PERSONALES.md) · 6 decisiones abiertas |

Gate al cierre: `format:check`, `lint`, `typecheck` en verde; **193 pruebas
unitarias** y **146 de integración**, estas últimas en tres ejecuciones seguidas.

---

## 2. A-1 — Las semillas ya no destruyen estado

Los seeds borraban todas las filas y volvían a insertar. Las categorías nunca
fueron el problema: **los identificadores lo eran**. Cada ejecución reasignaba
`id_usuario`, y los otros seis esquemas guardan una réplica `usuario_ref` con ese
identificador y **sin clave foránea**, porque una FK entre esquemas rompe la
propiedad de datos que exige el SRS (RNF53). El motor no puede avisar de nada,
así que un `docker compose up` de desarrollo dejaba perfiles, solicitudes y
calificaciones apuntando a usuarios que ya no existían.

El seed del catálogo era peor de lo que parecía: para insertar doce categorías
vaciaba seis tablas, tres de las cuales no contienen datos de ejemplo —
`servicio`, `prestador_ref` y `processed_event`—. Borrar la última significaba
que los eventos ya consumidos tampoco volvían a llegar.

Ahora cada fila se inserta o se refresca por su clave natural y ningún seed toca
una tabla que no le pertenece.

**Verificado por la ruta real del CLI:**

| | seed 1 | seed 2 | seed 3 |
|---|---|---|---|
| Usuarios nuevos | 4 | 0 | 0 |
| Identificadores | 1,2,3,4 | iguales | iguales |
| `UserRegistered` en el outbox | 4 | 4 | 4, no 12 |
| Asignaciones de rol | 7 | 7 | 7, no 21 |

`UserRegistered` solo se encola para las altas **nuevas**. El consumidor es
idempotente por `event_id`, no por contenido, así que un identificador nuevo en
cada ejecución esquiva esa protección y el alta de los cuatro usuarios de prueba
se volvería a anunciar en cada arranque.

### El defecto que la prueba tuvo al nacer

Una de las seis pruebas era intermitente, y el motivo merece quedar escrito:
contaba **todas** las filas `UserRegistered` de `pa_auth.outbox_event`, mientras
Jest reparte las suites entre procesos y `auth-http.int.test.ts` da de alta y
borra su propia cuenta en esa misma tabla. El total se movía entre las dos
lecturas sin que el seed hubiera hecho nada. Se acotó a los cuatro correos
sembrados; un `LIKE '%@puntoamigo.local'` no habría servido, porque el correo de
esa otra suite también encaja.

---

## 3. A-2 — Las réplicas se pueden reconstruir

`node db/cli.js reemit` —o `npm run db:reemit`— toma el estado actual de la tabla
que cada servicio posee y vuelve a escribir su evento de alta en su propio
outbox. El relevo lo publica por el camino de siempre y los consumidores hacen
upsert. Escribir aquí y publicar allí es deliberado: la reconstrucción recorre la
ruta real en lugar de una paralela que se desincroniza.

Los `event_id` son nuevos, no los originales. `processed_event` tiene clave
primaria `(consumer, event_id)`, así que reutilizarlos haría que todo consumidor
descartara el evento y la reconstrucción no haría nada.

### Y por eso cada payload lleva `reemision: true`

Esa misma idempotencia es la que protege los efectos que **no** son poblar una
réplica. El consumidor de `UserRegistered` de notification-service hace dos
cosas: refresca `usuario_ref` —lo que se quiere— y crea un aviso de BIENVENIDA
—lo que no—. Reconstruir las réplicas habría mandado un saludo duplicado a cada
usuario existente, y `ServiceRequestCreated` habría vuelto a anunciar cada
solicitud pasada. Los dos manejadores comprueban la marca y se saltan esa parte;
la réplica sí se refresca.

### Lo que NO se re-emite, y por qué

`ServiceRequestCancelled`. Su consumidor de rating-service no solo replica:
imputa la cancelación a la tasa de un usuario. Re-emitirlo contaría dos veces
cancelaciones reales y podría cruzar el umbral que suspende a un prestador. El
payload original, además, enmascara `peso` y `computa` según el estado de la
revisión y recalcula `faceta`, así que no se puede reconstruir fielmente desde la
tabla. **`cancelacion_ref` se queda sin reconstruir**, y eso está anotado en el
backlog en lugar de resuelto a medias.

### Dos defectos vivos que aparecieron al revisar los contratos

Los dos son del mismo tipo —una clave mal escrita que no falla, solo deja la
columna vacía— y los dos se corrigieron aquí, porque una reconstrucción que
escribe cadenas vacías no es una reconstrucción.

- **`CategoryCreated`**: el emisor manda `nombre`, el consumidor leía
  `nombreCategoria`. Con el `?? ''` del consumidor el desajuste nunca falló, así
  que `categoria_ref.nombre_categoria` ha estado **vacía en todas las filas**
  desde que existe la función, y el único síntoma era una lista de categorías sin
  texto.
- **`ServicePublished`** nunca llevaba el nombre del servicio, mientras su
  consumidor siempre ha leído `nombreServicio`. La misma columna vacía en
  silencio. Corregirlo obligó además a añadir el getter `nombre` que `Servicio`
  no tenía, pese a que `ServicioProps` sí declaraba el campo.

---

## 4. A-3 — `statistics_snapshot` ya tiene quien la escriba

La tabla existía, este servicio la leía y paginaba, y ningún proceso la
calculaba: los informes de serie devolvían vacío siempre, para una función que el
SRS lista como módulo 13.

**Solo dos métricas, y ese límite es el honesto.** `pa_admin` tiene exactamente
dos tablas con volumen propio, `audit_record` y `content_moderation`, y este
servicio no puede consultar otro esquema (RF108). Tampoco le llega ninguna
réplica: **no hay ninguna tabla `*_ref` en `pa_admin`**. Así que
`auditoria_eventos` se dimensiona por `resultado` y `moderaciones` por
`recurso_tipo`, y los informes por rol, categoría, estado de solicitud y
calificación (RF109 a RF112) siguen sin datos.

Recalcular sustituye en lugar de acumular, y para eso ya estaba construido el
esquema: la clave única `(fecha, metrica, dimension)` lleva el comentario
«recalcular sustituye, no duplica». Por eso la ventana puede solaparse entre
ejecuciones sin inflar las cifras, y por eso es de dos días: `ocurrido_at` es
cuándo pasó, no cuándo se registró.

El barrido sigue el precedente que ya estaba en el árbol, el de periodos ciegos
de rating-service: `setInterval` con `unref()`, `clearInterval` al cerrar, y dos
variables de entorno (`STATS_SWEEP_MS`, cada hora; `STATS_WINDOW_DAYS`, 2). Hace
una pasada al arrancar, porque si no un despliegue reciente deja los informes
vacíos hasta que venza el primer intervalo.

Un día sin actividad **no** escribe una fila. La serie distingue «no pasó nada»
de «no se ha calculado», y una fila a 0 borra esa diferencia.

---

## 5. AT-004 — Restauración probada, por fin

Era el único elemento de severidad `High` del proyecto. `backup_record` existía
desde la Fase 1 con una columna `restauracion_probada_at` que **nadie escribía**,
porque no había ni procedimiento ni herramienta.

[`db/respaldo.sh`](../db/respaldo.sh) tiene tres subcomandos: `crear`,
`restaurar` y `probar`. El procedimiento completo está en
[03-RUNBOOK-RESPALDOS.md](03-RUNBOOK-RESPALDOS.md).

**Ejecutado sobre los siete esquemas: 69 tablas comparadas fila por fila, las
siete restauraciones verificadas, y `restauracion_probada_at` con valor real en
las siete filas.**

### Los dos falsos positivos que tuvo el script

Se dejan escritos porque son exactamente el modo de fallo contra el que existe
AT-004: una comprobación que dice «verificado» sin haber comprobado nada.

1. **La huella salía casi vacía y la comparación pasaba por vacuidad.** La
   función que cuenta filas por tabla ejecutaba `docker exec -i` dentro de un
   `while read`, y `-i` hace que el proceso lea la entrada estándar: dentro del
   bucle se comía las líneas que quedaban por leer. La huella traía **una** tabla
   en lugar de siete, las dos huellas coincidían truncadas, y el script anunciaba
   `restauracion VERIFICADA (1 tablas)`. Se quitó `-i` de las consultas y se
   añadió una guarda: una huella con menos de una tabla no es una verificación.
2. **`probar pa_admin` no podía pasar nunca.** `crear` inserta en
   `backup_record` la fila del propio respaldo *después* de volcar, así que el
   original gana una fila que el volcado no puede contener. `backup_record` queda
   excluida de su propia verificación.

---

## 6. Fuera de alcance de esta fase

- **El cierre de la política de datos personales.** El borrador está; las seis
  decisiones son tuyas.
- **La operación de respaldos en producción**: programación, copia fuera del
  servidor, cifrado en reposo y recuperación a un punto en el tiempo. Es Fase 8,
  y está tabulado en el runbook §4.
- **`cancelacion_ref`**, por el motivo de §3.
- **Las tres réplicas sin escritor** que esta fase destapó —`usuario_ref` en
  `pa_provider` y `pa_rating`, y `reputacion_ref` en `pa_request`—: tienen
  migración y **cero código** que las escriba. No estaban en el backlog; ahora sí.

---

## 7. Lo que esta fase desbloquea

La Fase 6 ya puede ejecutar su E2E de forma fiable: las semillas no destruyen
estado entre ejecuciones y las réplicas se pueden reconstruir si una prueba las
deja inconsistentes. Era la regla de orden que imponía el grafo de dependencias.
