# Backlog de trabajo abierto

Todo lo que está pendiente en Punto Amigo, con su origen documental, su prioridad
y **qué hay que cumplir exactamente para poder cerrarlo**. Fecha de corte: 3 de
octubre de 2026.

Un elemento solo se cierra cuando se cumple su criterio de cierre y su verificación
queda registrada. Un pendiente marcado «decisión» no se puede cerrar con trabajo
técnico: necesita una respuesta tuya.

> **Fase 5 cerrada el 3/10/2026.** A-1, A-2, A-3 (y sus duplicados B-2 y B-3) y
> AT-004 están cerrados con código y prueba; el detalle está en
> [FASE-5-ENTREGA.md](FASE-5-ENTREGA.md). El grupo **I** es nuevo: cuatro
> hallazgos que aparecieron al construirlos y que no estaban registrados.
>
> **Los 13 pendientes de los grupos A, B y C ya tienen decisión.** Se tomaron el
> 3/10/2026 y están en [02-DECISIONES.md](02-DECISIONES.md): 1 cerrado, 9 asignados a
> las Fases 5, 6 y 9, y 3 duplicados que se cierran con su original. Tener decisión
> **no** es estar cerrado: el criterio de cierre de cada uno sigue siendo el que está
> escrito aquí abajo.

---

## Resumen

| Grupo | Orígenes | Elementos | Abiertos | Decisión pendiente |
|---|---|---|---|---|
| A. Pendientes de la Fase 1 | `FASE-1-ENTREGA.md` §6 | 3 | **0** | 0 · los 3 cerrados en Fase 5 |
| B. Pendientes de la Fase 2 | `FASE-2-ENTREGA.md` §6 | 6 | **3** | 0 · B-1, B-2 y B-3 cerrados |
| C. Pendientes de la Fase 3 | `FASE-3-ENTREGA.md` §7 | 4 | **0** | 0 · los 4 cerrados |
| D. Deuda técnica registrada | `05-architecture/overview.md` §14 | 7 | **3** | 2 (AT-001, AT-003) · AT-004, AT-005, AT-006 y AT-007 cerrados |
| E. Preguntas abiertas | `srs-microservices.md` §11 | 12 | 12 | 5 bloqueantes |
| F. Brechas de trazabilidad | `traceability-matrix.md` §10 | 8 | 8 | 0 |
| G. Calidad del repositorio | medido el 3/10/2026 | 8 | **1** | 0 · G-3 decidido |
| H. Documentación ausente | §H, abajo | 9 | **0** | 0 · los 9 cerrados en Fase 9 |
| I. Hallazgos de las Fases 5 y 6 | §I, abajo | 6 | **4** | 0 · I-5 e I-6 cerrados |
| J. Hallazgos de la Fase 8 | §J, abajo | 3 | **2** | 0 · J-2 cerrado |
| **Total** | | **66** | **33** | **7** |

El recuento de G subió de 5 a 8 porque G-6, G-7 y G-8 se añadieron después de la
primera versión de esta tabla y no se habían contado. Siete de los ocho están
cerrados; el único abierto es **G-3**, la brecha de cobertura hasta el 80 %.

A las ocho decisiones pendientes hay que añadir una que no está en ningún grupo: la
**revisión por Pull Request** (`00-FLUJO-DEL-PROYECTO.md` §11.5), que bloquea el
Go/No-Go de la Fase 10.

Fases 1 y 2 comparten dos pendientes que son en realidad el mismo problema: los
seeds no idempotentes aparecen como A-1 y B-3, y la re-emisión de réplicas como
A-2 y B-2. El teléfono aparece dos veces más, como B-1 y C-4. Descontando los tres
duplicados, el recuento real de trabajo distinto abierto es de **46**, no de 49.

Nota: las versiones anteriores de este párrafo llamaban a estos pendientes `F1-1`,
`F2-3`, `F1-2` y `F2-2`. Esos identificadores no existen en ninguna parte del
documento; los reales son los de los grupos A, B y C.

---

## A. Pendientes de la Fase 1 — Base de datos

Origen: `FASE-1-ENTREGA.md` §6.

