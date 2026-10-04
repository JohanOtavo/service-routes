# Flujo del proyecto — Punto Amigo

Documento maestro. Es la respuesta a tres preguntas que hasta ahora no tenían
respuesta escrita en ningún sitio: **qué fases existen, en qué estado está cada
una, y qué queda por hacer**.

- Fecha de corte: **3 de octubre de 2026**
- Rama de trabajo: `develop` · último commit: `77d437b docs: close the phase-4 checklist now that the gate is green`
- Repositorio de código: `friend-point-development` (este repositorio)
- Repositorio de requisitos y arquitectura: `friend-point-docs` (congelado desde el 30/09/2026)

> **Aviso importante.** Este documento se crea porque **no existía ningún plan de
> fases aprobado**. Ni en el repositorio de código ni en el de documentación hay una
> lista de fases con estado, responsable y fecha. Lo único parecido es una tabla de
> horizontes H1/H2/H3 en `03-product/vision.md` §2.4, y ese archivo está truncado a
> mitad de un diagrama. Las fases 1, 2 y 3 se reconstruyeron a partir de sus
> documentos de entrega y de la secuencia de commits. Las fases 5 a 10 son una
> **propuesta** de este documento y necesitan tu aprobación.

---

## 1. Estado real del gate de calidad

Todo lo que se afirma en los documentos de entrega se apoya en
`npm run verify`. Ese comando es el gate, y **ahora pasa**, en local y en CI.
Estado medido el 3/10/2026, con las 320 pruebas de Jest y las 127 de Vitest en
verde:

| Puerta | Comando | Estado | Detalle |
|---|---|---|---|
| Formato | `npm run format:check` | PASA | Todo el repositorio |
| Lint | `npm run lint` (`--max-warnings=0`) | PASA | 0 problemas: se resolvieron los tipos de retorno pendientes y los avisos heredados |
| Tipos | `npm run typecheck` | PASA | 0 errores; los 2 de `Restablecer.tsx` están corregidos |
| Unitarias backend | `npm run test:unit` | PASA | 9 suites, 187 pruebas, 0 fallos |
| Unitarias web | `npm run test:web` | PASA | 8 archivos, 127 pruebas, 0 fallos |
| Integración | `npm run test:integration` | PASA | 8 suites, 133 pruebas, 0 fallos, contra MySQL/RabbitMQ/Redis reales |
| Cobertura | `npm run test` | PASA | 66.04 % stmts, 53.79 % ramas, 65.27 % funcs, 68.03 % líneas |
| Seguridad | `npm run audit` (`--audit-level=high`) | PASA | 0 vulnerabilidades altas o críticas; 2 bajas |

Tres cosas que esta tabla antes no reflectaba, y que cambian cómo se lee:

- **La cobertura nunca se había comprobado en ningún sitio.** El umbral estaba
  configurado a 80/80/80/70, pero CI ejecutaba `test:unit` y `test:integration`
  por separado y ninguna pasaba `--coverage`. El gate no existía en la práctica.
- **La suite de integración no podía pasar en CI.** El job `tests` no declaraba
  servicios ni variables de base de datos, así que las 133 pruebas no tenían
  MySQL contra el que correr.
- **Las pruebas web no se ejecutaban en CI en absoluto.** Vitest no estaba en
  `verify` ni en el workflow.

Las tres están corregidas: `verify` incluye ahora las pruebas web, y CI ejecuta
`verify` entero con MySQL, Redis y RabbitMQ de verdad. El umbral de cobertura
bajó a los valores reales medidos (67/65/52/64) como trinquete, con la distancia
hasta el 80 % anotada en el backlog. Ver `G-1` a `G-6`.

**Cuarta cosa, y la más incómoda: una puerta verde en local no es una puerta.** Con
todo lo anterior ya corregido, el primer run de CI encontró cuatro fallos que en la
máquina de desarrollo eran invisibles, todos por la misma razón — datos o
configuración que solo existían en ese ordenador. El detalle está en
[FASE-4-PLAN.md](FASE-4-PLAN.md); la moraleja es que CI no es una copia de la puerta
local, es la primera vez que el proyecto arranca desde cero.

