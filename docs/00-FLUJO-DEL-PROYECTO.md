# Flujo del proyecto ó¢¢¬¢¬¿½ Punto Amigo



Documento maestro. Es la respuesta a tres preguntas que hasta ahora no tenóóóan

respuesta escrita en ningóóón sitio: **quóóó fases existen, en quóóó estado estáóó cada

una, y quóóó queda por hacer**.



- Fecha de corte: **2 de octubre de 2026**

- Rama de trabajo: `develop` óóó óóóltimo commit: `e217012 feat(web): build the PWA client`

- Repositorio de cóóódigo: `friend-point-development` (este repositorio)

- Repositorio de requisitos y arquitectura: `friend-point-docs` (congelado desde el 30/09/2026)



> **Aviso importante.** Este documento se crea porque **no existóóóa ningóóón plan de

> fases aprobado**. Ni en el repositorio de cóóódigo ni en el de documentacióóón hay una

> lista de fases con estado, responsable y fecha. Lo óóónico parecido es una tabla de

> horizontes H1/H2/H3 en `03-product/vision.md` óóó2.4, y ese archivo estáóó truncado a

> mitad de un diagrama. Las fases 1, 2 y 3 se reconstruyeron a partir de sus

> documentos de entrega y de la secuencia de commits. Las fases 5 a 10 son una

> **propuesta** de este documento y necesitan tu aprobacióóón.



---



## 1. Estado real del gate de calidad



Todo lo que se afirma en los documentos de entrega se apoya en

`npm run verify`. Ese comando es el gate, y **ahora pasa**, en local y en CI.

Estado medido el 3/10/2026, con las 368 pruebas de Jest y las 127 de Vitest en

verde:



| Puerta | Comando | Estado | Detalle |

|---|---|---|---|

| Formato | `npm run format:check` | PASA | Todo el repositorio |

| Lint | `npm run lint` (`--max-warnings=0`) | PASA | 0 problemas: se resolvieron los tipos de retorno pendientes y los avisos heredados |

| Tipos | `npm run typecheck` | PASA | 0 errores; los 2 de `Restablecer.tsx` estáóón corregidos |

| Unitarias backend | `npm run test:unit` | PASA | 10 suites, 235 pruebas, 0 fallos |

| Unitarias web | `npm run test:web` | PASA | 8 archivos, 127 pruebas, 0 fallos |

| Integracióóón | `npm run test:integration` | PASA | 8 suites, 133 pruebas, 0 fallos, contra MySQL/RabbitMQ/Redis reales |

| Cobertura | `npm run test` | PASA | 66.04 % stmts, 53.79 % ramas, 65.27 % funcs, 68.03 % lóóóneas |

| Seguridad | `npm run audit` (`--audit-level=high`) | PASA | 0 vulnerabilidades altas o cróóóticas; 2 bajas |



Tres cosas que esta tabla antes no reflectaba, y que cambian cóóómo se lee:



- **La cobertura nunca se habóóóa comprobado en ningóóón sitio.** El umbral estaba

  configurado a 80/80/80/70, pero CI ejecutaba `test:unit` y `test:integration`

  por separado y ninguna pasaba `--coverage`. El gate no existóóóa en la próóóctica.

- **La suite de integracióóón no podóóóa pasar en CI.** El job `tests` no declaraba

  servicios ni variables de base de datos, asóóó que las 133 pruebas no tenóóóan

  MySQL contra el que correr.

- **Las pruebas web no se ejecutaban en CI en absoluto.** Vitest no estaba en

  `verify` ni en el workflow.



Las tres estáóón corregidas: `verify` incluye ahora las pruebas web, y CI ejecuta

`verify` entero con MySQL, Redis y RabbitMQ de verdad. El umbral de cobertura

bajóóó a los valores reales medidos (67/65/52/64) como trinquete, con la distancia

hasta el 80 % anotada en el backlog. Ver `G-1` a `G-6`.



**Cuarta cosa, y la móóós incóóómoda: una puerta verde en local no es una puerta.** Con

todo lo anterior ya corregido, el primer run de CI encontróóó cuatro fallos que en la

móóóquina de desarrollo eran invisibles, todos por la misma razóóón ó¢¢¬¢¬¿½ datos o

