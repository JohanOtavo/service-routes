# Backlog de trabajo abierto

Todo lo que está pendiente en Punto Amigo, con su origen documental, su prioridad
y **qué hay que cumplir exactamente para poder cerrarlo**. Fecha de corte: 2 de
octubre de 2026.

Un elemento solo se cierra cuando se cumple su criterio de cierre y su verificación
queda registrada. Un pendiente marcado «decisión» no se puede cerrar con trabajo
técnico: necesita una respuesta tuya.

---

## Resumen

| Grupo | Orígenes | Elementos | Con decisión tuya |
|---|---|---|---|
| A. Pendientes de la Fase 1 | `FASE-1-ENTREGA.md` §6 | 5 · **4 cerradas** (A-2 queda por datos) | 0 |
| B. Pendientes de la Fase 2 | `FASE-2-ENTREGA.md` §6 | 5 | 1 |
| C. Pendientes de la Fase 3 | `FASE-3-ENTREGA.md` §7 | 4 | 0 |
| D. Deuda técnica registrada | `05-architecture/overview.md` §14 | 7 | 3 |
| E. Preguntas abiertas | `srs-microservices.md` §11 | 12 | 5 bloqueantes |
| F. Brechas de trazabilidad | `traceability-matrix.md` §10 | 8 | 0 |
| G. Calidad del repositorio | medido el 3/10/2026 | 10 · **0 abiertas** | 0 |
| H. Documentación ausente | (counted below) | 8 | 0 |
| **Total** | | **49** | **10** |

Fases 1 y 2 comparten dos pendientes que son en realidad el mismo problema: los
seeds no idempotentes aparecen como F1-1 y F2-3, y la re-emisión de réplicas como
F1-2 y F2-2.

> **Recuento rehecho el 4/10/2026.** Sube de 46 a 49, y no por trabajo nuevo sino
> por lo contrario: al mapear A-2 antes de implementarlo se vio que no era un
> problema sino tres, y se abrieron **A-4** (el comando de re-emisión) y **A-5**
> (dos tablas `usuario_ref` sin escritor). Ambos están **cerrados**: A-4 con
> `event_id` nuevo, que era la alternativa recomendada y la que decidiste, y A-5
> eliminando las dos tablas, que era la recomendación del mapa. El total de «con
> decisión tuya» baja en uno por eso mismo, y ya no queda ninguna decisión de
> implementación abierta en este bloque: la pendiente es la parte de A-2 que exige
> datos de producción.
>
> Sigue sin cuadrar lo de abajo, y no lo he corregido por la misma razón de antes:
> dos duplicados conocidos deberían restar 2, no 4, y no sé si faltan dos
> duplicados por documentar o si el 54 original estaba mal. Ajustarlo a ojo
> inventaría el dato.

---

## A. Pendientes de la Fase 1 — Base de datos

Origen: `FASE-1-ENTREGA.md` §6.

### A-1 · Las semillas borran antes de insertar — **CERRADO**

**Qué pasa.** Cada `db:seed` borraba las filas y las volvía a insertar. `usuario.id_usuario`
era un autoincremento, así que cambiaba en cada ejecución y las tablas `*_ref` de
los demás esquemas — que **no tienen clave foránea** contra `pa_auth.usuario`
porque viven en otro esquema — quedaban apuntando a filas fantasma sin un solo
error. Un `docker compose up` de desarrollo destruía el estado.

**Solución.** `db/seeds/auth/01_roles_and_users.js` y
`db/seeds/catalog/01_categories.js` ahora son idempotentes: usan
`onConflict(...).merge(...)` por clave natural (`correo`, `nombre_rol`,
`nombre_categoria`), sincronizan los roles exactos del usuario y vuelven a
encolar `UserRegistered` solo cuando no existe ese evento. No se borra ninguna
tabla.

**Prueba.** `db/tests/seeds-idempotency.int.test.ts` (7 pruebas, contra MySQL
real) comprueba que repetir los seeds dos veces conserva los mismos
identificadores, no duplica roles ni categorías, no duplica eventos en el outbox,
deja las réplicas apuntando a usuarios que existen y no borra un servicio
publicado (canario insertado a propósito). Con el seed antiguo, 4 de 7 fallaban
y se detectaban huérfanos reales; con el nuevo, todas pasan.

**Corrección del 4/10/2026, y es una lección sobre la prueba, no sobre el seed.**
La comprobación de réplicas estaba escrita mirando la tabla entera, y así
fallaba de dos maneras a la vez. Borraba las filas `*_ref` de usuarios que no
eran de seed —destruyendo datos de otras suites de integración, que comparten
los mismos esquemas, y provocando un error de clave foránea en
`catalog-http`— y afirmaba que no quedaba ningún huérfano en la tabla, lo
cual da falso positivo en cuanto otra suite crea sus propios usuarios. El
resultado era una prueba que no era determinista: `npm run verify` alternaba
entre verde y rojo según el orden de las suites. Ahora pregunta solo por las
filas que los seeds son dueños, y no borra nada.