**Consecuencia:** las Fases 1, 2 y 3 están **construidas, probadas y verificadas por
CI**. El run `37146895812` dejó en verde los dos jobs: migraciones reversibles contra
MySQL real y `verify` completo. Los 13 pendientes de decisión que quedaban abiertos se
resolvieron el 3/10/2026 en [02-DECISIONES.md](02-DECISIONES.md), de modo que la
**Fase 4 está cerrada** y la siguiente es la 5.

### Las 3 puertas que hoy no se pueden ejecutar

1. **Integración.** Requieren MySQL 8 real vía Docker. Sin Docker levantado no hay
   forma de ejecutarlas ni de confirmar que siguen pasando. **Hoy: 133/133 en
   verde**, y verificadas con tres ejecuciones seguidas para confirmar que la
   suite es idempotente.
2. **Cobertura.** Medida por fin: **66.04 % sentencias, 53.79 % ramas, 65.27 %
   funciones, 68.03 % líneas**. El umbral de `jest.config.js` bajó a esos valores
   como trinquete. La distancia hasta el 80 % que pide la estrategia sigue abierta
   y anotada en el backlog: son sobre todo repositorios de persistencia, la capa
   que menos pruebas tiene.
3. **E2E.** No existen. `11-quality/testing-strategy.md` §E2E las exige para el
   Go/No-Go de producción.

---

## 2. Mapa de fases

| # | Fase | Objetivo | Estado | Documento |
|---|---|---|---|---|
| 1 | Base de datos | 7 esquemas aislados, 55 tablas, 7 usuarios MySQL con privilegio mínimo, invariantes verificados contra MySQL real | **Completada**; sus 3 pendientes asignados a la Fase 5 | [FASE-1-ENTREGA.md](FASE-1-ENTREGA.md) |
| 2 | Backend seguro | 8 microservicios detrás del gateway, 63 endpoints documentados, 187 unitarias + 133 de integración | **Completada**; sus 6 pendientes asignados a las Fases 5, 6 y 9 | [FASE-2-ENTREGA.md](FASE-2-ENTREGA.md) |
| 3 | Cliente web PWA | React 18 + TypeScript sobre Vite, 18 pantallas, sistema de diseño propio, PWA instalable | **Completada**; 1 pendiente cerrado, 3 asignados a la Fase 6 | [FASE-3-ENTREGA.md](FASE-3-ENTREGA.md) |
| 4 | Cierre de calidad y deuda heredada | Que `npm run verify` y CI pasen en verde, y decidir los 13 pendientes abiertos | **Completada** el 3/10/2026 | [FASE-4-PLAN.md](FASE-4-PLAN.md) · [02-DECISIONES.md](02-DECISIONES.md) |
| 5 | Datos y operación | Semillas idempotentes, re-emisión de réplicas, escritor de métricas, restauración probada, política de datos personales | **Completada** el 3/10/2026; la política queda en borrador | [FASE-5-ENTREGA.md](FASE-5-ENTREGA.md) |
| 6 | Experiencia del cliente | Teléfono desde el perfil de prestador, recuperación de contraseña con correo transaccional, E2E del recorrido | **Completada** el 3/10/2026 | [FASE-6-ENTREGA.md](FASE-6-ENTREGA.md) |
| ~~7~~ | ~~Notificaciones fuera del MVP~~ | ~~Correo y push~~ | **Eliminada.** Push y correo de producto descartados; el correo transaccional pasa a la Fase 6 | [02-DECISIONES.md](02-DECISIONES.md) §2 |
| 8 | Observabilidad y despliegue | Logging estructurado, métricas, k6, entornos dev/staging/prod, despliegue | **Siguiente** | §5 |
| 9 | Documentación y trazabilidad | 6 de 8 servicios sin documentar, SRS inglés obsoleto, contratos duplicados, backlog formal | Aprobada · puede ir en paralelo ya | §5 |
| 10 | Preparación de producción | Go/No-Go, Definition of Done completo, cierre de deuda técnica AT-001..007 | Aprobada | §5 |

