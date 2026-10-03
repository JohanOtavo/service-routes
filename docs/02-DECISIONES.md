# Registro de decisiones

Las 13 decisiones pendientes de las Fases 1 a 3, resueltas. Es la última casilla de
la lista de salida de la [Fase 4](FASE-4-PLAN.md).

- Fecha de la sesión de decisión: **3 de octubre de 2026**
- Decide: Johan Otavo (propietario del producto)
- Origen de los pendientes: [01-BACKLOG.md](01-BACKLOG.md), grupos A, B y C

> **Qué es este documento y qué no es.** Aquí no se implementa nada. Cada pendiente
> recibe una de tres resoluciones —**cerrado**, **asignado a una fase** o
> **descartado**— y, cuando se descarta o se difiere, el motivo queda escrito. Es lo
> que la Definition of Done pide en §Validation Before Completion: una excepción se
> puede aceptar, pero no se puede dejar implícita.

---

## 1. Resumen

| # | Pendiente | Resolución | Fase destino |
|---|---|---|---|
| A-1 | Las semillas borran antes de insertar | Asignado | 5 |
| A-2 | Las réplicas no se pueden reconstruir | Asignado | 5 |
| A-3 | `statistics_snapshot` no tiene quien la escriba | Asignado | 5 |
| B-1 | El teléfono no llega al contacto tras el acuerdo | **Decidido**: sale del perfil de prestador | 6 |
| B-2 | Réplicas no reconstruibles | Duplicado de A-2 | 5 |
| B-3 | El seed recrea usuarios con identificadores nuevos | Duplicado de A-1 | 5 |
| B-4 | El SRS en inglés está desactualizado | Asignado | 9 |
| B-5 | Contratos OpenAPI duplicados | Asignado | 9 |
| B-6 | Fuera del alcance MVP: pagos, correo, push | **Decidido**: push descartado, correo solo transaccional | 6 (correo) |
| C-1 | Recuperación de contraseña sin interfaz | **Decidido**: se completa con el canal de correo transaccional | 6 |
| C-2 | Faltan los iconos del PWA | **CERRADO** · verificado el 3/10/2026 | — |
| C-3 | No hay pruebas de extremo a extremo | Asignado | 6 |
| C-4 | El teléfono sigue sin llegar | Duplicado de B-1 | 6 |

**Recuento:** 1 cerrado, 9 asignados a fase, 3 duplicados que se cierran con su
original. Ninguno queda sin resolución.

La **Fase 7 (notificaciones fuera del MVP) desaparece del plan de fases.** Lo único
que sobrevive de ella es el correo transaccional, que pasa a la Fase 6 porque la
recuperación de contraseña depende de él. Ver §4.

---

## 2. Decisiones de producto

### B-1 · El teléfono sale del perfil de prestador

**Decisión.** Opción (c) de `FASE-2-ENTREGA.md` §6.1, la que el documento recomendaba.

**Por qué.** El perfil de prestador es donde el oferente declara un teléfono
*precisamente para que le contacten*. Las otras dos opciones tienen el mismo defecto
por motivos distintos: el teléfono de la cuenta (opción a) se dio para administrar la
cuenta, no para publicarlo a una contraparte, y un campo dedicado (opción b) resuelve
la privacidad pero añade una migración y una pantalla nueva para un dato que ya existe
en el sitio correcto.

**Cierra cuando.** La pantalla de detalle de contratación muestra el teléfono del
perfil de prestador tras la adjudicación, y solo a las dos partes de esa solicitud.
Con prueba que verifique también el caso negativo: un tercero no lo ve.

**Fase destino.** 6. Cierra B-1 y C-4 a la vez.

**Lo que esta decisión obliga a comprobar.** El teléfono es un dato personal. Que la
política de conservación y anonimización no exista (bloqueante de producción según el
SRS) no impide implementar esto, pero sí obliga a que la Fase 5 la escriba antes de
la Fase 10.

### B-6 · Push descartado; correo solo transaccional

**Decisión, en cinco partes.**

| Canal | Resolución | Motivo |
|---|---|---|
| **Push** | **Descartado** | La bandeja intraaplicación cubre el MVP. Exige service worker, permisos del navegador, un proveedor y preferencias por canal: trabajo real para un valor que el MVP no necesita. Se reabre si el producto lo pide. |
| **Correo de producto** (avisos, propuestas, adjudicaciones) | **Descartado** | Mismo motivo. La bandeja ya los entrega. |
| **Correo transaccional** (recuperación de contraseña) | **Entra, en Fase 6** | No es una mejora: sin él, C-1 es imposible. Ver §4. |
| **Pagos** | Fuera de alcance, sin cambio | Ya excluido en `01-context/scope.md` §Out of Scope. No es una decisión nueva. |
| **`statistics_snapshot`** | Entra, en Fase 5 | Es A-3. Estaba mal agrupado aquí: no es un canal de notificación. |

**Consecuencia sobre el plan de fases.** La Fase 7 se elimina. El grafo de
dependencias de `00-FLUJO-DEL-PROYECTO.md` §6 pasa de `Fase 6 → Fase 7 → Fase 8` a
`Fase 6 → Fase 8`.

