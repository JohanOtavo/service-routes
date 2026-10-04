# Decisiones — admin-reporting-service

> Documentacion extraida del codigo el **4 de octubre de 2026** (Fase 9). Cuando
> este documento y el codigo no coincidan, manda el codigo: evitar esa deriva es
> justamente para lo que sirve tener esto escrito.
>
> Vive en el repositorio de codigo y no en `09-microservices/services/`, que es
> donde `00-sdd-guide.md` lo pediria. Es la misma decision pendiente que el resto
> de los documentos de entrega: **AT-003**.

Las decisiones propias de este servicio. Las del sistema entero estan en
[02-DECISIONES.md](../../02-DECISIONES.md) y en
`friend-point-docs/05-architecture/decisions/`.

### La auditoria es inmutable por disparador, no por disciplina

Una tabla de auditoria que el propio servicio puede actualizar no prueba nada: quien tenga acceso a la aplicacion puede reescribir la historia. Los disparadores de `pa_admin` rechazan UPDATE y DELETE sobre `audit_record`. Por eso el usuario del esquema necesita el privilegio TRIGGER en las migraciones.

### Las series se recalculan en un barrido, no al consultar

Un informe que agrega sobre la marcha se vuelve mas lento cuantos mas datos hay, y es justo el momento en que a alguien le urge verlo. `CalculateStatistics` escribe `statistics_snapshot` cada `STATS_SWEEP_MS` sobre una ventana de `STATS_WINDOW_DAYS` dias, y la consulta solo lee. El temporizador lleva `unref()` para que no impida al proceso terminar.

### Los parametros viven en tabla

Cambiar un umbral no deberia necesitar un despliegue. Lo que SI esta en variables de entorno es la configuracion de infraestructura —puertos, credenciales, caducidad de tokens—, porque un parametro en base de datos que decide como arrancar es un arranque que depende de la base.

### Suscribe por familia y maneja tres eventos

Se ata a `iam.#` y `provider.#` y solo tiene manejador para tres eventos: el resto llega, se confirma y se descarta. Es deliberado: anadir un evento a la auditoria no deberia obligar a tocar la configuracion del broker.

### Lo que vale para los ocho servicios, y no se repite aqui

Patron outbox con consumidores idempotentes, replicas `*_ref` alimentadas solo
por eventos, ninguna clave ajena entre esquemas, identidad inyectada por el
gateway, secreto compartido en toda ruta que no sea `/health` ni `/metrics`, y
validacion de la configuracion al arrancar: un servicio con una variable ausente
**no arranca**. Esta en [07-GRAFO-DE-EVENTOS.md](../../07-GRAFO-DE-EVENTOS.md) y
[05-OBSERVABILIDAD.md](../../05-OBSERVABILIDAD.md).
