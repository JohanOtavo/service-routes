# Fase 8 — Observabilidad y despliegue · Entrega

> **Alcance de este documento.** Describe lo construido el **4 de octubre de
> 2026**. Cuando dice «verificado», se refiere a una comprobación hecha ese día
> y citada con su resultado.

- Fase: **8 de 10** — Observabilidad y despliegue
- Estado: **completada** en lo que depende del código. Lo que falta son dos
  decisiones tuyas, AT-001 y la estrategia de despliegue, que no se pueden
  resolver escribiendo código
- Puerta: `npm run verify` en verde — **364 pruebas**, cobertura
  68,4 / 56,14 / 67,52 / 70,58
- Deudas cerradas: **AT-005**, **AT-006**, **AT-007**

---

## 1. Qué se pidió y qué se entregó

| Pendiente | Criterio de cierre escrito en el backlog | Estado |
|---|---|---|
| **AT-005** | «Todos los servicios emiten logs estructurados con `correlation_id` y hay panel de métricas» | **Cerrado**. Nueve procesos, una línea JSON por petición con su `correlationId`, nueve `/metrics` y un panel de cinco gráficas provisionado desde archivos |
| **AT-006** | «Access, refresh y denylist tienen caducidad decidida, documentada y testeada» | **Cerrado**. Los tres documentados en [05-OBSERVABILIDAD.md](05-OBSERVABILIDAD.md) §5; el de la lista de denegación estaba escrito a mano y ahora sale de la configuración, con prueba de regresión |
| **AT-007** | «Hay una prueba k6 con el umbral de la estrategia: P95 < 300 ms, error < 1 %» | **Cerrado**. `npm run carga`: P95 **6,98 ms**, error **0 %**, 5.403 comprobaciones |
| Entornos dev / staging / producción | — | **No entregado, y es honesto decirlo.** Requiere elegir nube: es AT-001. Lo que sí hay es el inventario de lo que el código espera encontrar, en [06-ENTORNOS-Y-DESPLIEGUE.md](06-ENTORNOS-Y-DESPLIEGUE.md) |

## 2. Lo que se construyó

| Pieza | Archivo |
|---|---|
| Logger, registro de acceso y métricas, compartidos | [packages/service-kit/src/observabilidad.ts](../packages/service-kit/src/observabilidad.ts) |
| Recolección | [observabilidad/prometheus.yml](../observabilidad/prometheus.yml) |
| Panel y origen de datos, provisionados | [observabilidad/grafana/](../observabilidad/grafana/) |
| Prometheus y Grafana, en su propio perfil | `docker-compose.yml`, perfil `observabilidad` |
| Prueba de carga y su lanzador | [k6/carga.js](../k6/carga.js), [k6/ejecutar.js](../k6/ejecutar.js) |
| Superposición para medir sin pelearse con el limitador | [docker-compose.carga.yml](../docker-compose.carga.yml) |
| Documentación | [05-OBSERVABILIDAD.md](05-OBSERVABILIDAD.md), [06-ENTORNOS-Y-DESPLIEGUE.md](06-ENTORNOS-Y-DESPLIEGUE.md) |

Y una limpieza que entró con ella: los nueve servicios tenían **el mismo objeto
`logger` copiado nueve veces**, y auth-service tenía además una copia completa
—222 líneas— de los middlewares HTTP compartidos, incluido el guardia que
compara el secreto interno en tiempo constante. Las dos copias se eliminaron.

## 3. Defectos encontrados por el camino

Ninguno de estos se buscó. Salieron al intentar poner el recorrido E2E en verde
**en CI**, que era lo que quedaba de la Fase 6.

### 3.1 El script de init de MySQL no era ejecutable

El contenedor `pa-mysql` se declaraba insano a los siete segundos. El registro
decía lo que hacía falta, en dos líneas seguidas:

```
pa-mysql  | [init] listo: 7 esquemas, 7 usuarios, aislamiento verificado
pa-mysql  | /usr/local/bin/docker-entrypoint.sh: line 342: MYSQL_ONETIME_PASSWORD: unbound variable
```

El entrypoint de MySQL ejecuta los `.sh` de `initdb.d` como proceso aparte
**solo si son ejecutables**; si no, los hace `source` en su propio shell. El
script llevaba modo `0644`, así que su `set -euo pipefail` se quedó pegado al
entrypoint, que muere en su línea 342 al leer una variable sin definir y
reinicia el contenedor en bucle.

En Docker Desktop el bind mount regala el bit de ejecución y nunca se nota; en
CI, donde el modo sale de git, se nota a la primera. Verificado en los dos
sentidos contra `mysql:8.0` con un script de prueba: a `0644` el entrypoint
registra «sourcing», imprime el error y el contenedor sale; a `0755` registra
«running» y llega a «ready for connections».

### 3.2 El broker no se reconectaba si fallaba el PRIMER intento

La reconexión colgaba del evento `close` de una conexión **existente**. Cuando
un servicio arrancaba antes de que RabbitMQ estuviera listo, no había ninguna
conexión de la que colgarla: `disponible` se quedaba en `false` para siempre, el
relevo del outbox cortaba cada ciclo en su primera línea, y los eventos se
acumulaban **con `attempts = 0`**, sin un solo intento registrado. El servicio
seguía sano y el registro decía «broker no disponible al arrancar; se reintenta
en segundo plano», que era mentira.