### A-1 · Las semillas borran antes de insertar — **CERRADO** el 3/10/2026
**Cerrado con.** Upsert por clave natural en los dos seeds, y 6 pruebas en
`db/tests/seeds.int.test.ts`. Verificado por la ruta del CLI: `db:reset` y luego
tres `db:seed` dan 4 usuarios nuevos, 0 y 0, con los identificadores 1-4
intactos, 4 filas `UserRegistered` en lugar de 12 y 7 asignaciones de rol en
lugar de 21. Detalle en [FASE-5-ENTREGA.md](FASE-5-ENTREGA.md) §2.

Lo que decia este elemento:
**Qué pasa.** Cada `db:seed` borra las filas y luego inserta. Los identificadores
cambian en cada ejecución, así que los perfiles derivados quedan apuntando a
usuarios que ya no existen y los datos de la sesión anterior desaparecen.
**Por qué importa.** Un `docker compose up` de desarrollo destruye estado.
**Cierra cuando.** Los seeds son idempotentes: repetirlos no rompe la integridad
referencial, y hay una prueba que lo demuestra ejecutándolos dos veces seguidas.
**Fase destino.** 5 (Datos y operación).

### A-2 · Las réplicas no se pueden reconstruir — **CERRADO** el 3/10/2026
**Cerrado con.** `node db/cli.js reemit` (`npm run db:reemit`), 5 pruebas en
`db/tests/reemit.int.test.ts` —incluida la que el criterio pedia: borrar
`prestador_ref` y recuperarla— y una ejecucion real que encolo 4 eventos de
usuario y 13 de categoria. Detalle en [FASE-5-ENTREGA.md](FASE-5-ENTREGA.md) §3.

**Lo que NO cubre, y queda abierto:** `cancelacion_ref`. Su evento imputa la
cancelacion a la tasa de un usuario, asi que re-emitirlo contaria dos veces
cancelaciones reales y podria suspender a un prestador. Ver §I.

Lo que decia este elemento:
**Qué pasa.** Las tablas `*_ref` se alimentan de eventos consumidos. Si se pierde
`outbox_event` o `processed_event`, no hay forma de volver a poblarlas. El catálogo
se queda sin prestadores.
**Por qué importa.** Una recuperación ante desastres es irrecuperable sin esto, y
es prerrequisito de AT-004.
**Cierra cuando.** Existe un comando de re-emisión por servicio, documentado, y se
ha ejecutado al menos una vez reconstruyendo `prestador_ref` desde cero.
**Fase destino.** 5.

### A-3 · `statistics_snapshot` no tiene a nadie que la escriba — **CERRADO** el 3/10/2026
**Cerrado con.** `CalculateStatisticsUseCase` y un barrido horario en
`admin-reporting-service`, con 6 pruebas unitarias y 2 de integracion. Dos
metricas, `auditoria_eventos` y `moderaciones`, que son las unicas calculables
sin salir de `pa_admin`. Detalle en [FASE-5-ENTREGA.md](FASE-5-ENTREGA.md) §4.

Lo que decia este elemento:
**Qué pasa.** La tabla existe en `pa_admin`, `admin-reporting-service` la lee y
consulta, y **ningún proceso la calcula**. Los reportes salen vacíos.
**Por qué importa.** Los reportes y las estadísticas son el módulo 13 del SRS y una
función explícita del alcance MVP.
**Cierra cuando.** Hay un proceso programado que la puebla, con métricas
documentadas, y una prueba que verifica que una fila aparece.
**Fase destino.** 5.

---

## B. Pendientes de la Fase 2 — Backend

Origen: `FASE-2-ENTREGA.md` §6. El propio documento dice que ninguno bloquea la
Fase 3 y que conviene resolverlos. Siguen abiertos.

### B-1 · El teléfono no llega al contacto posterior al acuerdo — **CERRADO** el 3/10/2026
**Cerrado con.** El teléfono sale del perfil de prestador, por el camino completo: migración, los dos eventos de perfil, consumidor, réplica, lectura y `db/reemit.js`. 5 pruebas de integración y una aserción en el E2E. Cierra también C-4. Detalle en [FASE-6-ENTREGA.md](FASE-6-ENTREGA.md) §2.

