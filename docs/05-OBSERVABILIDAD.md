# Observabilidad — Punto Amigo

Cómo se ve por dentro el sistema cuando está corriendo: qué registra, qué mide,
dónde se mira y qué se sabe de su capacidad.

- Fecha: **4 de octubre de 2026**
- Cierra: **AT-005** (herramientas de monitoreo y logging), **AT-006**
  (caducidad de los tokens) y **AT-007** (límites de escalabilidad)
- Alcance: lo que existe en el repositorio y se puede ejecutar hoy. El
  despliegue en una nube sigue siendo la decisión AT-001, y está en
  [06-ENTORNOS-Y-DESPLIEGUE.md](06-ENTORNOS-Y-DESPLIEGUE.md)

---

## 1. Registro

Cada uno de los nueve procesos emite **una línea JSON por evento**, por stderr.

```json
{"ts":"2026-10-04T17:31:52.292Z","level":"info","service":"request-service","mensaje":"peticion","correlationId":"8e1ed013-f161-4d1e-8d4a-08d76b73e761","method":"POST","path":"/api/v1/needs","route":"/api/v1/needs","status":201,"ms":16,"usuario":34}
```

Lo que hace útil esa línea no es el formato, es el `correlationId`. El gateway
toma el que llega en `x-correlation-id` —y solo si tiene forma de UUID, para que
un cliente no pueda meter lo que quiera en los registros de nueve servicios— o
genera uno, lo devuelve en la respuesta y lo propaga a los servicios de dentro.
Una operación que atravesó el gateway y tres servicios deja de ser cuatro líneas
sin relación entre ellas (SRS RNF77, RNF78).

| Pieza | Dónde vive |
|---|---|
| `crearLogger(servicio)` | [packages/service-kit/src/observabilidad.ts](../packages/service-kit/src/observabilidad.ts) |
| `accessLog(logger)` | el mismo archivo; una línea por petición servida |
| `correlationId` | [packages/service-kit/src/http.ts](../packages/service-kit/src/http.ts) |

Tres decisiones que conviene conocer antes de cambiarlas:

- **Todo el registro va a stderr, incluido `info`.** `console.log` escribe en
  stdout, que es donde varios procesos de este repositorio esperan **datos**
  (`db/cli.js`, los scripts con `--silent`). Mezclar registro y datos en el
  mismo flujo rompe a quien los consuma.
- **El registro de acceso no copia cuerpos ni cabeceras.** El cuerpo de
  `/auth/login` lleva la contraseña y el de `/auth/refresh` el token: un
  registro que los copiara convertiría el fichero de log en un almacén de
  credenciales ([04-POLITICA-DATOS-PERSONALES.md](04-POLITICA-DATOS-PERSONALES.md)).
- **`/health` y `/metrics` no se registran.** Los consultan el orquestador y
  Prometheus cada pocos segundos, y ahogarían todo lo demás.

Antes de esta fase los nueve servicios tenían **el mismo objeto `logger`
copiado nueve veces** en su `main.ts`. Ahora hay uno. El de auth-service,
además, tenía una copia completa de los middlewares HTTP compartidos —222
líneas, incluido el guardia que compara el secreto interno en tiempo
constante—; se eliminó, y el servicio usa el del `service-kit` como los otros
siete.

## 2. Métricas

Cada proceso expone `GET /metrics` en el formato de texto de Prometheus, con su
propio `Registry`.

| Métrica | Qué responde |
|---|---|
| `http_request_duration_seconds` | histograma por `method`, `route` y `status`. Los cortes incluyen **0,3 s** a propósito: es el umbral de la estrategia de pruebas, y un histograma solo puede responder por un percentil si tiene un corte cerca. Con los cortes por omisión de `prom-client` el salto va de 0,25 s a 0,5 s y el P95 saldría interpolado justo donde está el umbral |
| `http_requests_errors_total` | contador de 5xx. Solo 5xx: un 4xx es el cliente equivocándose y no debería despertar a nadie |
| Métricas de proceso | memoria residente, CPU, descriptores y bucle de eventos, las de `prom-client` por omisión |
| `rabbitmq_queue_messages_ready` | profundidad de cada cola, del plugin `rabbitmq_prometheus` que la imagen ya traía activado. Es la señal que delata un consumidor parado: los servicios siguen sanos, responden a `/health`, y los mensajes se acumulan |

