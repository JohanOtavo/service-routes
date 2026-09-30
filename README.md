# Punto Amigo — desarrollo

Plataforma de intermediación de servicios locales. Conecta a quien ofrece un
servicio con quien lo necesita, por dos caminos: el prestador publica servicios y
el solicitante los busca, o el solicitante publica una necesidad y los prestadores
le envían propuestas.

Este repositorio contiene el **código**. Los requisitos, la arquitectura y la
gobernanza viven en [`friend-point-docs`](../friend-point-docs).

| Fuente de verdad | Documento |
|---|---|
| Requisitos (173 RF, 89 RNF) | `friend-point-docs/04-requirements/srs-punto-amigo-es.md` |
| Entidades e invariantes | `friend-point-docs/02-domain/entities-and-rules.md` |
| Eventos de dominio | `friend-point-docs/02-domain/domain-events.md` |
| Contratos de API | `friend-point-docs/07-api/contracts/openapi/` |
| Reglas de seguridad | `friend-point-docs/00-governance/security-rules.md` |
| Convenciones de commit y ramas | `friend-point-docs/00-governance/git-conventions.md` |

---

## Estado

**Fase 1 — base de datos.** Los siete esquemas, sus migraciones versionadas y los
seeds de desarrollo están construidos. Los servicios de aplicación (Fase 2) y el
cliente web (Fase 3) todavía no.

---

## Arranque

Requiere Docker 24+, Docker Compose 2.20+ y Node.js 20 LTS.

```bash
cp .env.example .env
docker compose up -d
```

Eso levanta MySQL, Redis y RabbitMQ, crea los siete esquemas con un usuario de
privilegio mínimo cada uno, aplica las migraciones y carga los seeds.

Para comprobar que terminó bien:

```bash
docker compose logs migrator
```

### Usuarios de prueba

Los crea el seed. La contraseña de todos es `PuntoAmigo.Dev.2026` y solo existe en
desarrollo.

| Correo | Roles |
|---|---|
| `admin@puntoamigo.local` | Administrador, Solicitante |
| `solicitante@puntoamigo.local` | Solicitante |
| `oferente@puntoamigo.local` | Solicitante, Oferente |
| `ambos@puntoamigo.local` | Solicitante, Oferente |

La última cuenta es el caso que el modelo anterior no podía representar: una misma
persona que presta un servicio y además necesita contratar otros.

---

## Base de datos

Un esquema por microservicio, cada uno con sus propias credenciales. Ningún
servicio puede leer el esquema de otro: la propiedad de los datos la impone la
infraestructura, no la disciplina de quien programa.

| Esquema | Servicio | Contenido |
|---|---|---|
| `pa_auth` | auth-service | Usuarios, roles, sesiones, recuperación, bloqueo |
| `pa_provider` | provider-service | Perfiles de prestador y su validación |
| `pa_catalog` | catalog-service | Servicios publicados y categorías |
| `pa_request` | request-service | Necesidades, propuestas, solicitudes, historial |
| `pa_rating` | rating-service | Calificaciones bidireccionales y reputación |
| `pa_notification` | notification-service | Notificaciones y preferencias |
| `pa_admin` | admin-reporting-service | Auditoría, moderación, reportes, respaldos |

### Comandos

```bash
npm run db:migrate              # aplica las migraciones pendientes
npm run db:migrate -- request   # solo un esquema
npm run db:rollback             # revierte el último lote
npm run db:seed                 # carga los datos de desarrollo
npm run db:reset                # reconstruye desde cero (solo desarrollo)
node db/cli.js status           # qué migraciones faltan
```

### Revisar el DDL sin levantar MySQL

```bash
node db/compile-sql.js          # imprime el SQL que generarían las migraciones
node db/compile-sql.js request  # solo un esquema
```

Útil para revisar un cambio de esquema en una revisión de código sin tener que
levantar la base de datos.

---

## Calidad

```bash
npm run verify    # formato + linter + tipos + pruebas + auditoría de dependencias
```

Cada comprobación por separado:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run audit
```

---

## Estructura

```
db/                     Migraciones, seeds y CLI de base de datos
  init/                 Creación de esquemas y usuarios (se ejecuta una vez)
  migrations/<svc>/     Migraciones versionadas por servicio
  seeds/<svc>/          Datos de desarrollo
packages/shared/        Código compartido: sobre de eventos, errores
services/<svc>/         Un microservicio, con estructura hexagonal
  src/domain/           Entidades, objetos de valor, puertos. Sin dependencias externas
  src/application/      Casos de uso
  src/infrastructure/   Adaptadores: HTTP, persistencia, mensajería
apps/web/               Cliente React PWA
```

La estructura por servicio sigue `friend-point-docs/_stacks/node-typescript.md`.

---

## Contribuir

Conventional Commits y PR contra `develop`, según
`friend-point-docs/00-governance/git-conventions.md` y `CONTRIBUTING.md`.