Dos comprobaciones que hice al arreglarla. La primera, que **sigue detectando
el defecto**: saboteando `asegurarUsuario` para que inserte siempre, como
estaba originalmente, fallan 5 pruebas, incluida la de réplicas. La segunda, que
la prueba ya no puede afirmar nada sobre `pa_provider.usuario_ref` ni
`pa_rating.usuario_ref`: **no tienen escritor**, así que siempre están vacías y
la comprobación es vacua para ellas. Ver **A-5**.

**Segunda corrección del mismo día, mismo origen.** Al volver a pasar la puerta
después de la primera, falló la prueba de identificadores: otra suite había
insertado `integracion@puntoamigo.local` entre las dos lecturas y la
comparación, que era de la tabla entera, lo contamtaba como cambio del seed. Es
el mismo defecto de aislamiento en la prueba hermana, y estaba ahí desde que
se escribió. Ahora ambas comparan solo las cuentas del seed
(`CORREOS_DE_SEED`). Cuatro `npm run verify` completos seguidos en verde.

**Lo que esto deja escrito como norma.** Una prueba de integración que
compare estado compartido tiene que acotar qué filas son suyas. Aquí la regla
concreta es `CORREOS_DE_SEED`: si un test necesita un dato de la base que
comparten ocho suites, debe filtrar por su propia clave natural, no leer la
tabla.

**Fase destino.** 5 (Datos y operación).

### A-2 · Las réplicas no se pueden reconstruir — **REESCRITO el 4/10/2026**

**Por qué se reescribió.** El texto anterior decía: «existe un comando de
re-emisión por servicio y se ha ejecutado reconstruyendo `prestador_ref` desde
cero». Al mapear el código antes de escribir ese comando, esa receta no
construye nada. El enunciado partía de una suposición falsa —que las réplicas se
alimentan de `UserRegistered`— y el trabajo se partió en cuatro elementos
distintos con criterios de cierre distintos. **Sigue abierto**, pero ya no es un
solo problema.

Lo que dice el código, con su ubicación:

| Tabla | Quién la escribe | Consecuencia |
|---|---|---|
| `pa_request.usuario_ref` | `request-service`, con `UserRegistered` (`main.ts:218`) | Reconstruible por re-emisión de ese evento |
| `pa_notification.usuario_ref` | `notification-service`, con `UserRegistered` (`main.ts:136`) | Reconstruible por re-emisión de ese evento |
| `pa_catalog.prestador_ref` | `catalog-service`, con eventos **de perfil de prestador**: `ServiceProviderProfileCreated/Updated/Validated` y `ProviderStatusChanged` (`main.ts:148-188`) | **No** se reconstruye reemitiendo `UserRegistered`. Es correcto por diseño: no todo usuario es prestador |
| `pa_provider.usuario_ref` | **nadie.** Se creaba (`migrations/provider/20260930000100_provider.js:21`) y no había ni un solo escritor | Andamiaje muerto: **eliminado en A-5** |
| `pa_rating.usuario_ref` | **nadie.** Se creaba (`migrations/rating/20260930000100_ratings.js:26`) y no había ni un solo escritor | Andamiaje muerto: **eliminado en A-5** |

Tres hechos que condicionan cualquier comando de re-emisión y que no estaban
escritos en ninguna parte:

1. **Un replay con el `event_id` original no funcionaría.** `EventConsumer`
   descarta el duplicado por la clave primaria `(consumer, event_id)` de
   `processed_event` (`packages/messaging/src/consumer.ts:134`). La consecuencia es
   que o se restablece `processed_event` del destino antes de republicar, o se
   emite con `event_id` nuevo. Se eligió lo segundo; está en **A-4**.
2. **`servicio` depende de `prestador_ref` por clave foránea.** No hay ningún
   evento que escriba `servicio`: se crea por la API de catálogo
   (`KnexServicioRepository.ts:80`). Por eso el orden obligatorio no es entre
   eventos —los eventos de perfil solo hacen UPSERT sobre `prestador_ref`— sino
   entre **reemitir el perfil y volver a registrar servicios**: con `prestador_ref`
   vacía, cualquier `INSERT` en `servicio` falla con `RESTRICT` y el catálogo
   queda sin poder publicar nada. La prueba de A-4 lo comprueba en los dos
   sentidos: con la réplica vacía el insert revienta, y tras reemitir entra.
3. **`UserRegistered` no lleva todos los campos de la réplica.** El payload
   (`RegisterUser.ts:78-92`) excluye el teléfono a propósito —SRS-MSG-06, un
   evento termina replicado en varios servicios— y no lleva `estado` ni
   `especialidad`. Una reconstrucción por re-emisión deja `telefono` a NULL y
   obliga a reproducir además `UserAccountSuspended` y
   `ServiceProviderProfileValidated`. No es un fallo: es el límite de lo que el
   evento transporta, y hay que dejarlo escrito.