Lo que decia este elemento:
**Qué pasa.** Tras adjudicarse una solicitud, la pantalla de detalle de
contratación no muestra el teléfono de la contraparte.
**Decisión del 3/10/2026.** Opción **(c)**: sale del **perfil de prestador**, que es
donde el oferente declara el dato *para que le contacten*. Motivo en
[02-DECISIONES.md](02-DECISIONES.md) §2.
**Cierra cuando.** La pantalla de detalle de contratación muestra el teléfono del
perfil de prestador tras la adjudicación, y **solo a las dos partes** de esa
solicitud. Con prueba del caso negativo: un tercero no lo ve.
**Fase destino.** 6. Cierra B-1 y C-4 a la vez.
**Opciones que se descartaron, según `FASE-2-ENTREGA.md` §6.1:**
  - (a) el teléfono del usuario registrado — se dio para administrar la cuenta, no
    para publicarlo a una contraparte
  - (b) un teléfono de contacto dedicado — resuelve la privacidad, pero añade
    migración y pantalla nueva para un dato que ya existe en el sitio correcto

### B-2 · Réplicas no reconstruibles
Duplicado de A-2. Se cierran juntos.

### B-3 · El seed recrea usuarios con identificadores nuevos
Duplicado de A-1. Se cierran juntos.

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

### B-6 · Fuera del alcance del MVP · **DECIDIDO**
Pagos, notificaciones por correo o push, y el cálculo de `statistics_snapshot`.

**Decisión del 3/10/2026**, en cinco partes:

| Canal | Resolución |
|---|---|
| Push | **Descartado.** La bandeja intraaplicación cubre el MVP |
| Correo de producto (avisos, propuestas, adjudicaciones) | **Descartado.** Mismo motivo |
| **Correo transaccional** (recuperación de contraseña) | **Entra, Fase 6.** Sin él, C-1 es imposible de cerrar |
| Pagos | Fuera de alcance, sin cambio. Ya excluido en `01-context/scope.md` |
| `statistics_snapshot` | Entra en la Fase 5. Es A-3; estaba mal agrupado aquí, no es un canal de notificación |

**Consecuencia:** la **Fase 7 se elimina** del plan de fases. Motivo completo en
[02-DECISIONES.md](02-DECISIONES.md) §2 y §4.

---

## C. Pendientes de la Fase 3 — Cliente web

Origen: `FASE-3-ENTREGA.md` §7.

### C-1 · Recuperación de contraseña sin canal de entrega — **CERRADO** el 3/10/2026
**Cerrado con.** Consumidor de correo transaccional en `notification-service` y `nodemailer@^10.0.14`. 13 pruebas unitarias y un recorrido en navegador que pide el enlace, lo abre, cambia la contraseña y entra con la nueva. Detalle en [FASE-6-ENTREGA.md](FASE-6-ENTREGA.md) §3.

Lo que decia este elemento:
**El título de este pendiente era incorrecto.** Decía «sin interfaz», y la interfaz
ya está: las pantallas compilan y las rutas `/recuperar` y `/restablecer` están
cableadas en `App.tsx` desde la Fase 4 (ver G-5). Lo que falta es **el canal**.

**Qué pasa de verdad.** `PasswordRecovery.solicitar()` crea el token y lo mete en un
evento `UserProfileUpdated` con `accion: 'RECUPERACION_SOLICITADA'`
(`services/auth-service/src/application/use-cases/PasswordRecovery.ts:66`). El relevo
del outbox lo publica. **Nadie lo consume:** `notification-service/src/main.ts`
registra 11 manejadores y `UserProfileUpdated` no está entre ellos, así que el
consumidor hace `ack` y el token **se descarta en silencio**. El enlace de
restablecimiento no llega a ningún sitio.

La bandeja intraaplicación no lo arregla: quien olvidó la contraseña no puede iniciar
sesión, y sin sesión no puede leer la bandeja. Es circular.

**Decisión del 3/10/2026.** Entra el **correo transaccional** —y solo el
transaccional— con un consumidor de `UserProfileUpdated` que envíe el enlace. Ver
[02-DECISIONES.md](02-DECISIONES.md) §4.
**Cierra cuando.** El recorrido completo pasa en una prueba: pedir recuperación →
llegar el correo → abrir el enlace → restablecer → entrar con la contraseña nueva.
**Al implementarlo.** Es el único evento del sistema que transporta un secreto. Su
consumidor debe seguir siendo único, el token no puede acabar en un log, y el cuerpo
del correo no puede confirmar si la cuenta existe: el endpoint devuelve 202 siempre
justo para no ser un verificador de correos registrados.
**Fase destino.** 6.