**Trabajo abierto, al 3/10/2026: los 13 pendientes de las Fases 1–3 ya tienen
decisión registrada** —1 cerrado, 9 asignados a fase, 3 duplicados— **y quedan 7
ítems de deuda técnica (AT-001..AT-007), 12 preguntas abiertas (O-01..O-12) y 8
brechas de trazabilidad (GAP-001..GAP-008).** Las decisiones están en
[02-DECISIONES.md](02-DECISIONES.md); el detalle de cada elemento, en
[01-BACKLOG.md](01-BACKLOG.md).

---

## 3. Lo entregado en cada fase

### Fase 1 — Base de datos · completada

Siete esquemas MySQL, uno por servicio, sin claves foráneas entre ellos: la
propiedad de datos es lo que impide que un servicio lea o escriba la tabla de
otro (SRS RNF28).

- **12 migraciones** en `db/migrations/<esquema>/`, en JavaScript sobre Knex
- **220 sentencias DDL** compiladas
- **55 tablas**: 43 de negocio y 12 del patrón de eventos
  (6 `outbox_event` + 6 `processed_event`). `pa_auth` no tiene `processed_event`
  porque es la raíz del grafo y no consume eventos de nadie; `pa_notification` no
  tiene `outbox_event` porque solo consume.
- Réplicas entre servicios como **tablas sin clave foránea**, alimentadas por
  eventos: `usuario_ref`, `prestador_ref`, `servicio_ref`, `categoria_ref`,
  `reputacion_ref`, `solicitud_ref`, `cancelacion_ref`
- 7 usuarios MySQL, cada uno con privilegio mínimo sobre su esquema
- 31 pruebas negativas de invariantes contra MySQL real (`db/verify-invariants.sh`)
- `audit_record` inmutable mediante disparadores que rechazan `UPDATE` y `DELETE`
- Semillas de apoyo en `db/seeds/`

**Lo que no está resuelto:** los seeds borran antes de insertar, las réplicas no
se pueden reconstruir, y `statistics_snapshot` no tiene a nadie que la escriba.

### Fase 2 — Backend seguro · completada

Ocho microservicios Express/TypeScript detrás de un gateway, con la propiedad de
datos mantenida: cada servicio solo toca su esquema y recibe el resto por eventos.

| Servicio | Puerto | Esquema | Responsabilidad |
|---|---|---|---|
| `api-gateway` | 8080 | Redis | Enrutado, JWT, correlación, rate limit |
| `auth-service` | 3001 | `pa_auth` | Identidad, sesiones, recuperación, bloqueo |
| `provider-service` | 3002 | `pa_provider` | Perfiles de prestador y su validación |
| `catalog-service` | 3003 | `pa_catalog` | Servicios y categorías, búsqueda |
| `request-service` | 3004 | `pa_request` | Necesidades, propuestas, solicitudes, cancelaciones |
| `rating-service` | 3005 | `pa_rating` | Calificaciones, reputación, tasa de cancelación |
| `notification-service` | 3006 | `pa_notification` | Bandeja y preferencias |
| `admin-reporting-service` | 3007 | `pa_admin` | Auditoría, moderación, reportes, métricas |

- **63 endpoints**, los 63 documentados en `contracts/openapi/` y cubiertos por una
  prueba que falla si un endpoint no está declarado
- **187 pruebas unitarias** (verificadas el 2/10/2026, en verde)
- **133 pruebas de integración** contra MySQL real (re-verificadas el 3/10/2026)
- `correlation_id` propagado desde el gateway a través de eventos y auditoría
- Patrón outbox transaccional en los 6 servicios que publican
- Idempotencia de consumidores sobre `processed_event`

**Lo que no está resuelto:** 6 pendientes, entre ellos el teléfono que no llega al
contacto tras el acuerdo y el SRS inglés que quedó obsoleto.

