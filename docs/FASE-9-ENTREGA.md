# Fase 9 — Documentación y trazabilidad · Entrega

> **Alcance.** Describe lo entregado el **4 de octubre de 2026**. Cuando dice
> «verificado», es una comprobación de ese día, citada con su resultado.

- Fase: **9 de 10** — Documentación y trazabilidad
- Estado: **completada** en lo que depende de este repositorio
- Puerta: `npm run verify` en verde — **364 de Jest y 129 de Vitest**, cobertura 68,37 / 55,91 / 67,43 / 70,55
- Cierra: los **9 elementos del grupo H**, **I-6**, **J-2**, y **TD-013** con una
  matriz que se regenera desde el código

---

## 1. Qué se pidió y qué se entregó

| Pendiente | Criterio escrito | Estado |
|---|---|---|
| H · Documentación de 6 servicios | readme, modelo de datos, eventos, decisiones y runbook de cada uno | **Cerrado.** 31 documentos en [docs/servicios/](servicios/README.md), extraídos del código |
| H · Grafo de eventos | «sin él no se puede trazar un dato desde que nace hasta que aparece en otro servicio» | **Cerrado.** [07-GRAFO-DE-EVENTOS.md](07-GRAFO-DE-EVENTOS.md): los 29 eventos, sus consumidores y el orden de diagnóstico |
| H · `technical-backlog.md` | lo prescribe `15-project-control/README.md` | **Cerrado.** [08-BACKLOG-TECNICO.md](08-BACKLOG-TECNICO.md) |
| H · `open-questions.md` | lo prescribe el mismo README | **Cerrado.** [09-PREGUNTAS-ABIERTAS.md](09-PREGUNTAS-ABIERTAS.md) |
| TD-013 · Matriz de trazabilidad | identificadores reales, sin capítulos *To be defined* | **Cerrado.** [10-TRAZABILIDAD.md](10-TRAZABILIDAD.md), generada desde el código |
| I-6 · El resultado de una cancelación no se veía | «el resultado sobrevive al cambio de estado, con una prueba» | **Cerrado**, con prueba que falla al reintroducir el defecto |
| J-2 · Omisión silenciosa de pruebas de integración | CI exige `REQUIRE_INTEGRATION=1` | **Cerrado por comprobación**: ya lo exigía desde la Fase 4. Ver §4 |
| F2-4 · SRS en inglés obsoleto · F2-5 · contratos duplicados | — | **No cerrados aquí.** Viven en `friend-point-docs`, congelado. §5 dice qué hacer y qué decidir |

## 2. Lo que la documentación dejó a la vista

Escribir lo que el sistema hace encontró cosas que nadie había anotado. Esto es
el valor de la fase, más que los documentos:

- **Seis eventos que ningún servicio consume**: `UserAuthenticated`,
  `NeedPublished`, `NeedClosed`, `NeedReopened`, `ProposalDiscarded` y
  `ServiceRequestStatusChanged`. No es un defecto —el patrón outbox los deja
  disponibles para un consumidor futuro— pero conviene que esté escrito para que
  nadie lo lea como uno.
- **Las semillas no llenan las réplicas**, y por eso una base recién creada
  tiene todas las tablas `*_ref` vacías. Es exactamente lo que hacía fallar el
  recorrido E2E en CI, y ahora está en el grafo de eventos con su solución
  (`npm run db:reemit`).
- **El token de recuperación viaja sobre `UserProfileUpdated`**, el único evento
  del sistema que transporta un secreto. Ese mismo evento lo consume también
  request-service para refrescar su réplica: un cambio en su payload toca dos
  caminos que no se parecen en nada.
- **Siete de las doce preguntas abiertas llevaban meses contestadas** por el
  código o por una ADR aceptada, cuatro de ellas marcadas como bloqueantes.
  Nadie había cerrado el registro.

## 3. La matriz de trazabilidad, medida

| Medida | Valor |
|---|---|
| Requisitos del SRS | 282 (193 RF + 89 RNF) |
| Citados por el código | **164** · 58 % |
| RF citados | 139 de 193 · **72 %** |
| RNF citados | 25 de 89 · **28 %** |
| Con una prueba que los nombre | 57 · 35 % de los citados |
| Citas a identificadores inexistentes | **0** |

