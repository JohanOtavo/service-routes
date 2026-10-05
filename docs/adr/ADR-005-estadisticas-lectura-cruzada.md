# ADR-005 · Lectura de otros esquemas para el cálculo de estadísticas

- **Estado:** aceptada
- **Fecha:** 4 de octubre de 2026
- **SRS afectado:** RF108 (relajado), RNF28 (se mantiene, con excepción acotada)
- **Código:** `db/init/01-schemas-and-users.sh`,
  `services/admin-reporting-service/src/application/use-cases/CalculateStatistics.ts`

## Contexto

`admin-reporting-service` informaba de series precalculadas: leía
`pa_admin.statistics_snapshot` y no la escribía nadie. Los reportes salían vacíos
(A-3 del backlog).

El SRS lo resolvía de una forma elegante: **RF108** dice que este servicio no
consulta la base de datos de ningún otro. Lo que no llegue por un evento y no esté
en `pa_admin` sencillamente no se puede informar. El servicio cumple hoy esa regla
—solo consume `iam.#` y `provider.#`— y por eso la tabla existe sin alimentarse.

El problema es que los eventos que este servicio recibe no llevan lo que las
métricas del SRS necesitan. Necesidades publicadas, propuestas, cobertura y
valoraciones viven en `pa_request`, `pa_catalog` y `pa_rating`, y ninguno publica
eventos a este servicio. Con RF108 intacto, la vía correcta —ampliar las
suscripciones— exige que `admin` se suscriba a un volumen alto de eventos de otros
servicios, y para algo que es una agregación, no una reacción a un evento. El
coste es alto: contadores incrementales que hay que mantener coherentes, ratios que
dependen de denominadores y que se degradan en silencio si un evento se pierde, y
un acoplamiento a eventos que existen para otros consumidores.

## Decisión

**Se relaja RF108 para `admin-reporting-service`, con lectura de solo `SELECT` a
nivel de tabla y con la lista de tablas cerrada y justificada una por una.**

El acceso que se concede:

| Tabla | Para qué métrica |
|---|---|
| `pa_request.necesidad` | necesidades publicadas por día y por estado |
| `pa_request.propuesta` | propuestas enviadas por día |
| `pa_catalog.prestador_ref` | prestadores por estado |
| `pa_catalog.servicio` | servicios publicados por estado |
| `pa_rating.calificacion` | valoración media diaria |

Nada más. Ninguna escritura, ninguna clave foránea cruzada, ningún privilegio a
nivel de esquema.

### Por qué el grant es a nivel de tabla y no de esquema

La verificación de aislamiento de `db/init/01-schemas-and-users.sh` comprueba
`information_schema.SCHEMA_PRIVILEGES`, que solo registra los privilegios de nivel
esquema. Un `GRANT SELECT` sobre tablas concretas vive en `TABLE_PRIVILEGES` y no
aparece ahí.

Eso significa que RNF28 no se debilita: cualquier `GRANT` accidental sobre un
esquema entero —el error grave — sigue haciendo fallar el arranque igual que antes.
Aun así, la verificación se **extiende** para comprobar que los privilegios de tabla
cruzados que existen son exactamente los cinco aprobados y ningún otro. Sin esa
extensión, la excepción sería invisible para el gate, y un gate que no ve una
excepción deja de ser un gate.

## Consecuencias

**A favor.** Las métricas se calculan con agregaciones SQL sobre el dato real, que
es lo que hace un módulo de reportes; no hay contadores que puedan derivar. Un
ratio como la tasa de cobertura tiene denominador exacto el día que se calcula. La
tabla por esquema se mantiene como propiedad de datos: los servicios siguen siendo
dueños de sus datos y solo un lector los consulta.

**En contra, y conviene no disimularlo.**

- `admin-reporting-service` deja de cumplir RF108 tal como estaba escrito. Es una
  excepción consciente, con fecha y con motivo, no un descuido.
- El servicio depende de la **forma** de tablas que no son suyas. Si
  `pa_request.necesidad` cambia de columnas, las métricas se rompen; el acoplamiento
  es de esquema, no de datos.
- La verificación de aislamiento pasa a tener una lista de excepciones que
  actualizar. Una excepción documentada y vigilada sigue siendo mejor que una
  prohibición que obliga a no informar.

**Neutral.** La copia de seguridad y el resto de operaciones de `pa_admin` no se
tocan: siguen sin salir del esquema.

## Alternativas descartadas

**Ampliar las suscripciones de eventos.** Cumple RF108 sin tocarlo. Se descartó
porque convierte una agregación en un flujo de eventos que hay que mantener, con
contadores que se desincronizan en silencio cuando un evento se pierde o se
reintenta. Un reporte que sale mal por un evento perdido hace menos falta que un
reporte que sale de una consulta.

**Limitar las estadísticas a lo que ya está en `pa_admin`.** Es la lectura más
fiel de RF108: solo cuentas suspendidas, cambios de rol y estado de prestadores.
Se descartó porque no cubre las métricas que el SRS pide —necesidades publicadas,
cobertura— y porque el módulo de reportes es explícito del alcance MVP. Habría
dejado A-3 cerrada en apariencia y vacía en contenido.

**Crear vistas en `pa_admin` alimentadas por un proceso.** Una vista no evita el
`GRANT`: necesita que su definidor tenga acceso a la tabla base. Habría movido el
problema sin resolverlo y añad una dependencia de orden de despliegue.

**Conceder el privilegio a nivel de esquema completo.** Más simple de escribir y de
entender. Se descartó porque convertiría una excepción de cinco tablas en una
excepción de tres esquemas, y porque haría fallar el gate de aislamiento, que es
justo la señal que este ADR pretende no silenciar.