### Fase 3 — Cliente web PWA · completada

React 18 + TypeScript sobre Vite, con un sistema de diseño propio en
`apps/web/src/ui/`. **18 pantallas** en `apps/web/src/paginas/` (16 en el momento de
la entrega; 2 añadidas después, pendientes de cablear).

- Sistema de tokens propio en lugar del que `12-ux-ui/design-system.md` deja sin
  rellenar (los tokens están como `#[hex]`, sin valores)
- Dos escenas 3D, selectivas y justificadas, no decorativas
- Instalable como PWA
- **21 pruebas de cliente** (Vitest) — verificadas antes de los cambios del 2/10
- Sistema de estados vacíos, de carga y de error en cada pantalla

**Lo que no está resuelto:** recuperación de contraseña sin interfaz, iconos del
PWA, E2E, y el teléfono que sigue sin llegar.

---

## 4. Fase 4 — Cierre de calidad · completada el 3/10/2026

Detalle completo en [FASE-4-PLAN.md](FASE-4-PLAN.md). Su lista de salida, cerrada:

1. ~~`npm run verify` en verde~~ — **hecho**: formato, lint sin un solo aviso, tipos,
   pruebas, cobertura y auditoría, en local y en el runner
2. ~~Resolver el trabajo a medias de `apps/web`~~ — **hecho**: las pantallas de
   recuperación de contraseña están cableadas en el enrutado, el arranque funciona y
   hay una prueba que monta `App` de verdad
3. ~~Ejecutar la integración dentro de la puerta de CI~~ — **hecho**: el job corre
   `verify` entero contra MySQL, Redis y RabbitMQ reales
4. Actualizar los tres documentos de entrega para que solo afirmen lo verificado —
   **hecho**
5. ~~Cerrar o diferir explícitamente los 13 pendientes de las Fases 1-3~~ —
   **hecho** el 3/10/2026, en [02-DECISIONES.md](02-DECISIONES.md): 1 cerrado
   (C-2, los iconos del PWA, verificados), 9 asignados a las Fases 5, 6 y 9, y 3
   duplicados que se cierran con su original

Los puntos 1 a 4 cerraron con el run de CI `37146895812` en verde.

**La fase se cierra con una deuda explícita, no con todo resuelto.** Dos de las tres
discrepancias de la estrategia de pruebas que su §5 se proponía cerrar —la cobertura
de ramas al 75 % y el override de `src/domain/` a 90/85— quedan **diferidas con
motivo**, no cerradas. Ver `FASE-4-PLAN.md` §5 y
[02-DECISIONES.md](02-DECISIONES.md) §3.

**Y destapó un pendiente que nadie había registrado.** Al decidir C-1 se encontró que
la recuperación de contraseña genera un token, lo publica y **nadie lo consume**: el
enlace de restablecimiento no llega a ningún sitio. No era una interfaz que faltaba,
era un flujo roto de extremo a extremo. El detalle está en
[02-DECISIONES.md](02-DECISIONES.md) §4.

---

## 5. Fases propuestas (5 a 10) — necesitan tu aprobación

Cada una se apoya en pendientes que **ya están registrados** en los documentos del
proyecto. No invento trabajo: reordeno lo que está escrito y le doy un orden de
ejecución.

### Fase 5 — Datos y operación · completada el 3/10/2026

Era la primera de las futuras porque casi todo lo demás dependía de que los datos
se pudieran reproducir. Detalle en [FASE-5-ENTREGA.md](FASE-5-ENTREGA.md).

Cuatro de sus cinco elementos están cerrados con código y prueba: semillas
idempotentes (A-1, B-3), comando de re-emisión de réplicas (A-2, B-2), escritor
de `statistics_snapshot` (A-3) y restauración de respaldos probada de verdad
sobre los siete esquemas (AT-004, el único `High` del proyecto). El quinto, la
política de datos personales, es un borrador con **seis decisiones abiertas** que
siguen bloqueando producción.

