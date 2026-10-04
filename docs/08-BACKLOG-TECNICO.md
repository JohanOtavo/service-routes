# Backlog técnico — Punto Amigo

Lo que funciona pero no como debería. Es el `technical-backlog.md` que
`15-project-control/README.md` prescribe y que **no existía**: hasta ahora la
deuda vivía repartida dentro de los documentos de entrega.

- Fecha: **4 de octubre de 2026**
- Formato: el que pide `15-project-control/README.md` — ID, descripción,
  impacto si no se resuelve, esfuerzo, prioridad, fase
- Relación con [01-BACKLOG.md](01-BACKLOG.md): ese documento es el inventario
  **completo** de los 66 elementos, incluidos los de producto, documentación y
  trazabilidad. Este recoge solo la **deuda técnica abierta**, con el formato que
  la gobernanza exige. Cuando los dos hablan del mismo elemento, se nombra su ID
  de origen
- El esfuerzo va en puntos de historia, con la escala del proyecto: 1 SP ≈ media
  jornada, 3 SP ≈ dos días, 5 SP ≈ una semana

---

## Abierta

| ID | Descripción | Impacto si no se resuelve | Esfuerzo | Prioridad | Fase |
|---|---|---|---|---|---|
| TD-001 | Elegir nube y escribir la infraestructura (AT-001) | No hay entorno dev, staging ni producción. Nada de lo construido se puede desplegar | 8 SP | **Alta** | 10 · **decisión tuya** |
| TD-002 | Decidir la organización de los repositorios (AT-003) | Los documentos de entrega viven en el repositorio de código y contradicen el principio rector de `00-sdd-guide.md`. Cada fase nueva agrava la duplicidad | 2 SP | Media | 9 · **decisión tuya** |
| TD-003 | Congelar la estructura REST definitiva (AT-002) | El SRS describe rutas que el código no sirve. Un cliente que se escriba contra el SRS se rompe | 3 SP | Media | 9 |
| TD-004 | Las seis decisiones de datos personales | **Bloquea producción.** El SRS marca la política como requisito bloqueante y hoy es un borrador con el inventario hecho | 3 SP | **Alta** | 10 · **decisión tuya** |
| TD-007 | Cobertura por debajo de lo que pide la estrategia | `11-quality/testing-strategy.md` pide 80/80/80/70; el trinquete está en 67/65/52/64 y la medición real da 68,4 / 56,14 / 67,52 / 70,58. La diferencia está en los repositorios Knex y los `main.ts`, que hoy solo se tocan de refilón | 8 SP | Media | 9 · decidido mantener el trinquete y anotar la brecha |
| TD-008 | El documento de DevOps contradice al código en tres puntos (J-3) | Quien monte un entorno con `10-devops/environments.md` en la mano construirá otra cosa: convención de variables, PostgreSQL en los ejemplos y un gestor de secretos que no existe | 2 SP | Media | 9 |
| TD-009 | Ninguna fase ha pasado por revisión en Pull Request | Es un punto **obligatorio** del *Definition of Done*, y hoy no lo cumple ninguna de las ocho fases entregadas. El Go/No-Go de la Fase 10 lo exige | 1 SP | **Alta** | 10 · **decisión tuya** |
| TD-011 | La ficha del catálogo de servicios marca los ocho servicios como *Planned* | `09-microservices/service-catalog.md` dice que la arquitectura de microservicios no está aprobada. Los tres ADRs lo están desde el 30/09/2026 | 1 SP | Baja | 9 |
| TD-012 | Sin alertas, sin registros centralizados y sin trazas distribuidas | Hay paneles y métricas, pero nadie recibe un aviso: una caída se descubre mirando. Las tres piezas necesitan un destino y un turno de guardia | 5 SP | Media | 10 |
| TD-013 | La matriz de trazabilidad usa identificadores que no existen | `traceability-matrix.md` habla de `RF1.1` y `NFR-001`; el SRS usa `RF193` y `RNF89`. Doce capítulos están en *To be defined* y declara ocho brechas, una de ellas «implementación sin HU/RF» | 5 SP | Media | 9 |
| TD-014 | Contratos OpenAPI duplicados (F2-5) | Los `.yaml` de `friend-point-docs/07-api/contracts/openapi/` son anteriores a los de `contracts/` de este repositorio. Dos fuentes para una verdad: la que se lea primero gana | 2 SP | Media | 9 |
| TD-015 | El SRS en inglés está obsoleto (F2-4) | `srs-microservices.md` sigue diciendo que los microservicios no están adoptados y pide tres ADRs que ya están aceptados | 3 SP | Media | 9 |