**Estado.** **La herramienta ya existe** (`db/cli.js reemit`, cerrado en **A-4**),
las dos réplicas muertas se eliminaron (**A-5**) y `prestador_ref` está verificado.
`db/tests/reemit.int.test.ts` reconstruye un `prestador_ref` desde cero pasando por
el relay y el consumidor reales, y comprueba el efecto que importa: antes de
reemitir, `INSERT` en `servicio` falla por la clave foránea; después de reemitir,
entra.

**Lo que sigue abierto, con precisión.** No es el mecanismo sino los **datos**: una
reconstrucción completa de `pa_catalog` necesita que `prestador_ref` conserve
`telefono` y `estado` a los que el evento no llega (hecho 3), y eso solo se puede
verificar con el historial real de prestadores, que este entorno no tiene. El
comando queda listo para cuando haya ese historial.
**Por qué sigue importando.** Sin esto, una recuperación ante desastres es
irrecuperable, y es prerrequisito de AT-004.
**Fase destino.** 5.

### A-4 · No existe comando de re-emisión de la outbox — **CERRADO**

**Qué pasaba.** `outbox_event` es de solo append: `OutboxRelay` publica lo que
tiene `published_at IS NULL` y marca la fila. Nada volvía a publicar una fila ya
publicada, ni aunque se perdiera `processed_event` en el destino, que es
exactamente el escenario de A-2.
**Por qué importaba.** Era la mitad ejecutable de A-2 y lo que hace falta para
AT-004.
**Decisión tomada.** Republicar con `event_id` **nuevo**, sin tocar
`processed_event` del destino. Descartada la otra: exigía borrar antes la marca del
destino, con lo que el comando necesita permisos sobre otro esquema y borra
evidencia de que el evento ya se procesó. Se conserva la trazabilidad con
`causation_id` y con una columna nueva.
**Cómo queda.** `node db/cli.js reemit <servicio> [--event] [--agregado]
[--desde] [--hasta] [--limite] [--incluir-repeticiones] [--ejecutar]`.
Simula por defecto; `--ejecutar` encola filas nuevas sin publicar, y las recoge el
`OutboxRelay` del propio servicio: no hay segundo camino de entrega. Conserva
`occurred_at`, que es lo que mantiene el orden entre esquemas y con él las claves
foráneas.
**Dos cosas que costado un error cada una, y que quedan escritas en el código.**
  - Las repeticiones se marcan con una columna propia, `reemit_of`. La primera
    versión las reconocía porque su `causation_id` apuntara a un evento existente
    de la misma outbox; eso confunde causalidad de negocio con re-emisión. Hoy
    funciona solo porque ningún servicio escribe `causation_id`: cuando algún día
    lo haga, ese filtro se llevaría por delante los eventos encadenados, que son
    los que reconstruyen `prestador_ref`.
  - El comando tiene que ser idempotente de verdad. Filtrar solo las copias frenaba
    la duplicación exponencial pero no la lineal: cada ejecución volvía a copiar el
    original. Tres ejecuciones seguidas daban tres copias del mismo alta. Ahora se
    excluye también el original que ya tiene una copia.
**Prueba.** `db/tests/reemit.int.test.ts`, cinco casos contra MySQL real. El
último es el que importa: vacía `usuario_ref`, marca el evento original como ya
procesado, reemite y comprueba que la réplica vuelve a poblada pasando por el
`OutboxRelay`, el `EventConsumer` y el caso de uso reales. Con el mismo
`event_id` esa prueba fallaría, y por eso es la que demuestra la decisión.
**Fase destino.** 5.

### A-5 · `usuario_ref` en `pa_provider` y `pa_rating` no tiene escritor — **CERRADO**

**Qué pasaba.** Las dos tablas se creaban en sus migraciones y **ningún proceso las
escribía**: no hay una sola referencia a `usuario_ref` en el código de ninguno de
los dos servicios. Por eso A-2 no podía reconstruirlas.
**Por qué importaba, con precisión.** **No era un defecto funcional.** Ninguna otra
tabla declara clave foránea contra ellas, así que su existencia vacía no rompe
nada: no hay peticiones que fallen por esto. Era andamiaje declarado y nunca
usado, y su coste era que la lista de «tablas que replican usuarios» —incluida la
comprobación de A-1— las contaba como si tuvieran un escritor.
**Decisión tomada.** Eliminarlas, opción (b), que era la recomendada: nada depende
de ellas.
**Cómo queda.** `20261004000100_drop_usuario_ref.js` en `provider` y en `rating`.
Las migraciones originales dejan de crearlas y conservan el `drop` del `down`, de
modo que el `rollback` completo sigue siendo simétrico. La lista de réplicas de
`db/tests/seeds-idempotency.int.test.ts` se ajustó a las tres que sí tienen
escritor; con las cinco, la comprobación fallaba contra tablas que ya no existen.
**Fase destino.** 5.