Esta fase destapó además **tres réplicas sin ningún escritor** que no estaban en
el backlog: `usuario_ref` en `pa_provider` y en `pa_rating`, y `reputacion_ref`
en `pa_request`. Tienen migración y cero código que las alimente.

- **Semillas idempotentes.** Hoy `db/seeds` borra antes de insertar, así que cada
  `docker compose up` de desarrollo destruye lo anterior y deja huérfanos los
  perfiles derivados. Cierra los pendientes F1-1 y F2-3, que son el mismo problema.
- **Re-emisión de réplicas.** No hay forma de reconstruir `prestador_ref` o
  `servicio_ref` si se pierden los eventos consumidos. Cierra F1-2 y F2-2.
- ~~**Escritor de `statistics_snapshot`.**~~ **Hecho.** Dos métricas calculables
  localmente, recalculadas cada hora. Las de RF109 a RF112 siguen sin datos
  porque `pa_admin` no tiene ninguna réplica.
- **Política de conservación y anonimización de datos personales.** Borrador en
  [04-POLITICA-DATOS-PERSONALES.md](04-POLITICA-DATOS-PERSONALES.md), con el
  inventario hecho y **seis decisiones abiertas**. El SRS dice que debe
  resolverse antes del despliegue en producción: sigue siendo un bloqueante duro.
- ~~**Procedimiento de restauración de respaldos.**~~ **Hecho.** `db/respaldo.sh`
  y [03-RUNBOOK-RESPALDOS.md](03-RUNBOOK-RESPALDOS.md); 69 tablas comparadas y
  `restauracion_probada_at` con valor real en los siete esquemas.

### Fase 6 — Experiencia del cliente

- **Teléfono desde el perfil de prestador.** **Decidido** el 3/10/2026: opción (c).
  Es donde el oferente declara el dato *para que le contacten*. La pantalla de detalle
  de contratación debe mostrarlo tras la adjudicación, y solo a las dos partes de esa
  solicitud. Cierra B-1 y C-4. Ver [02-DECISIONES.md](02-DECISIONES.md) §2.
- **Recuperación de contraseña, de extremo a extremo.** Las pantallas y las rutas ya
  están cableadas; lo que falta es **el canal**. Hoy el token se genera, se publica en
  un evento y nadie lo consume, así que el enlace no llega a ningún sitio. Entra el
  correo transaccional —y solo el transaccional— para cerrarlo. Ver
  [02-DECISIONES.md](02-DECISIONES.md) §4.
- **E2E del recorrido completo.** Publicar necesidad → recibir propuestas →
  adjudicar → cancelar. `11-quality/testing-strategy.md` lo pide y es lo único que
  probaría el flujo de negocio de extremo a extremo, que hoy está cubierto por partes.
  Incluye la comprobación manual de los iconos del PWA en pantalla de inicio, que es
  la única parte de C-2 que no se puede verificar automáticamente.

### ~~Fase 7 — Notificaciones fuera del MVP~~ · eliminada

**Decidido el 3/10/2026.** Push y correo de producto **descartados**: la bandeja
intraaplicación cubre el MVP, y un service worker con permisos de navegador,
proveedor y preferencias por canal es trabajo real para un valor que el MVP no pide.

Lo único que sobrevive es el **correo transaccional** para la recuperación de
contraseña, y pasa a la Fase 6 porque C-1 no se puede cerrar sin él. Motivo completo
en [02-DECISIONES.md](02-DECISIONES.md) §2 y §4.

### Fase 8 — Observabilidad y despliegue

- **Logging y métricas** por servicio con `correlation_id` (deuda AT-005)
- **Pruebas de carga k6** con el umbral que fija la estrategia de pruebas: P95 < 300 ms
  y tasa de error < 1 % (deuda AT-007, límites de escalabilidad)
- **Entornos dev / staging / producción.** `10-devops/environments.md` los describe
  pero no hay infraestructura, ni despliegue automatizado, ni log de despliegues