La matriz que reemplaza usaba `RF1.1` y `NFR-001`, identificadores que **no
existen** en el SRS, con doce capítulos en *To be defined*. La nueva se extrae
del código: cada archivo que nombra un requisito queda registrado, y se
distingue si la cita está en código fuente o en una prueba. Una cita prueba
*intención*; la prueba es la señal fuerte.

Que la cobertura de RNF sea del 28 % es esperable y está dicho en el documento:
muchos requisitos no funcionales son de proceso, documentación o capacitación, y
no se implementan en una función.

## 4. Una corrección a mi propio backlog

**J-2 se escribió afirmando que CI no exigía `REQUIRE_INTEGRATION=1`.** Al
revisarlo para esta fase, `.github/workflows/ci.yml` ya lo pasaba en el trabajo
que ejecuta `verify`, desde la Fase 4. El agujero era **solo local**, y lo tapó
la carga del `.env` en `jest.config.js` durante la Fase 8.

Queda escrito porque un backlog que corrige en silencio deja de ser fiable: el
elemento se cierra «por comprobación», no por trabajo.

## 5. Lo que no se puede cerrar desde este repositorio

Tres pendientes viven en `friend-point-docs`, congelado desde el 30/09/2026, y
su destino depende de **AT-003** —la organización de los repositorios—, que es
una decisión tuya:

| Pendiente | Qué habría que hacer |
|---|---|
| **O-11** (bloqueante) | `09-microservices/services/02-auth-service/` declara PostgreSQL, Redis y puerto 8081. El código usa MySQL y 3001, y el SRS dice lo mismo que el código. Corregir el documento |
| **TD-011** | `09-microservices/service-catalog.md` marca los ocho servicios como 🔴 *Planned* «porque la arquitectura de microservicios no ha sido aprobada». Los tres ADRs están aceptados y los nueve procesos corren. Es una línea por servicio |
| **TD-014** · F2-5 | Contratos OpenAPI duplicados. En este repositorio hay **ocho** (`contracts/openapi/`), uno por servicio, y una prueba que falla si el código expone una ruta que el contrato no declara. En el otro hay **tres** y una plantilla, anteriores. La fuente única debería ser la de aquí, y la otra desaparecer |
| **TD-015** · F2-4 | `srs-microservices.md` sigue diciendo que los microservicios no están adoptados y pide tres ADRs ya aceptados |

**Recomendación**, para que la decisión no se quede sin propuesta: que la
documentación de servicio y los contratos vivan junto al código, y que
`friend-point-docs` conserve requisitos, arquitectura y gobernanza. Es lo que ya
pasa de hecho, y la razón es la que dice el propio `00-sdd-guide.md`: «si cambió
el código y no el documento, el documento está roto». Un documento en otro
repositorio cambia menos.

## 6. Verificación

| Comprobación | Resultado |
|---|---|
| `npm run verify` | **364 pruebas de Jest y 129 de Vitest**, 0 fallos. Cobertura 68,37 / 55,91 / 67,43 / 70,55, por encima del trinquete 65 / 52 / 64 / 67 |
| Prueba de I-6 contra el defecto reintroducido | **falla**, como debe: `Unable to find ... La contratacion quedo cancelada` |
| Formato de los 31 documentos nuevos | `prettier --check docs/` en verde |
| Matriz de trazabilidad | 164 requisitos trazados, **0** citas a identificadores inexistentes |

## 7. Lo que queda para la Fase 10

No es trabajo nuevo: es comprobar que lo anterior está resuelto.

| Pendiente | De quién |
|---|---|
| **AT-001**: AWS o GCP, y con ello los entornos dev/staging/producción | **Tuyo** |
| Estrategia de despliegue (`[Canary / Blue-Green / Rolling]`) | **Tuyo** |
| Las seis decisiones de datos personales | **Tuyo.** Siguen bloqueando producción |
| **AT-003**: organización de los repositorios, que destraba O-11, TD-011, TD-014 y TD-015 | **Tuyo** |
| Revisión por Pull Request | **Tuyo.** Ninguna de las nueve fases la ha cumplido, y el *Definition of Done* la exige |
| **J-1**: el limitador por IP detrás del gateway | Código |
| **O-08** y **O-09**: objetivo de carga y retención de respaldos | **Tuyo**; para O-08 hay una propuesta medida: 90 peticiones/s |
| Clasificar los 118 requisitos sin trazabilidad entre «es código» y «es proceso» | Código y documentación |
