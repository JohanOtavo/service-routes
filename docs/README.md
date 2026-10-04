# Documentación de entrega — Punto Amigo

Registro de las fases del proyecto y estado de lo que queda por hacer.

## Por dónde empezar

| Si quieres… | Lee |
|---|---|
| Saber qué fases existen y en qué estado | [00-FLUJO-DEL-PROYECTO.md](00-FLUJO-DEL-PROYECTO.md) |
| Saber exactamente qué falta y qué hay que cumplir para cerrarlo | [01-BACKLOG.md](01-BACKLOG.md) |
| Saber qué se decidió, y por qué | [02-DECISIONES.md](02-DECISIONES.md) |
| Ver qué se hizo en la última fase cerrada | [FASE-6-ENTREGA.md](FASE-6-ENTREGA.md) |
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
| **[FASE-4-PLAN.md](FASE-4-PLAN.md)** | La Fase 4, cerrada el 3/10/2026: lo que hizo falta para que `npm run verify` y CI pasasen, y las dos discrepancias de cobertura que quedaron diferidas con motivo |

### Fases entregadas

| Documento | Fase | Estado |
|---|---|---|
| [FASE-1-ENTREGA.md](FASE-1-ENTREGA.md) | Base de datos | Construida · 3 pendientes, asignados a la Fase 5 |
| [FASE-2-ENTREGA.md](FASE-2-ENTREGA.md) | Backend seguro | Construida · 6 pendientes, asignados a las Fases 5, 6 y 9 |
| [FASE-3-ENTREGA.md](FASE-3-ENTREGA.md) | Cliente web PWA | Construida · 1 pendiente cerrado, 3 en la Fase 6 |
| [FASE-5-ENTREGA.md](FASE-5-ENTREGA.md) | Datos y operación | Completada · 4 de 5 cerrados; la política de datos personales en borrador |
| [FASE-6-ENTREGA.md](FASE-6-ENTREGA.md) | Experiencia del cliente | Completada · los 3 elementos cerrados |

## En una línea

Seis fases cerradas: base de datos, backend, cliente web, la puerta de calidad,
los datos y la experiencia del cliente. Las semillas ya no destruyen estado, las réplicas se pueden reconstruir
con `npm run db:reemit`, los informes de serie tienen quien los calcule, y AT-004
—el único elemento `High` del proyecto— está cerrado con una restauración probada
sobre los siete esquemas. El recorrido crítico ya pasa en un navegador real, en CI. **La siguiente es la
Fase 8 —observabilidad y despliegue—**; la Fase 9, documentación, puede ir en
paralelo. Lo que sigue bloqueando producción es la política de datos
personales: el inventario está hecho y faltan seis decisiones.

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