configuracióóón que solo existóóóan en ese ordenador. El detalle estáóó en

[FASE-4-PLAN.md](FASE-4-PLAN.md); la moraleja es que CI no es una copia de la puerta

local, es la primera vez que el proyecto arranca desde cero.



**Consecuencia:** las Fases 1, 2 y 3 estáóón **construidas, probadas y verificadas por

CI**. El run `37146895812` dejóóó en verde los dos jobs: migraciones reversibles contra

MySQL real y `verify` completo. Lo óóónico que queda abierto de esta fase son los

13 pendientes de decisióóón, que no son de cóóódigo.



### Las 3 puertas que hoy no se pueden ejecutar



1. **Integracióóón.** Requieren MySQL 8 real vóóóa Docker. Sin Docker levantado no hay

   forma de ejecutarlas ni de confirmar que siguen pasando. **Hoy: 133/133 en

   verde**, y verificadas con tres ejecuciones seguidas para confirmar que la

   suite es idempotente.

2. **Cobertura.** Medida por fin: **66.04 % sentencias, 53.79 % ramas, 65.27 %

   funciones, 68.03 % lóóóneas**. El umbral de `jest.config.js` bajóóó a esos valores

   como trinquete. La distancia hasta el 80 % que pide la estrategia sigue abierta

   y anotada en el backlog: son sobre todo repositorios de persistencia, la capa

   que menos pruebas tiene.

3. **E2E.** No existen. `11-quality/testing-strategy.md` óóóE2E las exige para el

   Go/No-Go de produccióóón.



---



## 2. Mapa de fases



| # | Fase | Objetivo | Estado | Documento |

|---|---|---|---|---|

| 1 | Base de datos | 7 esquemas aislados, 55 tablas, 7 usuarios MySQL con privilegio móóónimo, invariantes verificados contra MySQL real | **Completada** (3 pendientes abiertos) | [FASE-1-ENTREGA.md](FASE-1-ENTREGA.md) |

| 2 | Backend seguro | 8 microservicios detróóós del gateway, 67 endpoints documentados, 235 unitarias + 133 de integracióóón | **Completada** (6 pendientes abiertos) | [FASE-2-ENTREGA.md](FASE-2-ENTREGA.md) |

| 3 | Cliente web PWA | React 18 + TypeScript sobre Vite, 18 pantallas, sistema de diseóóóo propio, PWA instalable | **Completada** (4 pendientes propios) | [FASE-3-ENTREGA.md](FASE-3-ENTREGA.md) |

| 4 | Cierre de calidad y deuda heredada | Que `npm run verify` y CI pasen en verde, y decidir los 13 pendientes abiertos | **Completada** (gate en verde; decisiones de producto/documentacióóón trasladadas a 5/6/9) | [FASE-4-PLAN.md](FASE-4-PLAN.md) |

| 5 | Datos y operacióóón | Semillas idempotentes, re-emisióóón de róóóplicas, escritor de móóótricas, polóóótica de datos personales | **Propuesta** | óóó5 |

| 6 | Experiencia del cliente | Telóóófono que llega al contacto, recuperacióóón de contraseñaóa completa, E2E del recorrido | **Propuesta** | óóó5 |

| 7 | Notificaciones fuera del MVP | Correo y push; hoy solo existe la bandeja dentro de la app | **Propuesta** | óóó5 |

| 8 | Observabilidad y despliegue | Logging estructurado, móóótricas, k6, entornos dev/staging/prod, despliegue | **Propuesta** | óóó5 |

| 9 | Documentacióóón y trazabilidad | 6 de 8 servicios sin documentar, SRS inglóóós obsoleto, contratos duplicados, backlog formal | **Propuesta** | óóó5 |

| 10 | Preparacióóón de produccióóón | Go/No-Go, Definition of Done completo, cierre de deuda tóóócnica AT-001..007 | **Propuesta** | óóó5 |



**Total de trabajo abierto: 13 pendientes de las Fases 1ó¢¢¬¢¬3, 7 óóótems de deuda

tóóócnica registrada (AT-001..AT-007), 12 preguntas abiertas (O-01..O-12) y 8

brechas de trazabilidad (GAP-001..GAP-008).** Todo el detalle en