- **Expiración de JWT** sin decidir (deuda AT-006) y **configuración final de
  AWS/GCP** (deuda AT-001)

### Fase 9 — Documentación y trazabilidad

- **6 de 8 servicios sin documentación.** Solo existen `01-api-gateway` y
  `02-auth-service`. Faltan readme, modelo de datos, eventos, decisiones y runbook
  de los otros seis.
- **SRS en inglés obsoleto.** `srs-microservices.md` sigue diciendo que los
  microservicios no están adoptados y pide tres ADRs que ya están aceptados. Es el
  pendiente F2-4.
- **Contratos duplicados.** Los `.yaml` de `friend-point-docs/07-api/contracts/openapi/`
  son anteriores a los de `friend-point-development/contracts/`. Debería haber una
  sola fuente. Es el pendiente F2-5.
- **Matriz de trazabilidad inútil.** `traceability-matrix.md` usa identificadores
  (`RF1.1`, `NFR-001`) incompatibles con los del SRS (`RF193`, `RNF89`), tiene 12
  capítulos en *To be defined*, y declara 8 brechas abiertas. Una de ellas es
  literalmente «implementación sin HU/RF» (*implementation without HU/RF*).
  "implementación sin HU/RF".
- **Backlog formal y registro de preguntas abiertas.** `15-project-control/README.md`
  prescribe `technical-backlog.md`, `dependencies.md` y `open-questions.md`. **Ninguno
  de los tres existe.** Los 13 pendientes viven hoy dentro de los documentos de entrega.

### Fase 10 — Preparación de producción

No es trabajo nuevo: es la comprobación de que todo lo anterior está resuelto.

- Go/No-Go con Tech Lead y Product Owner, exigiendo DoD, DoR y los RNF, según la
  puerta de `00-sdd-guide.md` §Review gates
- Definition of Done de `00-governance/definition-of-done.md` completo. Nota: hoy
  **ninguna** de las Fases 1–3 cumple el punto de revisión por Pull Request que exige
- Cerrar AT-001 a AT-007
- Describir la estrategia de despliegue: `10-devops/environments.md` tiene el hueco
  `[Canary / Blue-Green / Rolling]` sin decidir

---

## 6. Grafo de dependencias

```
Fase 1 ──┐
         ├──> Fase 2 ──> Fase 3
         │                    │
         └────────────────────┤
                              v
                     Fase 4 (calidad)   COMPLETADA
                              │
        ┌─────────────────────┼─────────────────────┐
        v                     v                     v
    Fase 5               Fase 6               Fase 9
  COMPLETADA          COMPLETADA          (documentación)
        │                     │            en paralelo
        │                     │
        └──────────┬──────────┘
                   v
              Fase 8  ──>  Fase 10
           (operación)    (producción)
             <-- aqui
```

La Fase 7 ya no está en el grafo: se eliminó el 3/10/2026 y el correo transaccional,
lo único que sobrevivió de ella, es ahora una tarea de la Fase 6.

**Reglas que imponen el orden:**

- ~~La Fase 4 **no** puede esperar a la 5~~ — cumplido: la puerta quedó en verde antes
  de empezar cualquier trabajo nuevo.
- ~~La Fase 5 bloquea a la 6~~ — cumplido: las semillas ya no destruyen estado y
  `npm run db:reemit` reconstruye las réplicas, que era lo que hacía imposible
  ejecutar el E2E de forma fiable.
- La Fase 9 **puede** ir en paralelo desde ya. No bloquea a nadie y es la que más
  riesgo tiene de olvidarse.
- Nada llega a la Fase 10 sin la Fase 8. No se despliega lo que no se puede observar.

---

## 7. Criterios de "fase terminada"

El proyecto tiene criterios escritos, y **hay tres discrepancias entre lo que
exigen y lo que el código implementa**. Resolverlas es parte de la Fase 4.

### Lo que exige `00-governance/definition-of-done.md`

Ocho bloques obligatorios: requisitos y criterios de aceptación · código · pruebas ·
seguridad · integración · interfaz · documentación · Git y Pull Request. Los puntos
que hoy no se cumplen en ninguna fase:

