# Entornos y despliegue — Punto Amigo

Qué entornos existen de verdad hoy, qué pide el documento de DevOps, y qué
hace falta decidir para cerrar la diferencia.

- Fecha: **4 de octubre de 2026**
- Fuente de los requisitos: `friend-point-docs/10-devops/environments.md`
- Deuda que sigue abierta aquí: **AT-001** (configuración final de AWS o GCP) y
  la estrategia de despliegue, que en el documento de DevOps es literalmente
  `[Canary / Blue-Green / Rolling]` sin elegir. **Las dos son decisiones tuyas**

---

## 1. Lo que existe

| Entorno | Cómo se levanta | Estado |
|---|---|---|
| **local** | `docker compose --profile apps up -d --wait` | Funciona. Nueve contenedores, siete esquemas MySQL, RabbitMQ y Redis |
| **local + paneles** | `docker compose --profile observabilidad up -d` | Funciona. Prometheus y Grafana, ver [05-OBSERVABILIDAD.md](05-OBSERVABILIDAD.md) |
| **CI** | `.github/workflows/ci.yml` | Funciona. Tres trabajos: migraciones contra MySQL real, puerta completa, y el recorrido en un navegador real |
| **dev** | — | **No existe.** No hay infraestructura ni despliegue automático |
| **staging** | — | **No existe** |
| **producción** | — | **No existe** |

Los tres últimos no son trabajo de código: son una cuenta de nube, una red, un
registro de imágenes y un secreto. Nada de eso se puede inventar en el
repositorio sin elegir antes el proveedor, que es AT-001.

## 2. Configuración

Toda la configuración entra por variables de entorno, validadas con Zod **al
arrancar**: un servicio con una variable ausente o mal formada no arranca y dice
cuál es. El contrato está en `.env.example`, que se versiona sin valores reales.

```bash
cp .env.example .env   # y rellenar los valores propios
```

### Guardias de producción

`assertProductionSafety` ([packages/shared/src/config/env.ts](../packages/shared/src/config/env.ts))
se ejecuta en el arranque de los nueve procesos y, **solo cuando
`NODE_ENV=production`**, rechaza dos cosas:

| Comprobación | Por qué |
|---|---|
| `CORS_ORIGIN` no puede ser `*` | un comodín en producción deja que cualquier origen lea respuestas con credenciales |
| `INTERNAL_SERVICE_SECRET` no puede empezar por `local-` | es el prefijo de los valores de ejemplo: detecta un despliegue que se llevó el `.env.example` puesto |

A eso se suman los guardias de datos: `db/cli.js` rechaza `seed` y `reset`
cuando `NODE_ENV` no es `development` o `test`, y lo rechaza también cuando no
está definido, tratando lo desconocido como lo más peligroso. `reemit` sí se
permite en producción, porque reconstruir una réplica perdida es una operación
de recuperación, no de desarrollo.

### Diferencias con el documento de DevOps

Tres, y conviene tenerlas escritas antes de montar un entorno con ese documento
en la mano:

1. **La convención de nombres no se usa.** El documento prescribe
   `APP_[SERVICIO]_[VARIABLE]` (`APP_AUTH_JWT_SECRET`); el código usa
   `JWT_PRIVATE_KEY`, `DB_AUTH_PASSWORD`, `RABBITMQ_HOST`. Renombrar 60
   variables para cumplir una convención que nadie necesita todavía es trabajo
   sin beneficio: lo que hace falta es decidir cuál de las dos gana y anotarlo.
2. **El ejemplo del documento es PostgreSQL** (`postgresql://dev:dev@localhost/dev_db`).
   El sistema usa **MySQL 8**, con siete esquemas aislados y un usuario por
   servicio (SRS RNF28). El documento está desactualizado, no el código.
3. **No hay gestor de secretos.** El documento habla de Vault o AWS Secrets; hoy
   los secretos viven en un `.env` local y en los `secrets` de GitHub Actions
   para CI. Elegir el gestor es parte de AT-001.

## 3. Lo que ya cumple del pipeline que pide el documento

| Paso que pide `environments.md` | Estado |
|---|---|
| Lint + comprobación de formato | **Sí**, en `verify` |
| Comprobación de tipos | **Sí** |
| Pruebas unitarias | **Sí**, 212 |
| Pruebas de integración contra servicios reales | **Sí**, 152, con MySQL, RabbitMQ y Redis de verdad |
| Pruebas E2E en navegador | **Sí**, 4 recorridos en Chromium, en CI |
| Auditoría de dependencias | **Sí**, `npm audit --audit-level=high` |
| Construcción de imágenes | **Sí**, las nueve se construyen en el trabajo E2E |
| Publicación en un registro | **No.** Necesita registro y credenciales (AT-001) |
| Despliegue automático a dev / staging | **No.** Necesita infraestructura |
| Aprobación manual a producción | **No.** Necesita entorno |
| Revisión por Pull Request | **No.** Ninguna fase lo ha cumplido todavía; es un punto obligatorio del *Definition of Done* |

## 4. Lo que hay que decidir

| Decisión | Por qué bloquea | Quién decide |
|---|---|---|
| **AT-001**: AWS o GCP | Sin proveedor no hay red, ni registro de imágenes, ni gestor de secretos, ni nada que desplegar | Tú |
| Estrategia de despliegue | `10-devops/environments.md` la deja como `[Canary / Blue-Green / Rolling]`. Con nueve servicios y un gateway, la elección cambia cómo se construye el pipeline | Tú |
| Convención de variables | O el código adopta `APP_*`, o el documento adopta la del código. Hoy se contradicen | Tú |
| Las seis de datos personales | [04-POLITICA-DATOS-PERSONALES.md](04-POLITICA-DATOS-PERSONALES.md). Siguen bloqueando producción, con independencia de la nube | Tú |

## 5. Lo mínimo para un entorno real, cuando haya decisión

No es un plan de infraestructura, es la lista de lo que el código ya espera
encontrar:

- **MySQL 8** con los siete esquemas y un usuario por servicio, creados como
  hace `db/init/01-schemas-and-users.sh`. Las migraciones las aplica el
  contenedor `migrator` (`node db/cli.js migrate`), que no necesita nada más que
  la red y las credenciales.
- **RabbitMQ** con el intercambio `punto-amigo.events` de tipo *topic* y
  duradero. Los servicios lo declaran al conectar, así que basta el broker.
- **Redis** para la lista de denegación de tokens del gateway.
- **Nueve contenedores**, uno por servicio más el gateway, con el gateway como
  único proceso con el puerto publicado (SRS-GW-01, RNF25).
- **Respaldos** según [03-RUNBOOK-RESPALDOS.md](03-RUNBOOK-RESPALDOS.md), con la
  restauración probada y no supuesta.
- **Un destino para los registros** y un Prometheus que alcance los nueve
  `/metrics` por la red interna.
