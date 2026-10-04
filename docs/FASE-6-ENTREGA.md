# Fase 6 — Experiencia del cliente

**Estado: completada.** 3 de octubre de 2026.

Los tres elementos que la Fase 4 asignó a esta fase están cerrados, y los tres
resultaron ser distintos de lo que su enunciado decía.

---

## 1. Lista de salida

| # | Elemento | Estado | Evidencia |
|---|---|---|---|
| B-1 · C-4 | Teléfono desde el perfil de prestador | **Cerrado** | 5 pruebas de integración + aserción en el E2E |
| C-1 | Recuperación de contraseña de extremo a extremo | **Cerrado** | 13 unitarias + recorrido en navegador |
| C-3 | E2E del recorrido crítico | **Cerrado** | 4 pruebas Playwright, job de CI propio |

Gate al cierre: `format:check`, `lint`, `typecheck`, `audit` en verde; **207
unitarias**, **151 de integración**, **4 E2E** en navegador real.

---

## 2. B-1 — No faltaba el teléfono: estaba roto

El enunciado decía «el teléfono no llega al contacto tras el acuerdo». Lo que
había era peor y más silencioso: **el endpoint ya devolvía `contacto.telefono` y
`Contratacion.tsx` ya lo pintaba** como enlace `tel:`, con un texto de reserva
para cuando no hubiera. Leía `usuario_ref.telefono`, columna que **nunca se
rellena** porque `UserRegistered` no transporta el teléfono —su emisor lo dice
explícitamente—. El campo ha salido `null` desde la Fase 3 y el cliente mostraba
el texto de reserva, sin que nada fallara nunca.

`pa_request` tampoco tenía forma de conocer el dato real: su réplica no copiaba
la columna y ninguno de los cuatro eventos de perfil la llevaba. Esta fase abre
ese camino completo —migración, los dos eventos, consumidor, réplica, lectura y
`db/reemit.js`—.

**Ausente y null no son lo mismo** en ese camino, y mantenerlos distintos
importa: ausente significa que el evento no habla del teléfono
(`ProviderStatusChanged` solo trae el estado) y se conserva el replicado; null
explícito significa que el oferente lo borró de su perfil y hay que borrarlo
aquí también. Colapsarlos borraría el teléfono en cada cambio de estado, o haría
que borrarlo del perfil no surtiera efecto. `??` no sabe expresar eso.

**El teléfono solo viaja en un sentido, y eso es la decisión.** Cuando la
contraparte es el prestador, sale de su perfil. Un solicitante no tiene perfil,
así que no existe ningún campo donde haya declarado un número para ser
contactado: el oferente recibe su nombre y su correo, no un teléfono. Revelar el
de la cuenta sería la opción (a), descartada.

`catalog-service` consume los mismos eventos y **no** guarda la columna a
propósito: su vista de prestador es pública.

---

## 3. C-1 — El token se generaba y se tiraba

`auth-service` creaba el token, lo metía en un evento `UserProfileUpdated` con
`accion: 'RECUPERACION_SOLICITADA'`, y el relevo lo publicaba a una cola que
notification-service **ya escuchaba** —`iam.usuario.user_profile_updated` encaja
con su patrón `iam.#`—. No había manejador, así que el consumidor hacía `ack` y
lo descartaba. El token se generaba, se guardaba, se publicaba y se perdía, sin
error y sin rastro. `/restablecer` existía y leía el token de la URL; nada
enviaba nunca esa URL.

La bandeja intraaplicación no podía arreglarlo, y por eso hubo que revisar la
decisión del 3/10 de descartar el correo: quien olvidó su contraseña no puede
iniciar sesión para leer una bandeja.

El registro del manejador se extrajo a `registrarCorreoDeRecuperacion` en lugar
de dejarlo en línea dentro de `main()`, y eso es el fondo del asunto: **el
defecto ERA un registro que no existía**, y un registro dentro de `main()` no se
puede probar. Tres de las trece pruebas lo cubren.

Decisiones de seguridad que conviene no perder:

- **El token nunca llega al registro.** Es el único evento del sistema que
  transporta un secreto. La línea que se registra lleva solo el `userId`.
- **El cuerpo no confirma que la cuenta existe.** El endpoint responde 202
  siempre para no ser un verificador de correos registrados, y el correo no
  puede deshacerlo.
- **Un fallo de envío se propaga.** Tragarlo confirmaría el evento sin haber
  enviado nada, y quien pidió recuperar su contraseña esperaría para siempre.
- **En producción el arranque se niega sin `SMTP_HOST`.** El enviador de reserva
  escribe el enlace —token incluido— en el registro del servidor, y la
  recuperación no funcionaría para nadie. `assertProductionSafety` no cubre
  esto: no conoce la configuración de correo.

`nodemailer` está fijado a `^10.0.14` y no a `^7`: la línea 7 arrastra **trece
avisos de seguridad**, entre ellos inyección de comandos SMTP por CRLF y
validación de certificado TLS incorrecta al pedir un token OAuth2.

---

## 4. C-3 — El recorrido crítico, en un navegador

Cuatro pruebas Playwright en `e2e/`, con su propio job de CI. **No forman parte
de `npm run verify`**: la puerta de cada commit no puede depender de construir
ocho imágenes, así que `verify` sigue siendo ejecutable en cualquier máquina con
Docker y el E2E se pide aparte.