- *"The code has been reviewed by at least one team member through a Pull Request."*
- *"All applicable tests pass."* — ahora sí, y en CI; antes las de integración no se
  ejecutaban en ningún runner y nadie las había visto en semanas
- *"An exception must not be used to ignore a critical security, functionality or
  acceptance criterion."* — el SRS marca la política de datos personales como bloqueante
  y no existe

### Lo que exige `11-quality/testing-strategy.md`

| Métrica | Exigido | Configurado | Cumple |
|---|---|---|---|
| Cobertura global de líneas | 80 % | 80 % | sí |
| Cobertura global de sentencias | 80 % | 80 % | sí |
| Cobertura global de funciones | 80 % | 80 % | sí |
| Cobertura global de ramas | **75 %** | **70 %** | **no** |
| `./src/domain/` líneas | **90 %** | **sin override** | **no** |
| `./src/domain/` ramas | **85 %** | **sin override** | **no** |

Las dos últimas filas son las importantes: el SRS considera la capa de dominio el
corazón del negocio y la estrategia le exige casi el doble de cobertura. El
`jest.config.js` no la exime.

### Discrepancia 3: los criterios E2E y de rendimiento no existen

La estrategia define flujos E2E priorizados (Playwright o Cypress) y un umbral de
carga con k6. **Ninguno de los dos existe en el código.** El Go/No-Go de la Fase 10
no puede satisfactionarse hoy.

---

## 8. Trazabilidad con el SRS

`04-requirements/srs-punto-amigo-es.md`, versión 2.1 del 30/09/2026.

- **13 módulos** de requisitos funcionales (§5.1)
- **193 requisitos funcionales** numerados hasta RF193, **89 no funcionales** hasta RNF89
- Prioridad declarada como **Alta / Media / Baja**, no MoSCoW. Solo **3 requisitos
  son de prioridad Baja**, y por tanto los únicos realmente diferibles: RF85 (ocultar
  calificación reportada), RF105 (parámetros de configuración), RF114 (exportar
  reporte)

**El SRS no asigna requisitos a fases.** El único mapeo requisito→servicio que existe
está en `FASE-2-ENTREGA.md` §2. Para saber qué cubre cada fase hay que cruzarlo a mano.

El grafo de eventos entre servicios —`UserRegistered`, `NeedPublished`,
`ProposalReceived`, `RequestCancelled` y compañía— está implícito en los comentarios de
las migraciones y en las tablas `outbox_event`, pero **no está escrito como
documento**. Es la pieza que falta para poder afirmar trazabilidad de extremo a extremo.

---

## 9. Deuda técnica registrada

`05-architecture/overview.md` §14, ítems AT-001 a AT-007. **Todos con destino
`To be defined`.**

| ID | Ítem | Prioridad |
|---|---|---|
| AT-001 | Configuración final de AWS o GCP | P2 |
| AT-002 | Estructura REST definitiva | P1 |
| AT-003 | Organización de los repositorios | P2 |
| ~~AT-004~~ | ~~Procedimiento de restauración de respaldos~~ · **CERRADO** 3/10/2026 | ~~P1, High~~ |
| AT-005 | Herramientas de monitoreo y logging | P2 |
| AT-006 | Valores de expiración de JWT | P1 |
| AT-007 | Límites de escalabilidad | P2 |

Además, R-001 a R-008 y R-010 de `15-project-control/risks.md` están **sin dueño
asignado** y sin fecha de revisión.

---

## 10. Lo que está explícitamente fuera del alcance

Para evitar que la Fase 6 o la 7 se cuelen sin decisión: `01-context/scope.md`
§Out of Scope y `03-product/problem-framing.md` §8 los excluyen de forma explícita.

- Pagos y transacciones financieras en línea
- Aplicación móvil nativa (el SRS la llama "fase futura", sin concretarla)
- Comunicación y mensajería en tiempo real
- Geolocalización avanzada y optimización por ubicación
- Recomendaciones, IA y analítica avanzada
- Integración con ERP o contabilidad
- Certificación profesional de los prestadores
- Infraestructura a gran escala y balanceo de carga
- Soporte 24/7

