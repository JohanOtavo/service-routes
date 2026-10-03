# Política de conservación y anonimización de datos personales

**Borrador para aprobación.** El SRS marca esta política como **bloqueante del
despliegue en producción**, y hasta hoy no existía en ningún sitio.

- Fecha del borrador: 3 de octubre de 2026
- Estado: **pendiente de tus decisiones** — §4 las enumera
- Elemento del backlog: Fase 5, «Política de conservación y anonimización»

> **Qué hace falta leer de este documento.** Las secciones 1 a 3 son un
> inventario: qué datos personales guarda el sistema, dónde están y qué ya hace
> el código con ellos. Eso es verificable y no necesita aprobación. La §4 son
> **seis decisiones que no puedo tomar**: los plazos de conservación y el
> alcance del borrado son una obligación legal y una decisión de producto, no
> una elección técnica.

---

## 1. Inventario: dónde viven los datos personales

Verificado contra las migraciones, no deducido del modelo conceptual.

### Datos identificativos

| Dato | Dónde | Notas |
|---|---|---|
| Nombre | `pa_auth.usuario.nombre` | Fuente de verdad |
| Correo | `pa_auth.usuario.correo` | Único; es el identificador de acceso |
| Teléfono | `pa_auth.usuario.telefono` | Opcional |
| Contraseña | `pa_auth.usuario.contrasena_hash` | Argon2id. **No es recuperable**, y por tanto no es un dato que haya que anonimizar: hay que borrarlo |
| Motivo de suspensión | `pa_auth.usuario.motivo_suspension` | Texto libre escrito por un administrador: puede contener datos de terceros |
| Último acceso | `pa_auth.usuario.ultimo_acceso_at` | Dato de comportamiento |

### Perfil de prestador

| Dato | Dónde |
|---|---|
| Nombre, especialidad, experiencia | `pa_provider.prestador` |
| **Teléfono y correo de contacto** | `pa_provider.prestador.telefono`, `.correo` |
| Disponibilidad | `pa_provider.prestador.disponibilidad` |

El teléfono de esta tabla es el que la **decisión B-1** del 3/10/2026 va a
mostrar a la contraparte tras una adjudicación. Eso no lo convierte en público:
lo hace visible a una persona concreta en un momento concreto, y esta política
tiene que decir qué pasa con él después.

### Réplicas en otros esquemas

Las tablas `usuario_ref` copian datos personales a otros esquemas. **Hay una
diferencia importante entre ellas:**

| Esquema | Columnas de la réplica | Contacto replicado |
|---|---|---|
| `pa_request` | id, nombre, correo, telefono, estado | **sí** |
| `pa_provider` | id, nombre, correo, telefono, estado | la tabla existe y **nadie la escribe** |
| `pa_rating` | id, nombre, correo, telefono, estado | la tabla existe y **nadie la escribe** |
| `pa_notification` | id, nombre, estado (+ especialidad) | **no**: el repositorio fuerza `correo` y `telefono` a `null` |

`pa_notification` es el ejemplo de lo que esta política debería generalizar: solo
replica lo que necesita. `pa_request` replica el correo y el teléfono, y habría
que justificar para qué los usa o dejar de replicarlos.

Las dos réplicas sin escritor —`pa_provider` y `pa_rating`— son un hallazgo de
esta fase y no estaban en el backlog: hoy están vacías, así que no son una fuga,
pero son dos copias de datos personales que alguien declaró y nadie mantiene.

### Datos de seguridad y trazabilidad

| Dato | Dónde | Por qué es sensible |
|---|---|---|
| **IP de origen** | `pa_auth.refresh_session.ip_origen`, `pa_auth.login_attempt.ip_origen`, `pa_admin.audit_record.ip_origen` | Una IP es un dato personal cuando se puede asociar a una persona, y aquí se puede |
| **User agent** | `pa_auth.refresh_session.user_agent`, `pa_auth.login_attempt.user_agent` | Permite perfilar dispositivo |
| **Correo teclado en un intento fallido** | `pa_auth.login_attempt.correo_intentado` | Se guarda tal como se escribió, **incluso si la cuenta no existe**: puede contener el correo de alguien que no es usuario |
| Actor y detalle de auditoría | `pa_admin.audit_record.id_actor`, `.detalle` | `detalle` es JSON libre. El comentario de la migración ya avisa: «Nunca contrasenas, tokens ni datos personales de mas» |

---

## 2. Lo que el código ya hace bien

No hay que inventar estas reglas: ya están implementadas y la política solo
tiene que recogerlas.

- **La contraseña nunca se guarda en claro.** Argon2id, y ninguna prueba ni
  semilla versiona un hash.
- **El token de recuperación es el único evento que transporta un secreto**, y
  su consumidor es único a propósito: no se replica a los modelos de lectura.
- **`audit_record` es inmutable.** Dos disparadores rechazan `UPDATE` y
  `DELETE`. Esto es una garantía de trazabilidad **y un problema para esta
  política**: ver §4.5.
- **El borrado lógico existe** (`deleted_at`) en las tablas de negocio, así que
  hay dónde apoyar una anonimización que conserve la integridad referencial.
