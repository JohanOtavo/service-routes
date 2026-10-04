# Decisiones — catalog-service

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

### El resumen de calificaciones se guarda aqui, duplicado

Ordenar el catalogo por valoracion exigiria preguntar a rating-service en cada busqueda, y una busqueda que depende de otro servicio falla cuando ese otro servicio falla. El resumen llega por evento y se guarda: la busqueda solo consulta su propio esquema. El precio es que el dato puede ir unos segundos por detras, y para ordenar un listado eso no importa.

### Las categorias las crea un administrador, no cualquiera

Una categoria por usuario convertiria el catalogo en texto libre y la busqueda por oficio dejaria de funcionar. Que vivan en una tabla es para poder cambiarlas **sin desplegar**, que es distinto de que las cree cualquiera.

### Buscar no exige token

El catalogo es el escaparate: obligar a registrarse para ver que hay dejaria a la plataforma sin forma de demostrar que sirve. Publicar o editar si exige sesion y perfil activo.

### Lo que vale para los ocho servicios, y no se repite aqui

Patron outbox con consumidores idempotentes, replicas `*_ref` alimentadas solo
por eventos, ninguna clave ajena entre esquemas, identidad inyectada por el
gateway, secreto compartido en toda ruta que no sea `/health` ni `/metrics`, y
validacion de la configuracion al arrancar: un servicio con una variable ausente
**no arranca**. Esta en [07-GRAFO-DE-EVENTOS.md](../../07-GRAFO-DE-EVENTOS.md) y
[05-OBSERVABILIDAD.md](../../05-OBSERVABILIDAD.md).
