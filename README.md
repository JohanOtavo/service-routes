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

**Fases 1, 2 y 3 construidas.** Los siete esquemas con sus migraciones versionadas
y seeds, los ocho microservicios detrás del gateway, y el cliente web PWA. La
puerta de calidad del repositorio (`npm run verify`) pasa en local y en CI.

El estado medido de cada puerta, y los 48 elementos de trabajo que quedan
abiertos, están en [`docs/00-FLUJO-DEL-PROYECTO.md`](docs/00-FLUJO-DEL-PROYECTO.md)
§1 y [`docs/01-BACKLOG.md`](docs/01-BACKLOG.md). Quién publica cada evento y quién
lo consume está en [`docs/02-GRAFO-DE-EVENTOS.md`](docs/02-GRAFO-DE-EVENTOS.md).
Este README describe cómo se arranca el proyecto, no en qué punto está.

---

## Arranque

Requiere Docker 24+, Docker Compose 2.20+ y Node.js 20 LTS.

```bash
cp .env.example .env
docker compose up -d
```

Eso levanta MySQL, Redis y RabbitMQ, crea los siete esquemas con un usuario de
privilegio mínimo cada uno, aplica las migraciones y carga los seeds.

> **Si acabas de tocar `db/migrations` o `db/seeds`, usa `docker compose up -d --build`.**
> El servicio `migrator` usa una imagen con etiqueta fija
> (`punto-amigo/migrator:local`), y Compose no la reconstruye si ya existe: sin
> `--build` seguiría ejecutando el código anterior y los cambios parecerían no
> tener efecto. Es la razón por la que `db/` se copia dentro de la imagen en vez
> de montarse como volumen.

Para comprobar que terminó bien:

```bash
docker compose logs migrator
```

### Los seeds se pueden repetir

`docker compose up -d` carga los seeds en cada arranque, así que
`npm run db:seed` es idempotente: no borra nada, busca por clave natural (el
correo del usuario, el nombre del rol, el de la categoría) e inserta o actualiza.
Los identificadores se conservan, de modo que las claves foráneas de los demás
esquemas siguen apuntando a alguien que existe.

Antes sí borraban sus tablas antes de insertar, así que `usuario.id_usuario`
cambiaba en cada ejecución y las tablas `*_ref` de los demás esquemas —
que **no** tienen clave foránea contra `pa_auth.usuario` porque viven en otro
esquema— quedaban apuntando a filas fantasma sin un solo error. Lo comprueba
`db/tests/seeds-idempotency.int.test.ts` contra MySQL real.

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

### Comprobar que los invariantes se cumplen

```bash
bash db/verify-invariants.sh
```

31 pruebas de invariantes contra la base real: 25 **intento violar** un invariante
del modelo y 6 comprueban que una escritura legítima sigue pasando. Cada prueba
negativa pasa solo si MySQL **rechaza** la escritura: dos propuestas adjudicadas
sobre la misma necesidad, una contratación por adjudicación que nace pendiente, un
`UPDATE` sobre la auditoría, una puntuación fuera de rango, o un servicio leyendo
el esquema de otro. Un invariante que solo está en la documentación no cuenta como
implementado.

### Si una migración falla a medias

MySQL confirma cada sentencia DDL por separado, así que una migración que falle
en mitad deja creadas las tablas anteriores sin quedar registrada como aplicada.
No hay forma de hacerla transaccional. Cuando ocurra:

```bash
node db/cli.js status          # ver qué esquema quedó a medias
docker exec -it pa-mysql mysql -uroot -p   # soltar las tablas parciales
node db/cli.js migrate <servicio>
```

En desarrollo suele salir más a cuenta `docker compose down -v` y volver a
empezar.

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

`npm test` corre las 368 pruebas, y 133 de ellas son de integración: necesitan el
MySQL, el Redis y el RabbitMQ del compose levantados. `jest.global-setup.js` carga
`.env`, traduce los hosts de Compose a `127.0.0.1` y **exige que la integración
se ejecute de verdad**: si la base no responde, las pruebas fallan en lugar de
quedarse en un "omitido" que Jest cuenta como aprobado. Para correrlas sin
infraestructura, y aceptando que no prueban nada:

```bash
SKIP_INTEGRATION=1 npm test          # bash
$env:SKIP_INTEGRATION='1'; npm test  # PowerShell
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