**La etiqueta `route` es la plantilla, nunca la ruta concreta.** Una métrica
etiquetada con `/api/v1/providers/4812` crea una serie temporal nueva por cada
identificador que exista; es el fallo clásico de Prometheus. En los servicios la
plantilla sale de `req.route.path` (`/:id`); en el gateway no hay enrutador de
Express —todo pasa por un `app.use` que reenvía— así que la etiqueta sale de la
tabla de rutas, y lo que no esté en ella cae en `otra`.

### Quién puede leerlas

| Proceso | Puerto de métricas | Alcanzable desde |
|---|---|---|
| Los ocho microservicios | su propio puerto (3001-3007) | solo la red interna de Docker: ninguno publica su puerto |
| api-gateway | **9090**, que no se publica | solo la red interna |

El gateway es el único cuyo puerto está publicado, así que sirve sus métricas en
un puerto aparte en lugar de abrir una ruta en el 8080. Comprobado:
`curl http://127.0.0.1:8080/metrics` responde **404**. Por eso
`observabilidad/prometheus.yml` no necesita ningún secreto.

## 3. Los paneles

```bash
docker compose --profile observabilidad up -d
```

- **Prometheus**: http://127.0.0.1:9091 — 15 s de intervalo, 15 días de retención
- **Grafana**: http://127.0.0.1:3000 — usuario `admin`, contraseña en `GRAFANA_PASSWORD`

Los dos puertos se atan a `127.0.0.1`: un panel de métricas describe el sistema
por dentro y no tiene por qué escuchar en toda la red. Grafana arranca con el
registro de usuarios y el acceso anónimo **desactivados**.

El panel se provisiona desde archivos (`observabilidad/grafana/`), así que
editarlo en la interfaz **no sobrevive a un reinicio**. Es deliberado: el panel
es código. Tiene cinco gráficas: peticiones por segundo por servicio, P95 del
gateway por ruta —con el umbral de 300 ms marcado en rojo—, errores 5xx,
mensajes sin consumir por cola, y memoria residente.

Verificado el 4/10/2026: los **10 objetivos** de Prometheus en `up` (ocho
servicios, el gateway por su puerto 9090 y RabbitMQ), el panel provisionado con
UID `punto-amigo`, y su consulta devolviendo datos a través del origen de datos
de Grafana.

## 4. Carga: qué aguanta (AT-007)

```bash
docker compose -f docker-compose.yml -f docker-compose.carga.yml --profile apps up -d
npm run carga
```

El umbral no lo elige esta prueba: lo fija `11-quality/testing-strategy.md`
—**P95 < 300 ms y tasa de error < 1 %**— y está declarado como `thresholds` en
[k6/carga.js](../k6/carga.js), así que k6 devuelve un código distinto de cero
cuando no se cumple. La prueba falla sola, sin que nadie tenga que leer un
informe.

Perfil: **30 iteraciones por segundo** durante 60 s, tres peticiones de lectura
cada una (≈90 peticiones/s), contra el gateway y desde dentro de la red de
Docker, para que la medición no incluya el salto por el puerto publicado de
Docker Desktop.

| Medida | Umbral | Resultado 4/10/2026 |
|---|---|---|
| P95 de la petición | < 300 ms | **6,98 ms** |
| Tasa de error | < 1 % | **0 %** |
| Comprobaciones | — | 5.403 de 5.403 |
| Caudal sostenido | — | 89,9 peticiones/s |