## Cerrada

Se queda escrita: un backlog técnico sin memoria repite el mismo trabajo.

| ID | Descripción | Cerrada | Con qué |
|---|---|---|---|
| TD-100 | Procedimiento de restauración de respaldos sin probar (AT-004) | 3/10/2026 | `db/respaldo.sh` y [03-RUNBOOK-RESPALDOS.md](03-RUNBOOK-RESPALDOS.md). Siete esquemas restaurados, 69 tablas comparadas. El script dio **dos falsos positivos** antes de servir, los dos documentados |
| TD-101 | Semillas que destruían estado | 3/10/2026 | Alta o refresco por clave natural; nueve `.del()` eliminados |
| TD-102 | Réplicas imposibles de reconstruir | 3/10/2026 | `npm run db:reemit`, con `reemision: true` para que no se reenvíen correos |
| TD-103 | Informes de serie sin nadie que los calculara | 3/10/2026 | `CalculateStatistics` y su barrido periódico |
| TD-104 | Sin logs estructurados ni panel de métricas (AT-005) | 4/10/2026 | Nueve `/metrics`, una línea JSON con `correlation_id` por petición, Prometheus y Grafana. [05-OBSERVABILIDAD.md](05-OBSERVABILIDAD.md) |
| TD-105 | Caducidad de los tokens sin decidir ni probar (AT-006) | 4/10/2026 | Los cuatro valores documentados; la lista de denegación dejó de usar un literal de 900.000 ms y tiene prueba de regresión |
| TD-106 | Límites de escalabilidad sin medir (AT-007) | 4/10/2026 | `npm run carga`: P95 de 6,98 ms contra 300 ms, 0 % de error |
| TD-107 | El broker no reconectaba si fallaba su primer intento | 4/10/2026 | Enganches de reconexión en el broker y resuscripción idempotente del consumidor. **Era por esto que el correo de recuperación no llegaba nunca** |
| TD-108 | 222 líneas de middleware HTTP duplicadas en auth-service | 4/10/2026 | Eliminadas; usa el `service-kit` como los otros siete. Incluían el guardia que compara el secreto interno en tiempo constante |
| TD-109 | Nueve copias del mismo objeto `logger` | 4/10/2026 | Una sola, en `service-kit` |
| TD-112 | El limitador por IP detrás del gateway no limitaba por cliente (J-1, TD-005) | 4/10/2026 | `claveDeLimite` en los siete servicios internos: la identidad del gateway, con la IP solo como respaldo. Verificado con el límite real: el usuario 34 recibió 429 en la petición 101 y el 35 seguía en 200 |
| TD-111 | El resultado de una cancelación no se llegaba a ver (I-6, TD-010) | 4/10/2026 | La página deja montado el componente al pasar a `CANCELADA`. La prueba monta la página, no el componente: el defecto estaba en la condición de la página y una prueba del componente suelto no lo veía |
| TD-110 | Una prueba de integración omitida se contaba como aprobada (J-2) | 4/10/2026 | `jest.config.js` carga el `.env` y fija `MYSQL_HOST`. Al revisarlo se vio que **CI ya exigía `REQUIRE_INTEGRATION: '1'`** desde la Fase 4: el agujero era solo local |

## Cómo entra algo aquí

Cuando se cumplen las dos condiciones:

1. **Funciona.** Lo que no funciona es un defecto, y va al grupo que le
   corresponda de [01-BACKLOG.md](01-BACKLOG.md).
2. **No está como debería**, y se puede decir en una frase qué pasa si se deja.

Si falta lo segundo, no es deuda: es una opinión sobre el código. La diferencia
importa, porque un backlog técnico que acepta opiniones deja de leerse.