### A-3 · `statistics_snapshot` no tiene a nadie que la escriba — **CERRADA**
**Qué pasaba.** La tabla existe en `pa_admin`, `admin-reporting-service` la lee y
consulta, y **ningún proceso la calcula**. Los reportes salían vacíos.
**Por qué importa.** Los reportes y las estadísticas son el módulo 13 del SRS y una
función explícita del alcance MVP.
**Cierra cuando.** Hay un proceso programado que la puebla, con métricas
documentadas, y una prueba que verifica que una fila aparece.
**Fase destino.** 5.
**Cerrada el 4/10/2026.** `CalculateStatistics` recorre un catálogo de seis métricas
con su fórmula escrita y `EstadisticasScheduler` las calcula al arrancar y cada hora
(`STATISTICS_INTERVAL_MS`). El guardado es un upsert sobre `uq_snapshot_point`, que
no es opcional: el cálculo corre muchas veces al día para la misma fecha y con un
`insert` a secas la tabla crecería con filas repetidas. El guardado en
`KnexEstadisticasSnapshotRepository`.
**Métricas.** `necesidades_publicadas` y `propuestas_enviadas` (diarias, por estado),
`prestadores_por_estado` y `servicios_por_estado` (fotografía del catálogo),
`valoracion_media` (diaria, solo lo ya visible y no moderado) y `tasa_cobertura`
(abierta con propuesta / abierta). El catálogo está en
`services/admin-reporting-service/src/application/use-cases/CalculateStatistics.ts`.
**Lo que no se puede afirmar.** El SRS no está en el repositorio, así que **estas seis
métricas son un catálogo provisional declarado, no el catálogo del SRS**. Cada una
declara su fórmula para que se pueda corregir sin tocar el SQL. Cuando aparezca el
SRS §7.5 / RF113 habrá que contrastarlas.
**Excepción de aislamiento.** Calcular esto exige leer `pa_request`, `pa_catalog` y
`pa_rating`, y **RF108 prohibía expresamente** que este servicio consultara otra base
de datos. Se relajó RF108 por `docs/adr/ADR-005-estadisticas-lectura-cruzada.md`,
concediendo `SELECT` a nivel de **tabla** sobre cinco tablas. El script de
aprovisionamiento verifica al arrancar que esos privilegios son exactamente los del
ADR y que no hay ninguno más.
**Pruebas.** `db/tests/estadisticas.int.test.ts` (13) contra MySQL real: filas en el
snapshot, desglose por estado, borrado lógico, cobertura contra abiertas, los tres
filtros de la valoración, idempotencia y la lectura por el módulo de informes.
`services/admin-reporting-service/tests/estadisticas.unit.test.ts` (4) para el
planificador. Estas pruebas encontraron dos bugs reales durante el desarrollo: el desglose
llegaba con la clave equivocada y `knex.raw` devuelve `[filas, campos]`, no las filas.

---

## B. Pendientes de la Fase 2 — Backend

Origen: `FASE-2-ENTREGA.md` §6. El propio documento dice que ninguno bloquea la
Fase 3 y que conviene resolverlos. Siguen abiertos.

### B-1 · El teléfono no llega al contacto posterior al acuerdo · **DECISIÓN**
**Qué pasa.** Tras adjudicarse una solicitud, la pantalla de detalle de
contratación no muestra el teléfono de la contraparte. Hay tres opciones sobre la
mesa y el documento recomienda una.
**Cierra cuando.** Tú eliges una de las tres y queda implementada con prueba.
**Opciones, según `FASE-2-ENTREGA.md` §6.1:**
  - (a) mostrar el teléfono del usuario registrado
  - (b) mostrar un teléfono de contacto dedicado
  - (c) **recomendada** — que salga del perfil de prestador, que es donde el
    oferente declara el dato *para que le contacten*

### B-2 · Réplicas no reconstruibles
Duplicado de A-2. Se cierran juntos, y el trabajo real está desglosado en A-2,
**A-4** (el comando de re-emisión) y **A-5** (las dos tablas sin escritor).

### B-3 · El seed recrea usuarios con identificadores nuevos — **CERRADO**
Duplicado de A-1. Cerrado al hacer los seeds idempotentes.

### B-4 · El SRS en inglés está desactualizado
**Qué pasa.** `friend-point-docs/04-requirements/srs-microservices.md` sigue
afirmando que los microservicios **no** están adoptados y exige crear tres ADRs
antes de que nada sea vinculante. Los tres ADRs existen y están aceptados desde el
30/09/2026, y el código ya tiene los ocho servicios.
**Por qué importa.** Es el requisito normativo más antiguo del repositorio de
documentación, y contradice la línea base real.
**Cierra cuando.** El SRS refleja la arquitectura adoptada y el estado real del
código.
**Fase destino.** 9.