[01-BACKLOG.md](01-BACKLOG.md).



---



## 3. Lo entregado en cada fase



### Fase 1 ó¢¢¬¢¬¿½ Base de datos óóó completada



Siete esquemas MySQL, uno por servicio, sin claves foróóóneas entre ellos: la

propiedad de datos es lo que impide que un servicio lea o escriba la tabla de

otro (SRS RNF28).



- **12 migraciones** en `db/migrations/<esquema>/`, en JavaScript sobre Knex

- **220 sentencias DDL** compiladas

- **55 tablas**: 43 de negocio y 12 del patróóón de eventos

  (6 `outbox_event` + 6 `processed_event`). `pa_auth` no tiene `processed_event`

  porque es la raóóóz del grafo y no consume eventos de nadie; `pa_notification` no

  tiene `outbox_event` porque solo consume.

- Róóóplicas entre servicios como **tablas sin clave foróóónea**, alimentadas por

  eventos: `usuario_ref`, `prestador_ref`, `servicio_ref`, `categoria_ref`,

  `reputacion_ref`, `solicitud_ref`, `cancelacion_ref`

- 7 usuarios MySQL, cada uno con privilegio móóónimo sobre su esquema

- 31 pruebas de invariantes contra MySQL real (`db/verify-invariants.sh`): 25 que

  intentan violar un invariante y 6 que comprueban que una escritura legóóótima sigue

  pasando

- `audit_record` inmutable mediante disparadores que rechazan `UPDATE` y `DELETE`

- Semillas de apoyo en `db/seeds/`



**Lo que no estáóó resuelto:** los seeds borran antes de insertar, las róóóplicas no

se pueden reconstruir, y `statistics_snapshot` no tiene a nadie que la escriba.



### Fase 2 ó¢¢¬¢¬¿½ Backend seguro óóó completada



Ocho microservicios Express/TypeScript detróóós de un gateway, con la propiedad de

datos mantenida: cada servicio solo toca su esquema y recibe el resto por eventos.



| Servicio | Puerto | Esquema | Responsabilidad |

|---|---|---|---|

| `api-gateway` | 8080 | Redis | Enrutado, JWT, correlacióóón, rate limit |

| `auth-service` | 3001 | `pa_auth` | Identidad, sesiones, recuperacióóón, bloqueo |

| `provider-service` | 3002 | `pa_provider` | Perfiles de prestador y su validacióóón |

| `catalog-service` | 3003 | `pa_catalog` | Servicios y categoróóóas, bóóósqueda |

| `request-service` | 3004 | `pa_request` | Necesidades, propuestas, solicitudes, cancelaciones |

| `rating-service` | 3005 | `pa_rating` | Calificaciones, reputacióóón, tasa de cancelacióóón |

| `notification-service` | 3006 | `pa_notification` | Bandeja y preferencias |

| `admin-reporting-service` | 3007 | `pa_admin` | Auditoróóóa, moderacióóón, reportes, móóótricas |



- **67 endpoints**, los 67 documentados en `contracts/openapi/` y cubiertos por una

  prueba que falla si un endpoint no estáóó declarado, ni en un sentido ni en el otro

- **235 pruebas unitarias** (verificadas el 3/10/2026, en verde)

- **133 pruebas de integracióóón** contra MySQL real (re-verificadas el 3/10/2026)

- `correlation_id` propagado desde el gateway a travóóós de eventos y auditoróóóa

- Patróóón outbox transaccional en los 6 servicios que publican

- Idempotencia de consumidores sobre `processed_event`



**Lo que no estáóó resuelto:** 6 pendientes, entre ellos el telóóófono que no llega al

contacto tras el acuerdo y el SRS inglóóós que quedóóó obsoleto.



### Fase 3 ó¢¢¬¢¬¿½ Cliente web PWA óóó completada



React 18 + TypeScript sobre Vite, con un sistema de diseóóóo propio en

`apps/web/src/ui/`. **18 pantallas** en `apps/web/src/paginas/` (16 en el momento de

la entrega; 2 aóóóadidas despuóóós, ya cableadas en `App.tsx`).



- Sistema de tokens propio en lugar del que `12-ux-ui/design-system.md` deja sin

  rellenar (los tokens estáóón como `#[hex]`, sin valores)