---

## 3. Cobertura: el trinquete se queda donde está

**Decisión.** El umbral de `jest.config.js` permanece en 65/52/64/67, un punto por
debajo de lo medido (66.04 % sentencias, 53.79 % ramas, 65.27 % funciones, 68.03 %
líneas). No se sube al 80/80/80/75 ahora, ni se añade el override de `src/domain/`
a 90/85.

**Por qué.** Subir al 80 % son unos 14 puntos de sentencias y 20 de ramas,
concentrados en los repositorios de persistencia. Es trabajo de varios días de
pruebas, no un ajuste de configuración, y haría que la Fase 5 empezara con una puerta
roja. El trinquete ya cumple el mecanismo que la estrategia pide —si un cambio baja
la cobertura, CI falla—; lo que no cumple es la cifra.

**Lo que esto deja abierto, y conviene no maquillarlo.** Dos de las tres
discrepancias que `FASE-4-PLAN.md` §5 se proponía cerrar en esta fase **no se
cierran**:

1. `branches` global está en 52 %; la estrategia exige 75 %
2. No existe el override de `./src/domain/` a 90/85

Siguen anotadas como G-3 en el backlog. La Fase 4 se cierra con esa deuda explícita,
no con la discrepancia resuelta. La tercera discrepancia —E2E y k6 inexistentes— ya
estaba asignada a las Fases 6 y 8.

---

## 4. El hallazgo que cambió una decisión

B-6 se decidió primero como «descartar correo y push». Al ir a registrar C-1 con esa
decisión aplicada, el pendiente no se podía cerrar de ninguna forma. El motivo está
en el código, no en los documentos.

**La recuperación de contraseña hoy genera un token y lo tira.**

1. `PasswordRecovery.solicitar()` crea el token, invalida los anteriores y lo mete en
   un evento `UserProfileUpdated` con `accion: 'RECUPERACION_SOLICITADA'` —
   `services/auth-service/src/application/use-cases/PasswordRecovery.ts:66`
2. El relevo del outbox lo publica al broker, correctamente
3. **Nadie lo consume.** `notification-service/src/main.ts` registra 11 manejadores y
   `UserProfileUpdated` no está entre ellos
4. El consumidor hace `ack` de un evento sin manejador, por diseño y con razón:
   «Suscrito por patron a un evento sin manejador: no es un error, solo no interesa»

El comentario que acompaña al paso 1 dice «El token viaja en el evento para que
notification-service lo envie». Ese consumidor nunca se escribió. El token se genera,
se guarda en `password_recovery_token`, se publica y se descarta en silencio.

`/restablecer` lee el token de la URL —eso se corrigió en la Fase 4, antes estaba
escrito a mano en una constante— pero nada envía nunca esa URL a nadie.

**Por qué la bandeja intraaplicación no lo arregla.** Quien olvidó la contraseña no
puede iniciar sesión, y sin sesión no puede abrir la bandeja. Es circular. Un canal
de recuperación tiene que funcionar **sin sesión**, y hoy el único que cumple eso es
el correo.

**Decisión revisada.** Entra el correo, con el alcance mínimo: solo transaccional.
Un consumidor de `UserProfileUpdated` con `accion: 'RECUPERACION_SOLICITADA'` que
envíe el enlace. Nada de avisos de producto por correo, nada de push.

**Cierra cuando.** El recorrido completo pasa en una prueba: pedir recuperación →
llegar el correo → abrir el enlace → restablecer → entrar con la contraseña nueva.

**Lo que hay que respetar al implementarlo.** El evento es el único del sistema que
transporta un secreto. Su consumidor debe seguir siendo único, el token no puede
acabar en un log, y el cuerpo del correo no puede confirmar si la cuenta existe —el
endpoint ya devuelve 202 siempre justo para no convertirse en un verificador de
correos registrados, y el correo no debe deshacer esa precaución.

---

## 5. Pendientes cerrados en esta sesión

### C-2 · Iconos del PWA — **CERRADO**

Criterio de cierre: «`icono-192.png`, `icono-512.png` y `icono.svg` existen, están
declarados en el manifiesto y se ven bien en pantalla de inicio.»

Verificado el 3/10/2026:

| Comprobación | Resultado |
|---|---|
| `icono-192.png` existe y mide 192×192 | sí |
| `icono-512.png` existe y mide 512×512 | sí |
| `icono-maskable-512.png` existe y mide 512×512, `purpose: maskable` | sí |
| `icono.svg` existe | sí |
| `manifest.webmanifest` declara los cuatro | sí |
| `index.html` enlaza el manifiesto y el `apple-touch-icon` | sí, líneas 18-19 |

Las dimensiones se midieron con `sharp`, no se dedujeron del nombre del archivo. Esa
distinción importa: el bug que la Fase 4 encontró aquí era exactamente que
`icono-192.png` e `icono-512.png` eran byte a byte idénticos porque el generador
declaraba el tamaño y no lo usaba al rasterizar. Ahora son distintos.