### B-5 · Contratos duplicados
**Qué pasa.** Hay dos juegos de contratos OpenAPI: los `.yaml` de
`friend-point-docs/07-api/contracts/openapi/`, que son anteriores, y los de
`friend-point-development/contracts/`, que son los buenos.
**Cierra cuando.** El repositorio de documentación apunta a los de código en lugar
de guardar una copia, y no queda ninguna segunda versión.
**Fase destino.** 9.

### B-6 · Fuera del alcance del MVP
Pagos, notificaciones por correo o push, y el cálculo de `statistics_snapshot`.
Los tres están explícitamente fuera del alcance MVP. Se resuelven así:
`statistics_snapshot` entra en la Fase 5 (A-3). Pagos y push dependen de tu
decisión: Fase 7 o descarte.

---

## C. Pendientes de la Fase 3 — Cliente web

Origen: `FASE-3-ENTREGA.md` §7.

### C-1 · Recuperación de contraseña sin interfaz
**Qué pasa.** Backend tiene endpoints; la interfaz web (Recuperar.tsx, Restablecer.tsx) está hecha y cableada en App, pero falta probar el flujo completo de extremo a extremo.
**Cierra cuando.** Flujo completo funciona: solicitud de recuperación, restablecimiento con token, login con nueva contraseña. Validado con pruebas E2E o flujo manual verificado.
**Fase destino.** 6.
**Nota de estado.** Componentes existen (14+15 tests). Envío de correo queda para Fase 7 (fuera de MVP). Para cierre de Fase 6 basta con verificar flujo funcional en UI y cobertura del recorrido.
### C-2 · Faltan los iconos del PWA
**Qué pasa.** Sin icono propio, la aplicación se instala con el icono por defecto.
**Cierra cuando.** `icono-192.png`, `icono-512.png` e `icono.svg` existen, están
declarados en el manifiesto y se ven bien en pantalla de inicio.
**Fase destino.** 6.
**Nota de estado.** Los iconos se generaron y `manifest.webmanifest` los declara —
incluido un `maskable-512`—, con el manifiesto enlazado desde `index.html` y su
`apple-touch-icon`. **Solo queda la confirmación visual** en pantalla de inicio, que
no se ha hecho: es un paso manual de un minuto en un dispositivo real.

### C-3 · No hay pruebas de extremo a extremo
**Qué pasa.** `11-quality/testing-strategy.md` §E2E las exige para el Go/No-Go. El
recorrido crítico —publicar necesidad, recibir propuestas, adjudicar, cancelar— solo
está cubierto por pruebas unitarias y de integración por partes.
**Cierra cuando.** El recorrido completo pasa en un navegador real, en CI.
**Fase destino.** 6.

### C-4 · El teléfono sigue sin llegar
Duplicado de B-1. Se cierran juntos.

---

## D. Deuda técnica registrada

Origen: `05-architecture/overview.md` §14. **Los siete tienen destino
`To be defined`**, es decir, nadie ha decidido cuándo se hacen.

| ID | Elemento | Prioridad | Cerrar cuando |
|---|---|---|---|
| AT-001 | Configuración final de AWS o GCP | P2 | Elige nube y existen los archivos de infraestructura. **Decisión** |
| AT-002 | Estructura REST definitiva | P1 | Las rutas de los 67 endpoints están congeladas y el SRS refleja la decisión |
| AT-003 | Organización de los repositorios | P2 | Se decide si `friend-point-docs` y `friend-point-development` se fusionan, se separan o se quedan. **Decisión** |
| **AT-004** | **Procedimiento de restauración de respaldados** | **P1 · High** | Hay un runbook escrito **y una restauración probada de verdad**. La tabla `backup_record` tiene `restauracion_probada_at` y hoy siempre vale NULL |
| AT-005 | Herramientas de monitoreo y logging | P2 | Todos los servicios emiten logs estructurados con `correlation_id` y hay panel de métricas |
| AT-006 | Valores de expiración de JWT | P1 | Access, refresh y denylist tienen caducidad decidida, documentada y testeada |
| AT-007 | Límites de escalabilidad | P2 | Hay una prueba k6 con el umbral de la estrategia: P95 < 300 ms, error < 1 % |

**AT-004 es el único de severidad High del proyecto.** Es bloqueante de la Fase 10.

---

## E. Preguntas abiertas

Origen: `srs-microservices.md` §11, identificadores O-01 a O-12. **Cinco están
marcadas `Blocking: Yes`.** Todas siguen abiertas y ninguna tiene registro de
resolución.

Estas preguntas ya están contestadas por el código o por ADRs escritos, pero nadie
cerró la pregunta. Ese es el trabajo: cerrar el registro, no rethink el diseño.