### C-2 · Faltan los iconos del PWA — **CERRADO** el 3/10/2026
**Criterio de cierre.** `icono-192.png`, `icono-512.png` y `icono.svg` existen, están
declarados en el manifiesto y se ven bien en pantalla de inicio.

**Verificado:**

| Comprobación | Resultado |
|---|---|
| `icono-192.png` existe y mide 192×192 | sí |
| `icono-512.png` existe y mide 512×512 | sí |
| `icono-maskable-512.png` existe y mide 512×512, `purpose: maskable` | sí |
| `icono.svg` existe | sí |
| `manifest.webmanifest` declara los cuatro | sí |
| `index.html` enlaza el manifiesto y el `apple-touch-icon` | sí, líneas 18-19 |

Las dimensiones se midieron con `sharp`, no se dedujeron del nombre del archivo. Esa
distinción importa: el bug que G-5 encontró aquí era que `icono-192.png` e
`icono-512.png` eran byte a byte idénticos porque el generador declaraba el tamaño y
no lo usaba al rasterizar.

**Lo único que no se verifica automáticamente** es «se ven bien en pantalla de
inicio»: requiere instalar la PWA en un dispositivo. Queda como comprobación manual
dentro del E2E de la Fase 6 (C-3), no como pendiente abierto.

### C-3 · No hay pruebas de extremo a extremo — **CERRADO** el 3/10/2026
**Cerrado con.** 4 pruebas Playwright en `e2e/` y un job de CI propio, `Recorrido en navegador`. Cubren el recorrido crítico completo y la recuperación de contraseña, y encontraron un defecto que ninguna otra prueba veía: ver I-5. Detalle en [FASE-6-ENTREGA.md](FASE-6-ENTREGA.md) §4.

Lo que decia este elemento:
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
| AT-002 | Estructura REST definitiva | P1 | Las rutas de los 63 endpoints están congeladas y el SRS refleja la decisión |
| AT-003 | Organización de los repositorios | P2 | Se decide si `friend-point-docs` y `friend-point-development` se fusionan, se separan o se quedan. **Decisión** |
| ~~AT-004~~ | ~~Procedimiento de restauración de respaldos~~ · **CERRADO** 3/10/2026 | ~~P1 · High~~ | Cumplido: [03-RUNBOOK-RESPALDOS.md](03-RUNBOOK-RESPALDOS.md) y `db/respaldo.sh`. Los 7 esquemas restaurados y verificados, 69 tablas comparadas, `restauracion_probada_at` con valor real en las 7 filas |
| ~~AT-005~~ | ~~Herramientas de monitoreo y logging~~ · **CERRADO** 4/10/2026 | ~~P2~~ | Cumplido: una línea JSON con `correlation_id` por petición en los nueve procesos, nueve `/metrics`, y Prometheus con Grafana en el perfil `observabilidad`. Los 10 objetivos verificados en `up`. Ver [05-OBSERVABILIDAD.md](05-OBSERVABILIDAD.md) |
| ~~AT-006~~ | ~~Valores de expiración de JWT~~ · **CERRADO** 4/10/2026 | ~~P1~~ | Cumplido: access 15 min, refresco 7 días, recuperación 30 min de un solo uso, y la lista de denegación caduca cuando caduca el token. Tenía un literal de 900.000 ms escrito a mano en la ruta de cierre de sesión; ahora sale de `JWT_ACCESS_TTL_SECONDS` y hay prueba de regresión que falla con el valor anterior |
| ~~AT-007~~ | ~~Límites de escalabilidad~~ · **CERRADO** 4/10/2026 | ~~P2~~ | Cumplido: `npm run carga` con el umbral declarado como `threshold`. P95 **6,98 ms** contra 300 ms y **0 %** de error sobre 5.403 comprobaciones |

~~**AT-004 es el único de severidad High del proyecto.**~~ Cerrado el 3/10/2026. Ya no bloquea la Fase 10; lo que sigue bloqueándola es la política de datos personales.

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

### G-3 · La brecha de cobertura hasta el 80 % — **ABIERTO**, con decisión tomada
La parte de «nunca se ha medido» está **cerrada**. Medida con las 320 pruebas en
verde: **66.04 % sentencias, 53.79 % ramas, 65.27 % funciones, 68.03 % líneas**. Muy
lejos del 80/80/80/70 que pedía la estrategia.