Dos cosas que la prueba enseñó en sus dos primeras ejecuciones, y que valen más
que el número:

1. **Diez usuarios virtuales en bucle no son una carga, son un martillo.** La
   primera versión usaba `ramping-vus`, donde cada usuario lanza la siguiente
   petición en cuanto recibe la anterior: produjo 2.531 peticiones/s, el
   limitador devolvió 429 en el 99,81 % de 215.431 peticiones, y el P95 de 7 ms
   medía lo que tarda el sistema en decir «no». Un ritmo de llegadas fijo
   describe algo que se puede comparar entre ejecuciones.
2. **Un limitador por IP detrás de un proxy no limita por cliente, limita por
   proxy.** Con el límite del gateway ya elevado, la carga seguía recibiendo 429
   desde catalog-service: cada servicio interno aplica `RATE_LIMIT_MAX_PER_IP` y
   **ve siempre una sola IP**, la del gateway. Con 100 por minuto, el techo
   efectivo de todo el sistema eran 100 peticiones por minuto. Queda anotado
   como hallazgo **J-1** en [01-BACKLOG.md](01-BACKLOG.md); la superposición de
   carga los eleva en los siete servicios para poder medir.

El paso de escritura se queda fuera a propósito: publicar necesidades en bucle
llena la base y deja el entorno distinto al que empezó. Medir la latencia de
escritura con carga sostenida merece su propio escenario y su propia base
desechable.

## 5. Caducidad de los tokens (AT-006)

| Token | Variable | Valor | Dónde actúa |
|---|---|---|---|
| Access (JWT) | `JWT_ACCESS_TTL_SECONDS` | 900 s (15 min); el esquema limita el máximo a 900 | `JwtTokenService` |
| Refresco | `REFRESH_TOKEN_TTL_SECONDS` | 604.800 s (7 días) | cookie `httpOnly`, `SameSite=Strict` |
| Lista de denegación | **la del access token** | = `JWT_ACCESS_TTL_SECONDS` | `POST /api/v1/auth/logout` |
| Enlace de recuperación | `PASSWORD_RECOVERY_TTL_SECONDS` | 1.800 s (30 min), un solo uso | `PasswordRecovery` |

Los tres primeros valores ya existían; lo que faltaba era el cuarto punto de
AT-006, y ahí había un defecto real: la caducidad de la entrada en la lista de
denegación estaba escrita a mano en la ruta de cierre de sesión como
`900_000` ms. Con un TTL más corto la fila sobrevivía inútilmente al token; y si
alguien subía el TTL por encima de 15 minutos, **la entrada caducaba antes que
el token y el token cerrado volvía a servir**. Un literal que tiene que
coincidir con una variable de entorno acaba no coincidiendo.

Ahora sale de la configuración, y hay una prueba de integración que lo fija:
`auth-http.int.test.ts` corre con `JWT_ACCESS_TTL_SECONDS=300` —distinto del
valor por omisión a propósito, porque con 900 la versión con el literal pasaría
por coincidencia— y comprueba que la fila caduca cuando caducaba el token.
Verificado que falla con el código anterior: esperaba ≤ 301.000 ms y recibía
899.814 ms.

## 6. Lo que esto todavía no es

- **No hay alertas.** Hay paneles y hay métricas; nadie recibe un aviso. Las
  reglas de alerta necesitan un destino (correo, chat) y un turno de guardia, y
  las dos cosas son decisiones de operación, no de código.
- **No hay recolección centralizada de registros.** Cada proceso escribe JSON en
  su salida; quien los agregue —Loki, CloudWatch, lo que decida AT-001— se
  configura en el entorno, no aquí.
- **No hay trazas distribuidas.** El `correlation_id` permite reconstruir una
  operación a mano, con `grep`. Una traza con intervalos anidados es otra cosa y
  pide OpenTelemetry en los nueve procesos.