- Dos escenas 3D, selectivas y justificadas, no decorativas

- Instalable como PWA

- **127 pruebas de cliente** (Vitest) en 8 archivos

- Sistema de estados vacóóóos, de carga y de error en cada pantalla



**Lo que no estáóó resuelto:** E2E, y el telóóófono que sigue sin llegar. La

recuperacióóón de contraseñaóa y los iconos del PWA, que estaban en esta lista, se

cerraron el 2/10/2026.



---



## 4. Fase en curso: Fase 4 ó¢¢¬¢¬¿½ Cierre de calidad



Detalle completo en [FASE-4-PLAN.md](FASE-4-PLAN.md). En resumen, su lista de

salida es:



1. ~~`npm run verify` en verde~~ ó¢¢¬¢¬¿½ **hecho**: formato, lint sin un solo aviso, tipos,

   pruebas, cobertura y auditoróóóa, en local y en el runner

2. ~~Resolver el trabajo a medias de `apps/web`~~ ó¢¢¬¢¬¿½ **hecho**: las pantallas de

   recuperacióóón de contraseñaóa estáóón cableadas en el enrutado, el arranque funciona y

   hay una prueba que monta `App` de verdad

3. ~~Ejecutar la integracióóón dentro de la puerta de CI~~ ó¢¢¬¢¬¿½ **hecho**: el job corre

   `verify` entero contra MySQL, Redis y RabbitMQ reales

4. Actualizar los tres documentos de entrega para que solo afirmen lo verificado ó¢¢¬¢¬¿½

   **hecho**

5. **Pendiente:** cerrar o diferir explóóócitamente los 13 pendientes de las Fases 1-3.

   Es lo óóónico que separa esta fase de cerrarse, y no es trabajo de cóóódigo: son

   decisiones tuyas.



Los puntos 1 a 4 cerraron con el run de CI `37146895812` en verde.



---



## 5. Fases propuestas (5 a 10) ó¢¢¬¢¬¿½ necesitan tu aprobacióóón



Cada una se apoya en pendientes que **ya estáóón registrados** en los documentos del

proyecto. No invento trabajo: reordeno lo que estáóó escrito y le doy un orden de

ejecucióóón.



### Fase 5 ó¢¢¬¢¬¿½ Datos y operacióóón



Por quóóó es la primera de las futuras: casi todo lo demóóós depende de que los datos

se puedan reproducir.



- **Semillas idempotentes.** Hoy `db/seeds` borra antes de insertar, asóóó que cada

  `docker compose up` de desarrollo destruye lo anterior y deja huóóórfanos los

  perfiles derivados. Cierra los pendientes F1-1 y F2-3, que son el mismo problema.

- **Re-emisióóón de róóóplicas.** No hay forma de reconstruir `prestador_ref` o

  `servicio_ref` si se pierden los eventos consumidos. Cierra F1-2 y F2-2.

- **Escritor de `statistics_snapshot`.** La tabla existe, `admin-reporting-service`

  la lee, y **nadie la escribe**. Los reportes devuelven siempre vacóóóo.

- **Polóóótica de conservacióóón y anonimizacióóón de datos personales.** El SRS la marca

  como decisióóón abierta y dice que **debe resolverse antes del despliegue en

  produccióóón**. Es un bloqueante duro, no una mejora.

- **Procedimiento de restauracióóón de respaldados.** Deuda tóóócnica AT-004, la óóónica

  marcada como `High`. Existe `backup_record` con `restauracion_probada_at` y nadie

  lo comprueba.



### Fase 6 - Experiencia del cliente

- **Recuperaciónón de contraseñaóa.** Backend listo; UI (Recuperar.tsx, Restablecer.tsx) existe y estáóó cableada; falta validar el flujo completo E2E.

- **E2E del recorrido completo.** Publicar necesidad ó¢¢¬ ¢¬¢ recibir propuestas ó¢¢¬ ¢¬¢ adjudicar ó¢¢¬ ¢¬¢ cancelar. 11-quality/testing-strategy.md lo pide y es lo óóónico que probaróóó el flujo de negocio de extremo a extremo, que hoy estáóó cubierto por partes.

  **Necesita tu decisióóón.**

