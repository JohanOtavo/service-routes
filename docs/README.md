# Documentación de entrega — Punto Amigo

Registro de las fases del proyecto y estado de lo que queda por hacer.

## Por dónde empezar

| Si quieres… | Lee |
|---|---|
| Saber qué fases existen y en qué estado | [00-FLUJO-DEL-PROYECTO.md](00-FLUJO-DEL-PROYECTO.md) |
| Saber exactamente qué falta y qué hay que cumplir para cerrarlo | [01-BACKLOG.md](01-BACKLOG.md) |
| Saber qué evento publica quién y quién lo consume | [02-GRAFO-DE-EVENTOS.md](02-GRAFO-DE-EVENTOS.md) |
| Ver qué se está haciendo ahora | [FASE-4-PLAN.md](FASE-4-PLAN.md) |
| Ver qué se construyó en una fase concreta | su documento de entrega, abajo |

## Los documentos

| Documento | Qué contiene |
|---|---|
| **[00-FLUJO-DEL-PROYECTO.md](00-FLUJO-DEL-PROYECTO.md)** | El plan maestro. Estado real de las puertas de calidad medido el 2/10/2026, mapa de las 10 fases, dependencias entre ellas, criterios de «fase terminada», deuda técnica y decisiones pendientes |
| **[01-BACKLOG.md](01-BACKLOG.md)** | Los 48 elementos de trabajo abierto, agrupados por origen, cada uno con su criterio de cierre y la fase que lo recoge. 10 necesitan una decisión tuya |
| **[02-GRAFO-DE-EVENTOS.md](02-GRAFO-DE-EVENTOS.md)** | Quién publica cada uno de los 31 eventos, a qué cola llega, quién lo atiende y cuáles se descartan en silencio. La fuente de verdad es el código, no las intenciones |
| **[FASE-4-PLAN.md](FASE-4-PLAN.md)** | La fase en curso: qué hay que hacer para que `npm run verify` pase, qué queda fuera de alcance, su lista de salida y sus riesgos |

### Fases entregadas

| Documento | Fase | Estado |
|---|---|---|
| [FASE-1-ENTREGA.md](FASE-1-ENTREGA.md) | Base de datos | Construida · 3 pendientes |
| [FASE-2-ENTREGA.md](FASE-2-ENTREGA.md) | Backend seguro | Construida · 6 pendientes |
| [FASE-3-ENTREGA.md](FASE-3-ENTREGA.md) | Cliente web PWA | Construida · 4 pendientes |

## En una línea

Tres fases construidas —base de datos, backend y cliente web— y la puerta de
calidad del repositorio en verde: `npm run verify` pasa con formato, lint, tipos,
368 pruebas y auditoría de dependencias. Quedan 48 elementos de trabajo abiertos,
10 de ellos pendientes de una decisión tuya.

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