| ID | Asunto | Bloqueante |
|---|---|---|
| O-11 | El readme de `auth-service` declara puerto 8081 y PostgreSQL; el SRS dice 3001 y MySQL | **Sí** |
| — | ¿JWT o sesiones? `15-project-control/README.md` Q-001 dice Sprint 2, sin responder, pero ADR-002 ya está escrita | no |
| — | Las 12 tablas de `srs-microservices.md` §11 sin cerrar | 5 de ellas |

**O-11 es la más urgente**: es una contradicción documentada como bloqueante entre
la documentación de servicio y la realidad del código. Corregir una línea.

**El destino de las preguntas abiertas debería ser `15-project-control/open-questions.md`,
que no existe**, aunque el README de esa sección lo prescribe.

---

## F. Brechas de trazabilidad

Origen: `traceability-matrix.md` §10, GAP-001 a GAP-008.

| ID | Brecha |
|---|---|
| GAP-001 a GAP-008 | Detalle en la matriz; ninguna cerrada |

La más relevante es **GAP-005, «implementación sin HU/RF»**: hay código entregado que
no se puede trazar a un requisito del SRS. Combinado con el hecho de que el SRS no
asigna requisitos a fases, significa que hoy **no se puede demostrar qué cubre cada
fase**.

**Cierra cuando.** `traceability-matrix.md` usa el mismo sistema de identificadores
que el SRS (`RF193`, `RNF89`, no `RF1.1`, `NFR-001`) y los 8 huecos están rellenos.

---

## G. Calidad del repositorio

Medido el 3 de octubre de 2026. G-1 a G-4 están **cerrados**; G-5 sigue abierto y
G-6 a G-8 son lo que queda.

### G-1 · `npm run lint` falla con 55 problemas — **CERRADO**
Eran sobre todo tipos de retorno explícitos que exige
`@typescript-eslint/explicit-function-return-type`, con `--max-warnings=0`. Se
completaron todos, incluidos los ~42 de los lotes de subagentes. `npm run lint`
sale con código 0.

### G-2 · `npm run typecheck` falla con 2 errores — **CERRADO**
Los dos en `apps/web/src/paginas/Restablecer.tsx`. Uno era el bug de fondo:
el token de restablecimiento estaba escrito a mano en una constante, así que la
página nunca podía restablecer una contraseña real. Ahora sale de la URL.
`npm run typecheck` sale con código 0.

### G-3 · La cobertura nunca se ha medido — **CERRADO**
Medida con las 375 pruebas en verde: **66.24 % sentencias, 53.67 % ramas, 65.45 %
funciones, 68.24 % líneas**. Muy lejos del 80/80/80/70 que pedía la estrategia.

El umbral de `jest.config.js` se baja a los valores reales medidos menos ~1 punto
(65/52/64/67) como **trinquete**: la cobertura puede subir, pero si baja, la puerta
se pone en rojo. Es el mecanismo que la propia estrategia pide («if a PR lowers
coverage, CI fails»); el 80 % queda como objetivo a alcanzar con pruebas, no como
una puerta que se declara verde sin comprobarla.

### G-4 · Las pruebas de integración no se ejecutaban — **CERRADO**
**133/133 en verde** contra MySQL, RabbitMQ y Redis reales, y tres ejecuciones
seguidas para confirmar que la suite es idempotente.

Dos cosas que hubo que arreglar para llegar ahí:

- **La suite no era idempotente.** El bloqueo progresivo de login lleva la cuenta
  por correo, y `limpiar()` solo borraba las filas del correo principal. La prueba
  «responde igual ante un correo inexistente que ante una contraseña incorrecta»
  falla el login de `nadie@puntoamigo.local`, así que cada ejecución sumaba un
  fallo: al quinto, ese correo quedaba bloqueado 24 horas y la suite empezaba a
  fallar sola. Corregido limpiando también esos correos.
- **Hacía falta cargar bien el `.env`.** Las claves JWT son PEM multilínea con los
  saltos escapados; un parser ingenuo las dejaba vacías y las pruebas no arrancaban.

### G-5 · Trabajo a medias en el cliente — **CERRADO**
Las pantallas de recuperación compilaban y pasaban sus pruebas, pero **no estaban
en la tabla de rutas**. `Entrar.tsx` ya enlazaba a `/recuperar`, así que el enlace
«Olvide mi contraseña» llevaba al 404. El motivo por el que nadie lo notaba es que
cada pantalla se probaba montada sola en un `MemoryRouter` con sus rutas
declaradas a mano dentro de su propia prueba, así que ninguna prueba podía
detectar que una ruta existiera en la prueba y no en la aplicación.

Al montar `App` de verdad aparecieron dos fallos más:

- **La aplicación no arrancaba.** `main.tsx` no envolvía `App` con
  `ProveedorModo`, pero `Disposicion` llama a `useModo()`. El cliente se quedaba
  en blanco al cargar. Nadie lo vio porque ninguna prueba montaba `App`.
- **El icono de 192 era un 512.** El generador declaraba el tamaño en la tabla de
  salidas y no lo usaba al rasterizar, así que `icono-192.png` y `icono-512.png`
  eran byte a byte idénticos. Además **no existía el manifiesto web**, de modo que
  la PWA no era instalable.

