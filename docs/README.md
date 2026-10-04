# Documentación de entrega — Punto Amigo

Registro de las fases del proyecto y estado de lo que queda por hacer.

## Por dónde empezar

| Si quieres… | Lee |
|---|---|
| Saber qué fases existen y en qué estado | [00-FLUJO-DEL-PROYECTO.md](00-FLUJO-DEL-PROYECTO.md) |
| Saber exactamente qué falta y qué hay que cumplir para cerrarlo | [01-BACKLOG.md](01-BACKLOG.md) |
| Saber qué se decidió, y por qué | [02-DECISIONES.md](02-DECISIONES.md) |
| Ver qué se hizo en la última fase cerrada | [FASE-9-ENTREGA.md](FASE-9-ENTREGA.md) |
| Entender un servicio concreto: qué hace, qué guarda, qué eventos mueve | [servicios/](servicios/README.md) |
| Seguir un dato de un servicio a otro, o averiguar por qué no llegó | [07-GRAFO-DE-EVENTOS.md](07-GRAFO-DE-EVENTOS.md) |
| Saber qué requisito del SRS toca qué código | [10-TRAZABILIDAD.md](10-TRAZABILIDAD.md) |
| Saber si el sistema puede salir a producción, y qué falta | [11-GO-NO-GO.md](11-GO-NO-GO.md) |
| Saber qué registra y qué mide el sistema, y qué carga aguanta | [05-OBSERVABILIDAD.md](05-OBSERVABILIDAD.md) |
| Saber qué entornos existen y qué falta para desplegar | [06-ENTORNOS-Y-DESPLIEGUE.md](06-ENTORNOS-Y-DESPLIEGUE.md) |
| Restaurar un respaldo | [03-RUNBOOK-RESPALDOS.md](03-RUNBOOK-RESPALDOS.md) |
| Saber qué datos personales guarda el sistema | [04-POLITICA-DATOS-PERSONALES.md](04-POLITICA-DATOS-PERSONALES.md) |
| Ver qué se construyó en una fase concreta | su documento de entrega, abajo |

## Los documentos

| Documento | Qué contiene |
|---|---|
| **[00-FLUJO-DEL-PROYECTO.md](00-FLUJO-DEL-PROYECTO.md)** | El plan maestro. Estado real de las puertas de calidad medido el 3/10/2026, mapa de las 9 fases, dependencias entre ellas, criterios de «fase terminada», deuda técnica y decisiones pendientes |
| **[01-BACKLOG.md](01-BACKLOG.md)** | Los 63 elementos, de los que 44 siguen abiertos, agrupados por origen, cada uno con su criterio de cierre y la fase que lo recoge. 8 necesitan una decisión tuya |
| **[02-DECISIONES.md](02-DECISIONES.md)** | Las 13 decisiones de las Fases 1-3, resueltas el 3/10/2026, con su motivo y su fase destino. Incluye el hallazgo que cambió una de ellas: la recuperación de contraseña genera un token que nadie entrega |
| **[03-RUNBOOK-RESPALDOS.md](03-RUNBOOK-RESPALDOS.md)** | El procedimiento de respaldo y restauración, la primera restauración verificada de verdad (AT-004) y los dos falsos positivos que el script tuvo al nacer |
| **[04-POLITICA-DATOS-PERSONALES.md](04-POLITICA-DATOS-PERSONALES.md)** | Dónde vive cada dato personal, qué hace ya bien el código, y las 6 decisiones que siguen bloqueando producción |
| **[05-OBSERVABILIDAD.md](05-OBSERVABILIDAD.md)** | El registro con `correlation_id`, las métricas, los paneles, la prueba de carga con su resultado, y la caducidad de los cuatro tipos de token |
| **[06-ENTORNOS-Y-DESPLIEGUE.md](06-ENTORNOS-Y-DESPLIEGUE.md)** | Qué entornos existen de verdad, los guardias de producción, las tres contradicciones con el documento de DevOps, y qué hace falta decidir |
| **[07-GRAFO-DE-EVENTOS.md](07-GRAFO-DE-EVENTOS.md)** | Los 29 eventos: quién publica cada uno, quién lo escucha, qué réplica alimenta, los seis que nadie consume, y el orden de comprobación cuando algo no llega |
| **[08-BACKLOG-TECNICO.md](08-BACKLOG-TECNICO.md)** | La deuda técnica con el formato que pide la gobernanza: impacto si no se resuelve, esfuerzo y prioridad. Con lo ya cerrado, para no repetir el trabajo |
| **[09-PREGUNTAS-ABIERTAS.md](09-PREGUNTAS-ABIERTAS.md)** | Las 12 preguntas del SRS §11. Siete llevaban meses contestadas por el código sin que nadie cerrara el registro; cinco siguen abiertas |
| **[10-TRAZABILIDAD.md](10-TRAZABILIDAD.md)** | Qué requisito toca qué archivo, y cuál tiene una prueba que lo nombre. Generada desde el código, no a mano |
| **[11-GO-NO-GO.md](11-GO-NO-GO.md)** | El expediente de la puerta de producción: el *Definition of Done* bloque por bloque con su evidencia, las tres cosas que bloquean —ninguna es código— y las cuatro que harían falta para decir «sí» |
| **[servicios/](servicios/README.md)** | Un documento por servicio: responsabilidad, API, modelo de datos, eventos, decisiones y runbook. Los nueve procesos, con los dos avisos sobre la documentación que ya existía |
| **[FASE-4-PLAN.md](FASE-4-PLAN.md)** | La Fase 4, cerrada el 3/10/2026: lo que hizo falta para que `npm run verify` y CI pasasen, y las dos discrepancias de cobertura que quedaron diferidas con motivo |