El umbral de `jest.config.js` se baja a los valores reales medidos menos ~1 punto
(65/52/64/67) como **trinquete**: la cobertura puede subir, pero si baja, la puerta
se pone en rojo. Es el mecanismo que la propia estrategia pide («if a PR lowers
coverage, CI fails»); el 80 % queda como objetivo a alcanzar con pruebas, no como
una puerta que se declara verde sin comprobarla.

**Decisión del 3/10/2026: el trinquete se queda donde está.** Subir al 80 % son unos
14 puntos de sentencias y 20 de ramas, concentrados en los repositorios de
persistencia: varios días de pruebas, no un ajuste de configuración. Ver
[02-DECISIONES.md](02-DECISIONES.md) §3.

**Lo que sigue abierto, y es por lo que este elemento no está cerrado:**

| Exigido por `11-quality/testing-strategy.md` | Configurado | Distancia |
|---|---|---|
| Ramas global 75 % | 52 % | 21 puntos |
| `./src/domain/` líneas 90 % | sin override | sin medir por capa |
| `./src/domain/` ramas 85 % | sin override | sin medir por capa |

Estas dos filas de override son las dos discrepancias que `FASE-4-PLAN.md` §5 se
proponía cerrar en la Fase 4 y que **no se cerraron**. Quedan aquí, no en la Fase 4.

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

---

## H. Documentación ausente

**Los nueve elementos quedan cerrados el 4/10/2026** (Fase 9). Se escribieron en
el repositorio de código y no en `friend-point-docs`, que está congelado y cuya
organización es la decisión pendiente AT-003.

| Falta | Estado |
|---|---|
| ~~Readme, modelo de datos, eventos, decisiones y runbook de `provider-service`~~ | **CERRADO** · [docs/servicios/03-provider-service/](servicios/03-provider-service/README.md) |
| ~~Lo mismo para `catalog-service`~~ | **CERRADO** · [04-catalog-service](servicios/04-catalog-service/README.md) |
| ~~Lo mismo para `request-service`~~ | **CERRADO** · [05-request-service](servicios/05-request-service/README.md) |
| ~~Lo mismo para `rating-service`~~ | **CERRADO** · [06-rating-service](servicios/06-rating-service/README.md) |
| ~~Lo mismo para `notification-service`~~ | **CERRADO** · [07-notification-service](servicios/07-notification-service/README.md) |
| ~~Lo mismo para `admin-reporting-service`~~ | **CERRADO** · [08-admin-reporting-service](servicios/08-admin-reporting-service/README.md) |
| ~~Grafo de eventos entre servicios~~ | **CERRADO** · [07-GRAFO-DE-EVENTOS.md](07-GRAFO-DE-EVENTOS.md): los 29 eventos, sus consumidores, los 6 que nadie escucha y el orden de diagnóstico |
| ~~`technical-backlog.md`~~ | **CERRADO** · [08-BACKLOG-TECNICO.md](08-BACKLOG-TECNICO.md), con el formato que prescribe la gobernanza |
| ~~`open-questions.md`~~ | **CERRADO** · [09-PREGUNTAS-ABIERTAS.md](09-PREGUNTAS-ABIERTAS.md). **Siete de las doce preguntas ya estaban contestadas por el código**, cuatro de ellas bloqueantes |

Lo que el grafo de eventos dejó a la vista, y que nadie había escrito: hay
**seis eventos que ningún servicio consume**, y las semillas no escriben en el
outbox, así que una base recién creada tiene todas las réplicas vacías. Eso
último es exactamente lo que hacía fallar el recorrido E2E en CI.

### La ficha del catálogo de servicios está obsoleta
`09-microservices/service-catalog.md` §Service registry marca los ocho servicios como
🔴 *Planned*, y lo justifica con que «la arquitectura de microservicios no ha sido
aprobada todavía». Los tres ADRs están aceptados desde el 30/09/2026. Es una línea
por servicio.

---

---

## I. Hallazgos de las Fases 5 y 6 que no estaban registrados

Aparecieron al construir la re-emisión y el escritor de métricas. Ninguno estaba
en este backlog antes del 3/10/2026.

### I-1 · Tres réplicas sin ningún escritor
**Qué pasa.** Tienen migración y **cero código** que las alimente:

| Réplica | Esquema | Evento que debería alimentarla |
|---|---|---|
| `usuario_ref` | `pa_provider` | `UserRegistered` — no hay consumidor |
| `usuario_ref` | `pa_rating` | `UserRegistered` — no hay consumidor |
| `reputacion_ref` | `pa_request` | `ReputationRecalculated` — su único consumidor es catalog, y escribe `service_rating_summary`, no esta tabla |

**Por qué importa.** Hoy están vacías, así que no son una fuga de datos, pero son
tres copias declaradas que nadie mantiene. O se consumen o se borran: una tabla
réplica permanentemente vacía hará que alguien escriba un JOIN contra ella.
**Cierra cuando.** Cada una tiene un consumidor que la escribe, o su migración se
elimina con una justificación.
**Fase destino.** 9 si se eliminan (es documentación y modelo), 6 si se alimentan.

### I-2 · `cancelacion_ref` no se puede reconstruir
**Qué pasa.** `db/cli.js reemit` deja fuera `ServiceRequestCancelled` a propósito:
su consumidor imputa la cancelación a la tasa de un usuario, así que re-emitirlo
contaría dos veces cancelaciones reales y podría cruzar el umbral que suspende a
un prestador. El payload original enmascara `peso` y `computa` según el estado de
la revisión y recalcula `faceta`, de modo que tampoco se puede reconstruir
fielmente desde la tabla.
**Cierra cuando.** Existe un evento de re-emisión que puebla la réplica **sin**
pasar por el cálculo de la tasa, o se acepta por escrito que esa réplica se
reconstruye a mano.
**Fase destino.** 8 (operación).

### I-3 · `processed_event` tiene un índice para una purga que no existe
**Qué pasa.** `db/helpers.js` crea `idx_processed_purga` en los seis esquemas que
consumen eventos. No hay ningún código que purgue esa tabla.
**Por qué importa.** Crece una fila por evento consumido y por consumidor, para
siempre.
**Cierra cuando.** Hay un proceso de purga con su plazo, que depende de la
decisión 4.1 de [04-POLITICA-DATOS-PERSONALES.md](04-POLITICA-DATOS-PERSONALES.md).
**Fase destino.** 8.

### I-4 · `exigirEstadoPrestador` está exportada y nunca se llama
**Qué pasa.** `catalog-service/src/application/use-cases/SyncProviderRef.ts` la
exporta con la lista de estados válidos y un error claro. El manejador real hace
`String(...) as EstadoPrestador`, un cast sin comprobar.
**Por qué importa.** Un estado desconocido entra en `prestador_ref`, y el filtro
`estado = 'ACTIVE'` de la búsqueda pública lo excluye para siempre sin ruido: el
prestador desaparece del catálogo y nadie sabe por qué.
**Cierra cuando.** El manejador la usa, o la función se elimina.
**Fase destino.** 6.


### I-5 · Recargar una pantalla dejaba al usuario sin roles — **CERRADO** el 3/10/2026
**Qué pasaba.** El cliente guarda el token solo en memoria. En una carga en frío
—una recarga, o abrir un enlace directo— la sesión se reconstruía solo con
`/auth/refresh`, que **no devolvía el usuario**, y el cliente lo resolvía con
`?? { id: 0, nombre: '', roles: [] }`. Toda pantalla con rol respondía «Esta
pantalla no es para su perfil».
**Por qué no lo veía nadie.** Las pruebas de cliente montan los componentes con
la sesión ya puesta; ninguna hacía una carga en frío con solo la cookie.
**Cerrado con.** `/auth/refresh` devuelve el usuario que su caso de uso ya
cargaba, el cliente deja de inventar una sesión vacía, y hay una prueba de
integración de regresión. Lo encontró la primera E2E del recorrido.

### I-6 · El resultado de una cancelación no se llega a ver
**Qué pasa.** `Contratacion.tsx` monta `<Cancelar>` solo mientras el estado es
`PENDIENTE` o `ACEPTADA`. Al cancelar, el estado pasa a `CANCELADA` y el
formulario —con su mensaje de resultado— se desmonta antes de que nadie lo lea.
**Por qué importa.** Ese mensaje explica si la cancelación cuenta en la tasa y
con qué peso. Es la única vez que se le dice a la persona, y no se ve.
**CERRADO** el 4/10/2026 (Fase 9). `Contratacion.tsx` deja montado el componente
cuando el estado pasa a `CANCELADA` y `Cancelar` no pinta nada si entra ya
cancelada, así que el mensaje con el peso sobrevive al cambio de estado. La
prueba monta la **página** y no el componente, porque el defecto estaba en la
condición de la página: una prueba sobre el componente suelto pasaba en verde con
el defecto puesto. Verificado que falla al reintroducirlo.