Reconectar tampoco devolvía las suscripciones: `basic.consume` vive en el canal
que se murió, y los consumidores se suscribían una sola vez, al arrancar. Ahora
el broker guarda enganches que rehace en cada conexión, y el consumidor se
engancha desde su constructor; suscribirse es idempotente por canal, porque dos
`consume` en el mismo canal entregarían cada evento dos veces.

Verificado contra la pila: con RabbitMQ parado, auth-service y
notification-service arrancaron y fallaron al conectar; al arrancar RabbitMQ,
los **nueve eventos pendientes se publicaron en 20 s** y el registro mostró
«reconectado al broker» una vez.

Esto es lo que impedía que llegara el correo de recuperación de contraseña.

### 3.3 `npm test` no medía casi nada en una máquina de desarrollo

Las pruebas de integración **se omiten solas** cuando no alcanzan MySQL, y se
cuentan como aprobadas: 151 pruebas «pasando» sin tocar la base, y la cobertura
marcando 42 % contra un umbral de 67 % sin que nada fallara. `jest.config.js`
ahora carga el `.env` y fija `MYSQL_HOST` a `127.0.0.1` salvo que quien llama lo
imponga, porque el valor del `.env` es el nombre del servicio de compose y solo
resuelve dentro de Docker.

Esa puerta arreglada encontró un defecto real en su primera ejecución: el broker
falso de `consumer-idempotency.int.test.ts` no tenía `onConectado`, y sus tres
pruebas lanzaban excepción. Llevaban omitidas el tiempo suficiente para que
nadie lo supiera.

### 3.4 Las E2E no leían el `.env` en CI

Cuatro pruebas morían con «Falta SEED_DEV_PASSWORD» **después** de haber
levantado los nueve contenedores. El proceso de Playwright hereda solo lo que
exporta el shell, y el workflow escribía el valor en el `.env`, que nadie leía.
`playwright.config.ts` lo carga ahora, igual que `db/knexfile.js`.

### 3.5 Las semillas no llenan las réplicas

El recorrido fallaba en su primer paso: la necesidad se publicaba y su título no
aparecía. Las semillas insertan filas y nada más —no escriben en el outbox— y
cada réplica de solo lectura se alimenta únicamente de eventos, así que en un
entorno recién creado `pa_request.categoria_ref` queda **vacío** y publicar una
necesidad se rechaza porque su categoría «no está activa». `npm run db:reemit`
es exactamente para esto, y es lo que el trabajo de CI no hacía.

### 3.6 La imagen del migrador se quedaba vieja en silencio

`docker compose --profile apps build` construye las nueve imágenes de la
aplicación y **no** la del migrador, que estaba en el perfil por omisión. En una
máquina donde esa imagen se construyó antes de la Fase 6, levantar la pila
aplicaba tres de las cuatro migraciones de `pa_request`: faltaba la columna
`telefono` de `prestador_ref`, el consumidor fallaba al replicar un prestador, y
el recorrido moría con un 409 «Necesita un perfil de prestador» que no
mencionaba ninguna migración. El migrador lleva ahora los dos perfiles.

### 3.7 La precondición del recorrido se ataba a un identificador que podía cambiar

El perfil de prestador se sembraba en el `beforeAll`, leyendo el `id_usuario`
por correo. Si el seed volvía a crear las cuentas con identificadores nuevos
—algo que pasa en una base que acumula ejecuciones— el perfil quedaba atado al
viejo mientras el token llevaba el nuevo. Se prepara ahora **después** de
iniciar sesión.

## 4. Verificación

| Comprobación | Resultado |
|---|---|
| `npm run verify` | **364 pruebas**, cobertura 68,4 / 56,14 / 67,52 / 70,58, 0 vulnerabilidades altas |
| `npx playwright test` desde volúmenes vacíos | **4 de 4**, siguiendo el mismo camino que CI: `up --wait`, semillas, `db:reemit`, espera de réplicas |
| Objetivos de Prometheus | **10 de 10** en `up` |
| Panel de Grafana | provisionado, UID `punto-amigo`, consultas devolviendo datos |
| `/metrics` del gateway en el puerto público | **404**, como debe ser |
| `npm run carga` | P95 **6,98 ms** contra un umbral de 300 ms; **0 %** de error |
| Regresión de la lista de denegación | falla con el literal anterior (899.814 ms frente a un máximo de 301.000 ms) y pasa con la configuración |

## 5. Lo que queda, y de quién depende

| Pendiente | De quién |
|---|---|
| **AT-001**: elegir AWS o GCP | **Tuyo.** Sin nube no hay entorno dev, staging ni producción |
| Estrategia de despliegue (`[Canary / Blue-Green / Rolling]`) | **Tuyo** |
| Las seis decisiones de datos personales | **Tuyo.** Siguen bloqueando producción |
| **J-1**: el limitador por IP detrás del gateway | Código, anotado en el backlog |
| Alertas, registros centralizados, trazas | Necesitan destino y turno de guardia: decisión de operación |
| Revisión por Pull Request | Ninguna fase la ha cumplido; es obligatoria en el *Definition of Done* |

La siguiente fase es la **9 — documentación y trazabilidad**, que no depende de
ninguna decisión pendiente, y después la **10 — preparación de producción**, que
no es trabajo nuevo sino la comprobación de que todo lo anterior está resuelto.