Corregido: rutas `/recuperar` y `/restablecer` en `App.tsx`, `ProveedorModo` en
`main.tsx`, `resize()` en el generador, `manifest.webmanifest` enlazado desde
`index.html` con su `apple-touch-icon`, y `rutas.test.tsx` como prueba de
regresión que monta `App` de verdad.

### G-6 · La puerta de cobertura no se comprobaba en CI
`test:unit` y `test:integration` se ejecutaban por separado y ninguna pasaba
`--coverage`, así que el umbral de `jest.config.js` no se evaluaba en ningún sitio.
Lo que hacía `verify` en local no era lo que hacía CI. **Corregido**: CI ejecuta
`verify` entero, y `verify` incluye ya las pruebas web, que antes tampoco se
ejecutaban en CI.

### G-7 · El job de integración de CI no podía pasar
No declaraba servicios ni variables de base de datos: no había MySQL contra el
que correr. **Corregido**: el job levanta MySQL, Redis y RabbitMQ, crea los
esquemas, aplica las migraciones y genera claves JWT efímeras.

### G-8 · 37 vulnerabilidades altas en la cadena de herramientas
Las 37 eran en `jest`, `ts-jest`, `@types/jest`, `typescript-eslint` y `sharp`, todas
en `devDependencies`: ninguna llega a producción. **Corregido** subiendo la cadena a
Jest 30.5.2, ts-jest 29.4.14, @types/jest 30.0.0, typescript-eslint 8.71.0 y sharp
0.35.5. Quedan 2 bajas, por debajo del umbral de `high`.

### G-9 · La puerta de calidad podía quedar verde sin ejecutar una sola prueba — **CERRADO**

El más grave de los que han aparecido, y no estaba en ningún sitio. Las ocho
suites de integración comparten este preámbulo:

```ts
if (saltar()) return;
```

`consume` no devuelve una promesa, así que las pruebas tienen que esperar a que
el consumidor termine, y lo hacían con un salto temprano cuando la base de datos
no estaba disponible. El problema no es que se salten: es que **Jest cuenta un
`return` temprano como una prueba aprobada**. Sin base de datos, las 133 pruebas
de integración pasaban, la puerta entera pasaba, y el resultado era:

| | Con REQUIRE_INTEGRATION=1 | Sin él |
|---|---|---|
| Pruebas | 133 aprobadas | 133 aprobadas |
| Cobertura real | 66,24 % | 38,81 % |
| `broker.ts` ejecutado | sí | 3,38 % |

Un `npm run verify` en verde, con las tres capas de infraestructura apagadas. El
flag `REQUIRE_INTEGRATION` ya existía precisely para evitarlo, pero había que
activarlo a mano y el valor por defecto era el peligroso. CI lo fijaba, así que
nunca estuvo expuesto; el que estaba expuesto era el desarrollo local, que es
donde una puerta de calidad se consulta para saber si se puede seguir.

**Corregido** con `jest.global-setup.js`, que hace tres cosas: carga `.env` sin
pisar las variables que ya vengan definidas (por eso CI manda sobre el fichero),
traduce los nombres de servicio de Compose a `127.0.0.1` porque solo resuelven
dentro de la red de Compose, y pone `REQUIRE_INTEGRATION=1` por defecto. El salto
pase a ser un fallo ruidoso, y la única forma de aceptarlo es `SKIP_INTEGRATION=1`,
que también dice en la consola lo que va a pasar.

**Lo que destapó.** Al ejecutarse de verdad las pruebas, apareció un fallo
intermitente que llevaba tiempo oculto: `consumer-idempotency.int.test.ts`
esperaba con `setTimeout(150)` a que el consumidor confirmara el mensaje. Con las
17 suites en paralelo, 150 ms no bastaban y la prueba fallaba sin que hubiera nada
que corregir en el código. Sustituido por una espera activa sobre la condición,
con techo de 5 s. Tres ejecuciones seguidas y dos `npm run verify` completos
seguidos, los cuatro en verde.

**Lo que queda.** El patrón `if (saltar()) return;` sigue en las ocho suites, y
sigue siendo la forma correcta de handlear "aquí no hay MySQL". Lo que ya no
existe es la posibilidad de que eso pase inadvertido. Merece la pena vigilance
sobre cualquier suite nueva que use ese patrón: `REQUIRE_INTEGRATION` convierte
el salto en fallo, pero solo mientras `jest.global-setup.js` siga cableado en
`jest.config.js`, y ahí es donde se puede romper sin que nadie se entere.

### G-10 — `notification-service` no tenía ni una prueba unitaria — **CERRADO**