- **El recorrido de negocio**: publicar una necesidad, que el oferente la
  encuentre y proponga, adjudicar, ver el contacto —con la aserción del teléfono
  de B-1— y cancelar.
- **La recuperación de contraseña**: pedir el enlace, abrirlo, cambiar la
  contraseña y entrar con la nueva; un enlace sin token que no ofrece
  formulario; y un token que no sirve dos veces.

El recorrido cruza **dos roles**, así que usa dos contextos de navegador: el
token de sesión vive en memoria del módulo y compartir pestaña mezclaría las
sesiones.

La precondición —un perfil de prestador activo y replicado— se prepara sembrando
`pa_provider` y propagándolo con `npm run db:reemit`, el comando de A-2, en lugar
de conducir las pantallas de administración: validar un perfil es otro recorrido
con otro rol, y meterlo aquí probaría dos cosas a la vez. Como efecto
secundario, cada ejecución comprueba que la re-emisión funciona contra la pila
completa.

---

## 5. El defecto que encontró el E2E

Es la razón por la que C-3 existe, y apareció en la primera ejecución.

**Recargar cualquier pantalla dejaba al usuario sin roles.**

El cliente guarda el token de acceso **solo en memoria**, por decisión
documentada. En una carga en frío —una recarga, o abrir un enlace directo— no
hay sesión previa, así que la sesión se reconstruye únicamente con la respuesta
de `/auth/refresh`. Esa respuesta **no devolvía el usuario**, y el cliente
resolvía la falta con `?? { id: 0, nombre: '', roles: [] }`: una sesión que
parece válida, con cero roles y un identificador que no existe.

El resultado era que toda pantalla con rol respondía «Esta pantalla no es para
su perfil» después de una recarga. Ninguna prueba lo veía: las de cliente montan
los componentes con la sesión ya puesta en memoria, y ninguna hacía una carga en
frío con solo la cookie de refresco.

Corregido por los dos lados. `/auth/refresh` devuelve el usuario —el caso de uso
**ya lo cargaba** para comprobar que la cuenta sigue activa; solo faltaba
devolverlo— y el cliente deja de inventar una sesión vacía: si no llega el
usuario por ninguna vía, la recuperación falla. Con una prueba de integración de
regresión que afirma que `id > 0` y que los roles no están vacíos, porque ese
estado exacto es el que rompía el cliente.

---

## 6. Lo que las E2E destaparon de sí mismas

Tres defectos míos, no del producto, y los tres del mismo tipo: una comprobación
que parecía funcionar.

1. **`docker logs` escribe en stderr.** El ayudante leía el enlace del correo
   con `execFileSync`, que devuelve solo stdout, así que leía cero bytes
   mientras tres enlaces estaban en el registro. El `catch` se tragaba todo por
   igual y el mensaje decía que el correo no había llegado en 30 s. Había
   llegado tres veces. Ahora se leen los dos flujos y un error de lectura se
   distingue de «todavía no hay enlace».
2. **Una clase negada voraz no encontraba el enlace.** Está dentro de una línea
   JSON con los saltos escapados, así que el texto crudo lleva barras
   invertidas; `\S+?` perezoso se detiene en el primer `/restablecer?token=`.
3. **La prueba agotaba su propio limitador.** Restaurar la contraseña por la
   interfaz costaba una recuperación más por caso. Ahora se restaura con la
   semilla, cuyo refresco idempotente de A-1 es justo la herramienta adecuada, y
   los limitadores se elevan **solo para la pila de prueba** con
   `docker-compose.e2e.yml`.

El fichero de superposición existe en lugar de tocar el bloque `environment:` de
cada servicio porque ese bloque **ensombrece** el `env_file`: meterlo ahí habría
hecho que cambiar el valor en el `.env` dejara de surtir efecto para todo el
mundo.

Dos piezas más de fontanería que no son accesorias:

- **La base de Playwright es `localhost`, no `127.0.0.1`.** Vite se ata a
  `localhost` y en Windows ese nombre resuelve primero a `::1`, así que la
  comprobación de arranque no encontraba nada y abortaba a los 120 s mientras el
  servidor llevaba 371 ms listo.
- **`e2e/` no lo comprobaba nadie.** El `tsconfig` de la raíz es una *solution*
  con `files: []`, así que ni las pruebas ni `playwright.config.ts` entraban en
  `tsc --build`. Un error de tipos ahí habría llegado a CI sin que ninguna
  puerta lo viera, precisamente porque el E2E no está en `verify`. Ahora hay un
  `e2e/tsconfig.json` y `typecheck` lo cubre.

---

## 7. Fuera de alcance

- **El mensaje de resultado de la cancelación no se ve.** `Contratacion.tsx`
  desmonta `<Cancelar>` al pasar a `CANCELADA`, así que la explicación de si la
  cancelación cuenta en la tasa y con qué peso desaparece antes de que nadie la
  lea. Es trabajo de interfaz; anotado en el backlog.
- **Un buzón SMTP de verdad para las E2E.** Hoy el enlace se lee del registro de
  `notification-service`, que es el camino de desarrollo real. Un contenedor SMTP
  sería más fiel y es mejora de la Fase 8.
- **Las seis decisiones de la política de datos personales**, que siguen
  bloqueando producción y no son de esta fase.
