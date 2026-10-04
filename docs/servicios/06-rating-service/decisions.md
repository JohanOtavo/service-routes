# Decisiones — rating-service

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

### Solo se puede calificar lo completado

Permitir calificar una contratacion pendiente convertiria la calificacion en un arma de negociacion. El servicio lo comprueba contra su propia replica `solicitud_ref` y no preguntando a request-service: una calificacion no deberia fallar porque otro servicio este caido.

### La cancelacion pesa segun cuando se avise

Cancelar al minuto y cancelar el dia acordado no son lo mismo. Cada franja —gracia, holgada, ajustada, tardia— tiene su peso, y hay un periodo ciego configurable (`RATING_BLIND_PERIOD_DAYS`) antes de que las calificaciones se publiquen.

### El umbral avisa, no castiga

Cruzar el umbral emite `CancellationThresholdReached`, que se convierte en un aviso. Lo que se haga con esa informacion —restringir, revisar— es una decision de producto, y por eso el servicio no la toma por su cuenta.

### Lo que vale para los ocho servicios, y no se repite aqui

Patron outbox con consumidores idempotentes, replicas `*_ref` alimentadas solo
por eventos, ninguna clave ajena entre esquemas, identidad inyectada por el
gateway, secreto compartido en toda ruta que no sea `/health` ni `/metrics`, y
validacion de la configuracion al arrancar: un servicio con una variable ausente
**no arranca**. Esta en [07-GRAFO-DE-EVENTOS.md](../../07-GRAFO-DE-EVENTOS.md) y
[05-OBSERVABILIDAD.md](../../05-OBSERVABILIDAD.md).