Era el único servicio con **cero** unitarias, y no por una razón de fondo: casi
toda su lógica cabe en el dominio y en dos casos de uso, sin motor ni framework
que justifique esperar a la infraestructura. `tests/notification.unit.test.ts`
añade 48 pruebas: 10 suites y 235 unitarias en el total del backend. La
nueva prueba de integración `seeds-idempotency.int.test.ts` queda aparte, sin
mover las cifras del anterior (7 pruebas adicionales). ToTo = 375.

Lo que cubren, que es lo que solo se ve desde dentro:

| Invariante | Por qué importa |
|---|---|
| El aviso nace `NO_LEIDA` y sin identificador | El estado no se recibe como parámetro, así que ningún manejador puede insertar uno ya leído |
| El cuerpo no admite correo ni teléfono | La bandeja no puede convertirse en un directorio (RF31, RNF84, riesgo N-01) |
| Una fecha ISO no se confunde con un teléfono | Si no, el aviso de necesidad por vencer (RF171) no se podría escribir nunca |
| Marcar el aviso de otro responde 404, no 403 | Un 403 confirmaría que el identificador existe y permite enumerar la bandeja ajena |
| `leida_at` conserva la primera lectura | Un cliente con el reloj desfasado no puede mover hacia atrás la fecha en que el usuario leyó |
| Marcar dos veces no es un error | Pulsar dos veces, o que la aplicación reintente, no es un fallo del usuario |
| La vista no expone `idUsuario` | Quien lee sus avisos ya sabe quién es |
| La bandeja se pagina y se tops | Sin tope, una petición puede pedir la bandeja entera |

Resultado: dominio al **100 %** en las cuatro métricas y los dos casos de uso al
100 %. La cobertura global baja ligeramente tras añadir la suite de
integración `db/tests` (no recorre src): **66.24 % sentencias, 53.67 % ramas,
65.45 % funciones, 68.24 % líneas**. Lo relevante es que la puerta sigue en
verde y el fallo queda detectado si los seeds dejan de ser idempotentes.

**Lo que queda.** La capa HTTP y la de persistencia de este servicio solo la
siguen cubriendo las pruebas de integración. Y una comprobación que salió de
aquí: `tsconfig.json` de cada servicio declara `include: ["src/**/*"]`, así que
`tsc --build` **no** mira los tests. No es un agujero —ts-jest los compila con
`strict: true` y sus diagnósticos tumban la suite, comprobado con un error de
tipo deliberado—, pero conviene saberlo antes de fiarse de `typecheck`.

---

## H. Documentación ausente

| Falta | Dónde debería estar |
|---|---|
| Readme, modelo de datos, eventos, decisiones y runbook de `provider-service` | `09-microservices/services/03-provider-service/` |
| Lo mismo para `catalog-service` | `04-catalog-service/` |
| Lo mismo para `request-service` | `05-request-service/` |
| Lo mismo para `rating-service` | `06-rating-service/` |
| Lo mismo para `notification-service` | `07-notification-service/` |
| Lo mismo para `admin-reporting-service` | `08-admin-reporting-service/` |
| Grafo de eventos entre servicios | nuevo, nowhere → **resuelto**: [`02-GRAFO-DE-EVENTOS.md`](02-GRAFO-DE-EVENTOS.md) |
| `technical-backlog.md` | `15-project-control/` — lo prescribe su propio README |
| `open-questions.md` | `15-project-control/` — lo prescribe su propio README |

Solo 2 de 8 servicios tienen documentación. El **grafo de eventos** era la pieza
más importante de esta lista, porque sin él no se puede trazar un dato desde que
nace en un servicio hasta que aparece en la vista de otro. Resuelto el 2/10/2026:
[`02-GRAFO-DE-EVENTOS.md`](02-GRAFO-DE-EVENTOS.md) documenta los 31 eventos, quién
los publica, a qué cola llega cada uno, quién lo atiende y cuáles se descartan en
silencio. Al escribirlo aparecieron tres deudas que no estaban en ninguna parte:
seis eventos que se publican y nadie atiende, dos declarados que nadie publica, y
un patrón de suscripción que contradice lo que su propio comentario promete.

### La ficha del catálogo de servicios está obsoleta
`09-microservices/service-catalog.md` §Service registry marca los ocho servicios como
🔴 *Planned*, y lo justifica con que «la arquitectura de microservicios no ha sido
aprobada todavía». Los tres ADRs están aceptados desde el 30/09/2026. Es una línea
por servicio.

---

## Cómo se cierra un elemento de este backlog

Siguiendo `00-governance/definition-of-done.md` §Validation Before Completion:

1. Los criterios de aceptación están completos
2. Todas las pruebas aplicables pasan
3. No queda ningún defecto crítico ni bloqueante
4. La documentación está actualizada
5. El trabajo está en el repositorio

Y con la condición que la propia Definition of Done impone: **una excepción no
puede usarse para ignorar un criterio crítico de seguridad, funcionalidad o
aceptación**. El SRS marca la política de datos personales como bloqueante de
producción, y no existe. No es una excepción que se pueda aplicar.