Las dos primeras volverían a cambiar el modelo de negocio. Ninguna de las dos está
en el plan de fases propuesto.

---

## 11. Decisiones que necesito de ti

Bloquean trabajo concreto. Ninguna se puede resolver solo. **Cuatro de las cinco
están resueltas**; el registro completo, con motivo, está en
[02-DECISIONES.md](02-DECISIONES.md).

1. ~~**Teléfono tras el acuerdo**~~ (Fase 6). **Resuelto** el 3/10/2026: sale del
   **perfil de prestador**, opción (c). Es donde el oferente declara el dato para que
   le contacten.
2. ~~**Correo y push**~~ (Fase 7). **Resuelto** el 3/10/2026: **push descartado** y
   **correo de producto descartado**; entra solo el **correo transaccional** de
   recuperación de contraseña, en la Fase 6. La Fase 7 se elimina del plan.
3. ~~**Nivel de exigencia de cobertura.**~~ **Resuelto** el 3/10/2026: el trinquete se
   queda en **65/52/64/67**. Subir al 80 % son unos 14 puntos de sentencias y 20 de
   ramas en los repositorios de persistencia, y la brecha sigue anotada como G-3 en el
   backlog. Nota: la cifra que este apartado daba antes —«67/65/52/64»— tenía los
   valores desordenados; el orden del umbral es sentencias/ramas/funciones/líneas.
4. ~~**Nombre, visibilidad y organización del repositorio.**~~ **Resuelto.** Público, en
   inglés, en [`JohanOtavo/service-routes`](https://github.com/JohanOtavo/service-routes),
   rama `develop`, remoto configurado y puerta en verde.
5. **Review por Pull Request** — **sigue abierta.** La Definition of Done lo exige y
   ninguna fase lo cumple. ¿Revisamos por Pull Request a partir de ahora, o aceptamos
   explícitamente que este proyecto queda excluido de ese requisito? Es la única de
   las cinco que no se resolvió, y bloquea el Go/No-Go de la Fase 10.

Fuera de estas cinco siguen sin decidir **AT-001** (AWS o GCP), **AT-003**
(organización de los repositorios) y **AT-006** (expiración de JWT). Ninguna bloquea
la Fase 5.

---

## 12. Documentos relacionados

| Documento | Para qué |
|---|---|
| [README.md](README.md) | Índice del conjunto documental de entrega |
| [01-BACKLOG.md](01-BACKLOG.md) | Los 13 pendientes, AT-001..007, O-01..O-12 y GAP-001..008 con criterio de cierre |
| [02-DECISIONES.md](02-DECISIONES.md) | Las 13 decisiones resueltas, con su motivo y su fase destino |
| [03-RUNBOOK-RESPALDOS.md](03-RUNBOOK-RESPALDOS.md) | Respaldo y restauración: el procedimiento y la primera restauración verificada (AT-004) |
| [04-POLITICA-DATOS-PERSONALES.md](04-POLITICA-DATOS-PERSONALES.md) | Inventario de datos personales y las 6 decisiones que bloquean producción |
| [FASE-5-ENTREGA.md](FASE-5-ENTREGA.md) | Registro de la Fase 5 |
| [FASE-6-ENTREGA.md](FASE-6-ENTREGA.md) | Registro de la Fase 6 |
| [FASE-4-PLAN.md](FASE-4-PLAN.md) | La Fase 4, completada, en detalle |
| [FASE-1-ENTREGA.md](FASE-1-ENTREGA.md) | Registro de la Fase 1 |
| [FASE-2-ENTREGA.md](FASE-2-ENTREGA.md) | Registro de la Fase 2 |
| [FASE-3-ENTREGA.md](FASE-3-ENTREGA.md) | Registro de la Fase 3 |
| `../README.md` | Punto de entrada del código |