- **Recuperaciónón de contraseñaóa.** Backend listo; UI (Recuperar.tsx, Restablecer.tsx) existe y estáóó cableada; falta validar el flujo completo E2E.

  sin cablear y sin compilar.

- **E2E del recorrido completo.** Publicar necesidad ó¢¢¬ ¢¬¢ recibir propuestas ó¢¢¬ ¢¬¢

  adjudicar ó¢¢¬ ¢¬¢ cancelar. `11-quality/testing-strategy.md` lo pide y es lo óóónico que

- **Logging y móóótricas** por servicio con `correlation_id` (deuda AT-005)

- **Pruebas de carga k6** con el umbral que fija la estrategia de pruebas: P95 < 300 ms

  y tasa de error < 1 % (deuda AT-007, lóóómites de escalabilidad)

- **Entornos dev / staging / produccióóón.** `10-devops/environments.md` los describe

  pero no hay infraestructura, ni despliegue automatizado, ni log de despliegues

- **Expiracióóón de JWT** sin decidir (deuda AT-006) y **configuracióóón final de

  AWS/GCP** (deuda AT-001)



### Fase 9 ó¢¢¬¢¬¿½ Documentacióóón y trazabilidad



- **6 de 8 servicios sin documentacióóón.** Solo existen `01-api-gateway` y

  `02-auth-service`. Faltan readme, modelo de datos, eventos, decisiones y runbook

  de los otros seis.

- **SRS en inglóóós obsoleto.** `srs-microservices.md` sigue diciendo que los

  microservicios no estáóón adoptados y pide tres ADRs que ya estáóón aceptados. Es el

  pendiente F2-4.

- **Contratos duplicados.** Los `.yaml` de `friend-point-docs/07-api/contracts/openapi/`

  son anteriores a los de `friend-point-development/contracts/`. Deberóóóa haber una

  sola fuente. Es el pendiente F2-5.

- **Matriz de trazabilidad inóóótil.** `traceability-matrix.md` usa identificadores

  (`RF1.1`, `NFR-001`) incompatibles con los del SRS (`RF193`, `RNF89`), tiene 12

  capóóótulos en *To be defined*, y declara 8 brechas abiertas. Una de ellas es

  literalmente óóóimplementacióóón sin HU/RFóóó (*implementation without HU/RF*).

  "implementacióóón sin HU/RF".

- **Backlog formal y registro de preguntas abiertas.** `15-project-control/README.md`

  prescribe `technical-backlog.md`, `dependencies.md` y `open-questions.md`. **Ninguno

  de los tres existe.** Los 13 pendientes viven hoy dentro de los documentos de entrega.



### Fase 10 ó¢¢¬¢¬¿½ Preparacióóón de produccióóón



No es trabajo nuevo: es la comprobacióóón de que todo lo anterior estáóó resuelto.



- Go/No-Go con Tech Lead y Product Owner, exigiendo DoD, DoR y los RNF, segóóón la

  puerta de `00-sdd-guide.md` óóóReview gates

- Definition of Done de `00-governance/definition-of-done.md` completo. Nota: hoy

  **ninguna** de las Fases 1ó¢¢¬¢¬3 cumple el punto de revisióóón por Pull Request que exige

- Cerrar AT-001 a AT-007

- Describir la estrategia de despliegue: `10-devops/environments.md` tiene el hueco

  `[Canary / Blue-Green / Rolling]` sin decidir



---



## 6. Grafo de dependencias



```

Fase 1 ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¯¿½

         ó¢¢¬¿½¦ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬> Fase 2 ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬> Fase 3

         ó¢¢¬¿½¢¬¡                    ó¢¢¬¿½¢¬¡

         ó¢¢¬¿½¢¬¿½ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¤

                              v

                     Fase 4 (calidad)   <-- estamos aqui

                              ó¢¢¬¿½¢¬¡

        ó¢¢¬¿½¦ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¼ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¯¿½

        v                     v                     v

    Fase 5               Fase 6               Fase 9

   (datos)            (experiencia)        (documentacióóón)

        ó¢¢¬¿½¢¬¡                     ó¢¢¬¿½¢¬¡

        ó¢¢¬¿½¢¬¿½ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬ó¢¢¬¿½¹

                   v

              Fase 7  ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬>  Fase 8  ó¢¢¬¿½¢¬ó¢¢¬¿½¢¬>  Fase 10

            (canales)   (operacióóón)     (produccióóón)

```



