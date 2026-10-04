# Decisiones — request-service

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

### El contacto se revela solo tras el acuerdo, y solo a las dos partes

Es la frontera que sostiene la intermediacion: si el telefono se viera antes, las dos partes se irian por fuera y la plataforma se quedaria sin razon de ser. El campo `contacto` del detalle llega `null` mientras no hay acuerdo, y es `null` en lugar de ausencia del campo para que la interfaz pueda distinguir "todavia no" de "no vino". El telefono sale del perfil de prestador replicado; decidido el 3/10/2026 (B-1).

### La politica de cancelacion se dice ANTES de cancelar

La pantalla avisa de que el motivo elegido puede abrir revision y pide la fecha acordada porque de ella depende la franja; al terminar muestra el peso que tuvo. Como la plataforma no cobra, la reputacion es su unico instrumento disuasorio, y uno que no se ve no disuade.

### Una necesidad y una contratacion directa acaban en la misma tabla

`solicitud_servicio` tiene un campo `origen`. Dos tablas para el mismo ciclo de vida obligarian a duplicar los estados, el historial y la cancelacion; el origen es un dato, no una entidad distinta.

### Los motivos de cancelacion viven en tabla, no en el codigo

Un administrador tiene que poder cambiarlos sin desplegar, y cada motivo lleva si exige detalle y si abre revision. El cliente los pide al servidor en lugar de llevar la lista fija.

### Lo que vale para los ocho servicios, y no se repite aqui

Patron outbox con consumidores idempotentes, replicas `*_ref` alimentadas solo
por eventos, ninguna clave ajena entre esquemas, identidad inyectada por el
gateway, secreto compartido en toda ruta que no sea `/health` ni `/metrics`, y
validacion de la configuracion al arrancar: un servicio con una variable ausente
**no arranca**. Esta en [07-GRAFO-DE-EVENTOS.md](../../07-GRAFO-DE-EVENTOS.md) y
[05-OBSERVABILIDAD.md](../../05-OBSERVABILIDAD.md).
