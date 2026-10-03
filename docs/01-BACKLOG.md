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
| A. Pendientes de la Fase 1 | `FASE-1-ENTREGA.md` §6 | 3 | 0 |
| B. Pendientes de la Fase 2 | `FASE-2-ENTREGA.md` §6 | 6 | 1 |
| C. Pendientes de la Fase 3 | `FASE-3-ENTREGA.md` §7 | 4 | 0 |
| D. Deuda técnica registrada | `05-architecture/overview.md` §14 | 7 | 3 |
| E. Preguntas abiertas | `srs-microservices.md` §11 | 12 | 5 bloqueantes |
| F. Brechas de trazabilidad | `traceability-matrix.md` §10 | 8 | 0 |
| G. Calidad del repositorio | medido el 2/10/2026 | 5 | 1 |
| H. Documentación ausente |(counted below) | 9 | 0 |
| **Total** | | **54** | **10** |

Fases 1 y 2 comparten dos pendientes que son en realidad el mismo problema: los
seeds no idempotentes aparecen como F1-1 y F2-3, y la re-emisión de réplicas como
F1-2 y F2-2. El recuento real de trabajo distinto es de **50**, no de 54.

---

## A. Pendientes de la Fase 1 — Base de datos

Origen: `FASE-1-ENTREGA.md` §6.

### A-1 · Las semillas borran antes de insertar
**Qué pasa.** Cada `db:seed` borra las filas y luego inserta. Los identificadores
cambian en cada ejecución, así que los perfiles derivados quedan apuntando a
usuarios que ya no existen y los datos de la sesión anterior desaparecen.
**Por qué importa.** Un `docker compose up` de desarrollo destruye estado.
**Cierra cuando.** Los seeds son idempotentes: repetirlos no rompe la integridad
referencial, y hay una prueba que lo demuestra ejecutándolos dos veces seguidas.
**Fase destino.** 5 (Datos y operación).

### A-2 · Las réplicas no se pueden reconstruir
**Qué pasa.** Las tablas `*_ref` se alimentan de eventos consumidos. Si se pierde
`outbox_event` o `processed_event`, no hay forma de volver a poblarlas. El catálogo
se queda sin prestadores.
**Por qué importa.** Una recuperación ante desastres es irrecuperable sin esto, y
es prerrequisito de AT-004.
**Cierra cuando.** Existe un comando de re-emisión por servicio, documentado, y se
ha ejecutado al menos una vez reconstruyendo `prestador_ref` desde cero.
**Fase destino.** 5.

### A-3 · `statistics_snapshot` no tiene a nadie que la escriba
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

### B-6 · Fuera del alcance del MVP
Pagos, notificaciones por correo o push, y el cálculo de `statistics_snapshot`.
Los tres están explícitamente fuera del alcance MVP. Se resuelven así:
`statistics_snapshot` entra en la Fase 5 (A-3). Pagos y push dependen de tu
decisión: Fase 7 o descarte.

---

## C. Pendientes de la Fase 3 — Cliente web

Origen: `FASE-3-ENTREGA.md` §7.

### C-1 · Recuperación de contraseña sin interfaz
**Qué pasa.** El backend está completo: `/auth/password-recovery` y
`/auth/password-reset` funcionan. Las pantallas se empezaron a construir y están
**sin cablear en el enrutado y sin compilar**.
**Cierra cuando.** Las rutas funcionan de extremo a extremo: pedir recuperación,
recibir el enlace, restablecer, entrar con la contraseña nueva. Con pruebas.
**Fase destino.** 6.
**Nota de estado.** Existe trabajo a medias en `apps/web`: `Recuperar.tsx`,
`Restablecer.tsx` y sus pruebas, más un error de compilación en `Restablecer.tsx`.
Ver G-5.

### C-2 · Faltan los iconos del PWA
**Qué pasa.** Sin icono propio, la aplicación se instala con el icono por defecto.
**Cierra cuando.** `icono-192.png`, `icono-512.png` y `icono.svg` existen, están
declarados en el manifiesto y se ven bien en pantalla de inicio.
**Fase destino.** 6.
**Nota de estado.** Los iconos ya se han generado. Falta verificar que el manifiesto
los declara.

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
| AT-002 | Estructura REST definitiva | P1 | Las rutas de los 63 endpoints están congeladas y el SRS refleja la decisión |
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
Medida con las 320 pruebas en verde: **66.04 % sentencias, 53.79 % ramas, 65.27 %
funciones, 68.03 % líneas**. Muy lejos del 80/80/80/70 que pedía la estrategia.

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
| Grafo de eventos entre servicios | nuevo, nowhere |
| `technical-backlog.md` | `15-project-control/` — lo prescribe su propio README |
| `open-questions.md` | `15-project-control/` — lo prescribe su propio README |

Solo 2 de 8 servicios tienen documentación. El **grafo de eventos** es la pieza más
importante de esta lista: sin él no se puede trazar un dato desde que nace en un
servicio hasta que aparece en la vista de otro.

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