- **`pa_notification` no replica datos de contacto**, por decisión explícita del
  repositorio.
- **La respuesta de recuperación de contraseña no revela si el correo existe**
  (202 siempre), para no convertirse en un verificador de cuentas registradas.

---

## 3. Lo que hoy NO existe

| Falta | Consecuencia |
|---|---|
| Plazo de conservación de cualquier dato | Nada se borra nunca; todo crece sin límite |
| Proceso de purga | `login_attempt` y `refresh_session` acumulan IP y user agent indefinidamente |
| Procedimiento de borrado a petición | No hay forma de atender una solicitud de supresión |
| Anonimización | Un usuario borrado se llevaría por delante sus calificaciones y su historial de solicitudes |
| Conservación de los respaldos | Un volcado de `pa_auth` lleva nombres, correos y teléfonos **sin cifrar**. Ver [03-RUNBOOK-RESPALDOS.md](03-RUNBOOK-RESPALDOS.md) §5 |
| Purga de `processed_event` | La tabla tiene un índice llamado `idx_processed_purga` para una purga **que no existe en el código** |

---

## 4. Las seis decisiones que necesito

Cada una lleva una recomendación. Ninguna se puede resolver escribiendo código.

### 4.1 · Plazo de conservación de los datos de seguridad

`login_attempt` y `refresh_session` guardan IP y user agent de cada intento.

**Recomendación: 90 días**, y después borrado físico. Es tiempo suficiente para
investigar un incidente y mucho menos de lo que pide cualquier plazo contable.
`login_attempt` necesita además una excepción corta: el bloqueo progresivo solo
mira los fallos recientes, así que su purga puede ser más agresiva.

### 4.2 · Plazo de conservación de la auditoría

`audit_record` crece sin límite y es la tabla que más crecerá del proyecto.

**Recomendación: 2 años.** Pero ojo con §4.5: la tabla es inmutable por
disparador, así que «purgar» exige decidir cómo.

### 4.3 · Qué pasa con el correo de alguien que no es usuario

`login_attempt.correo_intentado` guarda lo que se tecleó. Si alguien se equivoca
y escribe el correo de otra persona, ese correo queda registrado sin que su
titular sea usuario de la plataforma ni haya consentido nada.

**Recomendación: guardar un hash del correo en lugar del texto.** El bloqueo
progresivo solo necesita comparar igualdad, y con un hash sigue funcionando.
Implica una migración y tocar el cálculo del bloqueo.

### 4.4 · Borrado frente a anonimización

Un usuario pide que se borren sus datos. Sus calificaciones son parte de la
reputación de otras personas, y sus solicitudes son el historial de un
prestador.

**Recomendación: anonimizar, no borrar.** Sustituir nombre, correo y teléfono
por valores sin información, conservar el `id_usuario` y marcar la cuenta.
Así la reputación de la contraparte no se altera y la integridad referencial no
se rompe. Hay que decidir **qué se le dice a quien lo solicita**, porque
«anonimizado» no es «borrado».

### 4.5 · Cómo se purga una tabla inmutable

`audit_record` rechaza `UPDATE` y `DELETE` por disparador, y eso es deliberado:
una auditoría que se puede editar no es una auditoría.

Tres salidas, y hay que elegir una:

- **(a)** Un procedimiento con privilegio elevado que desactive el disparador,
  purgue y lo reactive. Es un agujero: ese privilegio permite también reescribir
  la auditoría.
- **(b) Recomendada** — particionar por fecha y eliminar particiones completas.
  `DROP PARTITION` no es un `DELETE`, así que el disparador no se opone y la
  inmutabilidad fila a fila se mantiene intacta.
- **(c)** No purgar nunca y aceptar el crecimiento. Honesto, pero incompatible
  con cualquier plazo de conservación.

### 4.6 · Conservación y cifrado de los respaldos

Los volcados contienen datos personales en claro, y hoy viven en el disco de la
misma máquina que la base de datos.

**Recomendación: 35 días de conservación y cifrado en reposo.** Hay que decidir
además qué se hace con los datos de alguien que pidió su supresión y sigue
dentro de un volcado anterior a la petición: la respuesta habitual es que el
plazo de conservación del respaldo es el límite, y eso hay que poder explicarlo.

---

## 5. Qué desbloquea cada decisión

| Decisión | Desbloquea |
|---|---|
| 4.1, 4.2, 4.5 | El proceso de purga; cierra la deuda del índice `idx_processed_purga` |
| 4.3 | La migración de `login_attempt` |
| 4.4 | El procedimiento de supresión, sin el cual no se puede atender una petición |
| 4.6 | El cifrado de respaldos de la Fase 8, y el runbook en producción |
| **Todas** | El Go/No-Go de la Fase 10. El SRS la marca bloqueante y la Definition of Done prohíbe usar una excepción para ignorar un criterio crítico |

---

## 6. Lo que este documento NO es

No es un documento de cumplimiento legal. Es el inventario técnico y el conjunto
de decisiones que alguien con criterio legal necesita para redactar uno. Ni el
SRS ni el repositorio de documentación nombran la normativa aplicable, y
suponerla sería peor que dejar el hueco visible.