## J. Hallazgos de la Fase 8 que no estaban registrados

Salieron al poner en verde la observabilidad y la prueba de carga. El detalle de
los siete defectos que bloqueaban el recorrido E2E en CI está en
[FASE-8-ENTREGA.md](FASE-8-ENTREGA.md) §3; aquí quedan solo los que siguen
abiertos.

### J-1 · Un limitador por IP detrás del gateway no limita por cliente
**Qué pasa.** Cada uno de los siete servicios internos aplica
`RATE_LIMIT_MAX_PER_IP`, pero **todas** sus peticiones llegan desde una sola IP,
la del gateway. Con el valor por omisión de 100 por minuto, el techo efectivo de
todo el sistema son 100 peticiones por minuto, con independencia de cuántos
clientes haya.
**Cómo se descubrió.** La prueba de carga recibía 429 desde catalog-service con
el límite del gateway ya elevado. Ver [05-OBSERVABILIDAD.md](05-OBSERVABILIDAD.md) §4.
**Por qué importa.** No es solo que estorbe a la prueba: en producción, dos
usuarios activos podrían agotar el cupo del sistema entero. Y el limitador
interno no protege de nada que el del gateway no cubra ya, porque los servicios
no son alcanzables desde fuera.
**CERRADO** el 4/10/2026. El limitador de los siete servicios internos usa
ahora `claveDeLimite`, que toma la identidad que inyecta el gateway y solo cae a
la IP cuando no hay ninguna —rutas públicas, que es el caso que el limitador por
IP del gateway ya controla cliente a cliente antes de llegar aquí—.
**Verificado contra la pila**, con el límite en su valor real de 100 por minuto:
el usuario 34 agotó su cupo en la petición 101 y recibió 429, mientras el
usuario 35 seguía recibiendo 200. Antes los dos compartían contador.

### J-2 · Una prueba de integración que se omite se cuenta como aprobada
**Qué pasa.** Las pruebas de integración se saltan solas cuando no alcanzan
MySQL y Jest las reporta como pasadas. Antes de la Fase 8, en una máquina sin el
`.env` exportado, eso eran 151 pruebas «en verde» sin tocar la base y una
cobertura de 42 % contra un umbral de 67 % sin que nada fallara.
**Qué se hizo ya.** `jest.config.js` carga el `.env` y fija `MYSQL_HOST`, así
que en una máquina de desarrollo normal ya no se omiten. Existe además
`REQUIRE_INTEGRATION=1`, que convierte la omisión en fallo.
**Lo que queda: nada, y conviene decirlo.** Al revisarlo para la Fase 9, CI ya
pasaba `REQUIRE_INTEGRATION: '1'` en el trabajo que ejecuta `verify`
(`.github/workflows/ci.yml`), así que allí una omisión siempre fue un fallo. El
agujero era **solo local**, y lo tapó la carga del `.env` en `jest.config.js`.
**CERRADO** el 4/10/2026, por comprobación: la mitad de CI ya estaba hecha antes
de que este elemento se escribiera.

### J-3 · El documento de DevOps contradice al código en tres puntos
**Qué pasa.** `10-devops/environments.md` prescribe la convención
`APP_[SERVICIO]_[VARIABLE]`, pone ejemplos con PostgreSQL y da por hecho un
gestor de secretos. El código usa `JWT_PRIVATE_KEY` y compañía, MySQL 8 con
siete esquemas, y un `.env`.
**Por qué importa.** Quien monte un entorno con ese documento en la mano
construirá otra cosa.
**Cierra cuando.** Se decide cuál de los dos manda en cada punto y el otro se
corrige. Las tres diferencias están listadas en
[06-ENTORNOS-Y-DESPLIEGUE.md](06-ENTORNOS-Y-DESPLIEGUE.md) §2.
**Fase destino.** 9.

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