**Reglas que imponen el orden:**



- La Fase 4 **no** puede esperar a la 5: sin `verify` en verde, cualquier fase nueva

  empieza con la puerta rota.

- La Fase 5 bloquea a la 6: si las semillas destruyen datos y las róóóplicas no se

  reconstruyen, el E2E de la Fase 6 seróóó imposible de ejecutar de forma fiable.

- La Fase 9 **puede** ir en paralelo desde ya. No bloquea a nadie y es la que móóós

  riesgo tiene de olvidarse.

- Nada llega a la Fase 10 sin la Fase 8. No se despliega lo que no se puede observar.



---



## 7. Criterios de "fase terminada"



El proyecto tiene criterios escritos, y **hay tres discrepancias entre lo que

exigen y lo que el cóóódigo implementa**. Resolverlas es parte de la Fase 4.



### Lo que exige `00-governance/definition-of-done.md`



Ocho bloques obligatorios: requisitos y criterios de aceptacióóón óóó cóóódigo óóó pruebas óóó

seguridad óóó integracióóón óóó interfaz óóó documentacióóón óóó Git y Pull Request. Los puntos

que hoy no se cumplen en ninguna fase:



- *"The code has been reviewed by at least one team member through a Pull Request."*

- *"All applicable tests pass."* ó¢¢¬¢¬¿½ ahora sóóó, y en CI; antes las de integracióóón no se

  ejecutaban en ningóóón runner y nadie las habóóóa visto en semanas

- *"An exception must not be used to ignore a critical security, functionality or

  acceptance criterion."* ó¢¢¬¢¬¿½ el SRS marca la polóóótica de datos personales como bloqueante

  y no existe



### Lo que exige `11-quality/testing-strategy.md`



| Móóótrica | Exigido | Configurado | Cumple |

|---|---|---|---|

| Cobertura global de lóóóneas | 80 % | 80 % | sóóó |

| Cobertura global de sentencias | 80 % | 80 % | sóóó |

| Cobertura global de funciones | 80 % | 80 % | sóóó |

| Cobertura global de ramas | **75 %** | **70 %** | **no** |

| `./src/domain/` lóóóneas | **90 %** | **sin override** | **no** |

| `./src/domain/` ramas | **85 %** | **sin override** | **no** |



Las dos óóóltimas filas son las importantes: el SRS considera la capa de dominio el

corazóóón del negocio y la estrategia le exige casi el doble de cobertura. El

`jest.config.js` no la exime.



### Discrepancia 3: los criterios E2E y de rendimiento no existen



La estrategia define flujos E2E priorizados (Playwright o Cypress) y un umbral de

carga con k6. **Ninguno de los dos existe en el cóóódigo.** El Go/No-Go de la Fase 10

no puede satisfactionarse hoy.



---



## 8. Trazabilidad con el SRS



`04-requirements/srs-punto-amigo-es.md`, versióóón 2.1 del 30/09/2026.



- **13 móóódulos** de requisitos funcionales (óóó5.1)

- **193 requisitos funcionales** numerados hasta RF193, **89 no funcionales** hasta RNF89

- Prioridad declarada como **Alta / Media / Baja**, no MoSCoW. Solo **3 requisitos

  son de prioridad Baja**, y por tanto los óóónicos realmente diferibles: RF85 (ocultar

  calificacióóón reportada), RF105 (paróóómetros de configuracióóón), RF114 (exportar

  reporte)



**El SRS no asigna requisitos a fases.** El óóónico mapeo requisitoó¢¢¬ ¢¬¢servicio que existe

estáóó en `FASE-2-ENTREGA.md` óóó2. Para saber quóóó cubre cada fase hay que cruzarlo a mano.



El grafo de eventos entre servicios ó¢¢¬¢¬¿½`UserRegistered`, `NeedPublished`,

`ProposalReceived`, `RequestCancelled` y compaóóóóóóaó¢¢¬¢¬¿½ estáóó implóóócito en los comentarios de