### Fases entregadas

| Documento | Fase | Estado |
|---|---|---|
| [FASE-1-ENTREGA.md](FASE-1-ENTREGA.md) | Base de datos | Construida · 3 pendientes, asignados a la Fase 5 |
| [FASE-2-ENTREGA.md](FASE-2-ENTREGA.md) | Backend seguro | Construida · 6 pendientes, asignados a las Fases 5, 6 y 9 |
| [FASE-3-ENTREGA.md](FASE-3-ENTREGA.md) | Cliente web PWA | Construida · 1 pendiente cerrado, 3 en la Fase 6 |
| [FASE-5-ENTREGA.md](FASE-5-ENTREGA.md) | Datos y operación | Completada · 4 de 5 cerrados; la política de datos personales en borrador |
| [FASE-6-ENTREGA.md](FASE-6-ENTREGA.md) | Experiencia del cliente | Completada · los 3 elementos cerrados; el recorrido pasa en CI desde el 4/10/2026 |
| [FASE-8-ENTREGA.md](FASE-8-ENTREGA.md) | Observabilidad y despliegue | Completada · AT-005, AT-006 y AT-007 cerrados; los entornos esperan AT-001 |
| [FASE-9-ENTREGA.md](FASE-9-ENTREGA.md) | Documentación y trazabilidad | Completada · los 9 elementos del grupo H cerrados, matriz de trazabilidad regenerable |

## En una línea

Las nueve fases de construcción están cerradas y la décima —la puerta de
producción— tiene su expediente escrito, con veredicto **NO-GO**. El sistema
funciona y se puede demostrar: el recorrido crítico pasa en un navegador real
**en CI**, 368 pruebas de Jest y 129 de Vitest en verde, P95 de **6,98 ms**
contra un umbral de 300 ms, una restauración de respaldo probada sobre los siete
esquemas, nueve `/metrics` con sus paneles, y 164 de 282 requisitos trazados
hasta el archivo que los implementa. Lo que bloquea producción no es código:
**la política de datos personales** (seis decisiones), **la elección de nube**
(AT-001) y **la revisión por Pull Request**, que el *Definition of Done* exige y
que ninguna fase ha cumplido. El detalle, bloque por bloque y con su evidencia,
está en [11-GO-NO-GO.md](11-GO-NO-GO.md).

## Una nota sobre las fechas

Estos documentos se escribieron en tres momentos distintos y describen tres entregas
distintas. Cuando un documento dice «completa» o «verificado», se refiere **al estado
en el momento de su entrega**, no al de hoy. Cada uno lleva al principio una nota con
su alcance exacto, y el plan maestro §1 tiene el estado medido actual.

## Repositorios

- **Código:** `friend-point-development` — este repositorio
- **Requisitos y arquitectura:** `friend-point-docs` — congelado desde el 30/09/2026

Los documentos de entrega viven en el repositorio de código, no en el de
documentación. Eso contradice el principio rector de `00-sdd-guide.md` («si cambió el
código y no el documento, el documento está roto») y es el pendiente AT-003, cuya
resolución requiere tu decisión.