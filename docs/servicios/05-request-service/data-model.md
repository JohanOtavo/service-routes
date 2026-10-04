# Modelo de datos — request-service

> Documentacion extraida del codigo el **4 de octubre de 2026** (Fase 9). Cuando
> este documento y el codigo no coincidan, manda el codigo: evitar esa deriva es
> justamente para lo que sirve tener esto escrito.
>
> Vive en el repositorio de codigo y no en `09-microservices/services/`, que es
> donde `00-sdd-guide.md` lo pediria. Es la misma decision pendiente que el resto
> de los documentos de entrega: **AT-003**.

## Esquema `pa_request`

Un esquema por servicio, con su propio usuario MySQL y privilegio minimo sobre
el suyo. **No hay ninguna clave ajena entre esquemas** (SRS RNF53): lo que un
servicio necesita de otro llega por eventos y vive en una tabla `*_ref` propia.

| Tabla | Que guarda |
|---|---|
| `necesidad` | Lo que alguien necesita, con su categoria y su estado |
| `propuesta` | Lo que un prestador ofrece para una necesidad |
| `solicitud_servicio` | La contratacion: nace de una adjudicacion o de una contratacion directa |
| `historial_solicitud` | Cada cambio de estado, con quien y cuando |
| `cancelacion` | La cancelacion con su franja, su peso y si abrio revision |
| `motivo_cancelacion` | El catalogo de motivos: en tabla, para poder cambiarlo sin desplegar |
| `incomparecencia` | Quien no se presento, declarado por la otra parte |
| `restriccion_usuario` | Restricciones aplicadas a un usuario por su comportamiento |
| `idempotency_key` | Para que reintentar una contratacion no cree dos |
| `usuario_ref · prestador_ref · servicio_ref · categoria_ref · reputacion_ref` | Cinco replicas de solo lectura. **Es el servicio que depende de mas eventos del sistema** |
| `outbox_event · processed_event` | Outbox e idempotencia |

## Las tablas `*_ref` no se escriben a mano

Son replicas de solo lectura alimentadas **unicamente** por eventos. Escribir en
ellas directamente las deja fuera de sincronia sin que nada lo note, porque
nadie las recalcula. Lo que las reconstruye es:

```bash
npm run db:reemit request
```

Las semillas **no** escriben en el outbox, asi que una base recien creada tiene
las tablas propias llenas y las replicas vacias. Ese es el paso que falta cuando
algo responde "no existe" sobre un dato que si existe en su dueno.

## Migraciones

```bash
npm run db:migrate                   # todos los esquemas
node db/cli.js status request
npm run db:rollback
```

Toda migracion es reversible: su `down` existe y se ejecuta. El usuario del
servicio tiene `DROP` acotado a `pa_request.*` precisamente para que
`rollback` funcione sin darle poder sobre los demas esquemas.
