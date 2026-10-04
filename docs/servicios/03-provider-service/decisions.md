# Decisiones — provider-service

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

### La ficha publica no exige token

`GET /api/v1/providers/:id` es la unica ruta publica del servicio. Quien busca un servicio tiene que poder ver a quien lo ofrece antes de registrarse; si no, la plataforma no se puede evaluar sin crear una cuenta. Lo que esa ficha NO devuelve es el contacto: el telefono aparece solo tras el acuerdo, y lo sirve request-service.

### El perfil nace inactivo y lo activa un administrador

Un perfil que pudiera proponer desde su creacion convertiria el registro en el unico control de entrada. La validacion es el punto donde alguien responde por el prestador, y queda escrita en `provider_validation_log` con su autor.

### Baja logica, nunca borrado

Un perfil borrado de verdad dejaria solicitudes y calificaciones apuntando al vacio, y como no hay claves ajenas entre esquemas, nada lo impediria. `deleted_at` conserva la historia y lo saca de las busquedas.

### Lo que vale para los ocho servicios, y no se repite aqui

Patron outbox con consumidores idempotentes, replicas `*_ref` alimentadas solo
por eventos, ninguna clave ajena entre esquemas, identidad inyectada por el
gateway, secreto compartido en toda ruta que no sea `/health` ni `/metrics`, y
validacion de la configuracion al arrancar: un servicio con una variable ausente
**no arranca**. Esta en [07-GRAFO-DE-EVENTOS.md](../../07-GRAFO-DE-EVENTOS.md) y
[05-OBSERVABILIDAD.md](../../05-OBSERVABILIDAD.md).
