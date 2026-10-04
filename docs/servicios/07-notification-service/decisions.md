# Decisiones — notification-service

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

### El token de recuperacion llega dentro de un evento

Es el unico evento del sistema que transporta un secreto: `UserProfileUpdated` con `accion: RECUPERACION_SOLICITADA` y el token en el payload. Por eso el unico consumidor que actua sobre el es este, y no se replica a los modelos de lectura de los demas. Antes de la Fase 6 nadie lo consumia: el token se generaba y el enlace no llegaba a ningun sitio.

### Sin SMTP configurado, el correo se registra en lugar de enviarse

Un entorno de desarrollo no deberia necesitar un servidor de correo, y fallar al enviar dejaria la recuperacion inservible en local. `EnviadorCorreoRegistrado` escribe el correo completo en el registro, que es lo que leen las pruebas E2E. En produccion, `exigirCorreoEnProduccion()` impide arrancar sin SMTP: lo contrario seria un sistema que dice haber enviado correos que nadie envio.

### Una re-emision no reenvia correos

`npm run db:reemit` republica los eventos de alta para reconstruir replicas. Sin proteccion, eso mandaria otra vez el correo de bienvenida a todo el mundo. Los eventos re-emitidos llevan `reemision: true` y los manejadores que escriben al exterior los ignoran (`esReemision()`).

### Push y correo de producto quedan fuera del MVP

Un service worker con permisos de navegador, un proveedor de correo y preferencias por canal son trabajo real para un valor que el MVP no pide. La bandeja cubre el caso. Decidido el 3/10/2026; la Fase 7 se elimino del plan.

### Lo que vale para los ocho servicios, y no se repite aqui

Patron outbox con consumidores idempotentes, replicas `*_ref` alimentadas solo
por eventos, ninguna clave ajena entre esquemas, identidad inyectada por el
gateway, secreto compartido en toda ruta que no sea `/health` ni `/metrics`, y
validacion de la configuracion al arrancar: un servicio con una variable ausente
**no arranca**. Esta en [07-GRAFO-DE-EVENTOS.md](../../07-GRAFO-DE-EVENTOS.md) y
[05-OBSERVABILIDAD.md](../../05-OBSERVABILIDAD.md).