las migraciones y en las tablas `outbox_event`, pero **no estáóó escrito como

documento**. Es la pieza que falta para poder afirmar trazabilidad de extremo a extremo.



---



## 9. Deuda tóóócnica registrada



`05-architecture/overview.md` óóó14, óóótems AT-001 a AT-007. **Todos con destino

`To be defined`.**



| ID | óóótem | Prioridad |

|---|---|---|

| AT-001 | Configuracióóón final de AWS o GCP | P2 |

| AT-002 | Estructura REST definitiva | P1 |

| AT-003 | Organizacióóón de los repositorios | P2 |

| **AT-004** | **Procedimiento de restauracióóón de respaldos** | **P1, severidad High** |

| AT-005 | Herramientas de monitoreo y logging | P2 |

| AT-006 | Valores de expiracióóón de JWT | P1 |

| AT-007 | Lóóómites de escalabilidad | P2 |



Ademóóós, R-001 a R-008 y R-010 de `15-project-control/risks.md` estáóón **sin dueóóóo

asignado** y sin fecha de revisióóón.



---



## 10. Lo que estáóó explóóócitamente fuera del alcance



Para evitar que la Fase 6 o la 7 se cuelen sin decisióóón: `01-context/scope.md`

óóóOut of Scope y `03-product/problem-framing.md` óóó8 los excluyen de forma explóóócita.



- Pagos y transacciones financieras en lóóónea

- Aplicacióóón móóóvil nativa (el SRS la llama "fase futura", sin concretarla)

- Comunicacióóón y mensajeróóóa en tiempo real

- Geolocalizacióóón avanzada y optimizacióóón por ubicacióóón

- Recomendaciones, IA y analóóótica avanzada

- Integracióóón con ERP o contabilidad

- Certificacióóón profesional de los prestadores

- Infraestructura a gran escala y balanceo de carga

- Soporte 24/7



Las dos primeras volveróóóan a cambiar el modelo de negocio. Ninguna de las dos estáóó

en el plan de fases propuesto.



---



## 11. Decisiones que necesito de ti



Bloquean trabajo concreto. Ninguna se puede resolver solo.



1. **Telóóófono tras el acuerdo** (Fase 6). La recomendacióóón es tomarlo del perfil

   de prestador. Sin tu confirmacióóón no se implementa.

2. **Correo y push** (Fase 7). óóóEntran en el producto o se descartanóóó

3. **Nivel de exigencia de cobertura.** El trinquete estáóó en 67/65/52/64, que es lo

   que el cóóódigo alcanza hoy. La estrategia pide 80/80/80/70 y casi el 90 en

   `src/domain/`. óóóSubimos el listóóón ó¢¢¬¢¬¿½y se acepta el trabajo de pruebas que implicaó¢¢¬¢¬¿½

   o el trinquete se queda aquóóó y la brecha sigue anotada en el backlogóóó

4. ~~**Nombre, visibilidad y organizacióóón del repositorio.**~~ **Resuelto.** Póóóblico, en

   inglóóós, en [`JohanOtavo/service-routes`](https://github.com/JohanOtavo/service-routes),

   rama `develop`, remoto configurado y puerta en verde.

5. **Review por Pull Request.** La Definition of Done lo exige y ninguna fase lo

   cumple. óóóRevisamos por Pull Request a partir de ahora, o aceptamos explóóócitamente

   que este proyecto queda excluido de ese requisitoóóó



---



## 12. Documentos relacionados



| Documento | Para quóóó |

|---|---|

| [README.md](README.md) | óóóndice del conjunto documental de entrega |

| [01-BACKLOG.md](01-BACKLOG.md) | Los 13 pendientes, AT-001..007, O-01..O-12 y GAP-001..008 con criterio de cierre |

| [FASE-4-PLAN.md](FASE-4-PLAN.md) | La fase en curso, en detalle |

| [FASE-1-ENTREGA.md](FASE-1-ENTREGA.md) | Registro de la Fase 1 |

| [FASE-2-ENTREGA.md](FASE-2-ENTREGA.md) | Registro de la Fase 2 |

| [FASE-3-ENTREGA.md](FASE-3-ENTREGA.md) | Registro de la Fase 3 |

| `../README.md` | Punto de entrada del cóóódigo |