**La única parte del criterio que no se verifica automáticamente** es «se ven bien en
pantalla de inicio»: requiere instalar la PWA en un dispositivo. Queda como
comprobación manual dentro del E2E de la Fase 6 (C-3), no como pendiente abierto.

---

## 6. Pendientes asignados sin decisión de producto

Los nueve que no necesitaban una decisión, con su fase. Su criterio de cierre no
cambia: está en [01-BACKLOG.md](01-BACKLOG.md).

### A la Fase 5 — Datos y operación

| ID | Pendiente | Por qué va primero |
|---|---|---|
| A-1 · B-3 | Semillas idempotentes | Hoy cada `docker compose up` destruye estado y deja huérfanos los perfiles derivados. Sin esto, el E2E de la Fase 6 no se puede ejecutar de forma fiable. |
| A-2 · B-2 | Re-emisión de réplicas | Sin un comando de re-emisión, perder `outbox_event` deja el catálogo sin prestadores y sin forma de recuperarlo. Es prerrequisito de AT-004. |
| A-3 | Escritor de `statistics_snapshot` | La tabla existe, `admin-reporting-service` la lee, nadie la calcula. Los reportes del módulo 13 del SRS salen vacíos. |

Nota técnica verificada en esta sesión, para que la Fase 5 no empiece desde cero:
**A-2 no exige tocar los consumidores.** `KnexPrestadorRefRepository.upsert()` ya es
un `INSERT ... ON DUPLICATE KEY UPDATE` con la guarda `synced_at <= VALUES(synced_at)`
incrustada, así que resiste el desorden. Una re-emisión que emita `event_id` nuevos
desde el estado actual converge sin cambios en el lado que consume. Los `event_id`
tienen que ser nuevos, no reutilizados: `processed_event` descartaría los viejos por
clave duplicada y la reconstrucción no haría nada.

### A la Fase 6 — Experiencia del cliente

| ID | Pendiente |
|---|---|
| B-1 · C-4 | Teléfono desde el perfil de prestador (§2) |
| C-1 | Recuperación de contraseña, con el correo transaccional (§4) |
| C-3 | E2E del recorrido: publicar necesidad → propuestas → adjudicar → cancelar |

### A la Fase 9 — Documentación y trazabilidad

| ID | Pendiente |
|---|---|
| B-4 | El SRS en inglés sigue diciendo que los microservicios no están adoptados, y pide tres ADRs que están aceptados desde el 30/09/2026 |
| B-5 | Dos juegos de contratos OpenAPI; los de `friend-point-docs/07-api/` son los viejos |

La Fase 9 puede ir en paralelo desde ya. No bloquea a nadie, y es la que más riesgo
tiene de olvidarse.

---

## 7. Lo que sigue abierto y no es parte de estas 13

Para que el cierre de la Fase 4 no se lea como «ya no queda nada que decidir».

### Decisiones que siguen sin respuesta

| Origen | Decisión | Bloquea |
|---|---|---|
| `00-FLUJO-DEL-PROYECTO.md` §11.5 | **Revisión por Pull Request.** La Definition of Done la exige y ninguna fase la cumple. Hay que revisar por PR a partir de ahora, o excluir explícitamente este proyecto de ese requisito | El DoD completo, Fase 10 |
| AT-001 | Configuración final de AWS o GCP | Fase 8 |
| AT-003 | Organización de los repositorios: ¿se fusionan `friend-point-docs` y `friend-point-development`? | Fase 9 |
| AT-006 | Valores de expiración de JWT | Fase 8 |

### Bloqueantes duros que no son decisiones, son trabajo

- **Política de conservación y anonimización de datos personales.** El SRS la marca
  como bloqueante de producción. No existe. La decisión B-1 añade un teléfono a una
  vista, lo que la hace más urgente, no menos.
- **AT-004, procedimiento de restauración de respaldos.** El único ítem de severidad
  `High` del proyecto. `backup_record.restauracion_probada_at` siempre vale NULL.
- **Los 20 ítems de los grupos E y F** del backlog: preguntas abiertas O-01..O-12 y
  brechas de trazabilidad GAP-001..GAP-008. O-11 es una línea: el readme de
  `auth-service` declara puerto 8081 y PostgreSQL donde el SRS y el código dicen 3001
  y MySQL.

---

## 8. Efecto sobre los demás documentos

| Documento | Qué cambia |
|---|---|
| [FASE-4-PLAN.md](FASE-4-PLAN.md) | Última casilla de la lista de salida marcada. §5 corregido: dos de las tres discrepancias no se cierran, se difieren con motivo |
| [00-FLUJO-DEL-PROYECTO.md](00-FLUJO-DEL-PROYECTO.md) | Fase 4 completada. Fase 7 eliminada; el correo transaccional pasa a la Fase 6. Decisiones 1, 2 y 3 de §11 resueltas |
| [01-BACKLOG.md](01-BACKLOG.md) | C-2 cerrado. B-1, B-6 y C-1 con su decisión registrada y enlace a este documento |
| [README.md](README.md) | Este documento añadido al índice |
