# Modelo de datos — catalog-service

> Documentacion extraida del codigo el **4 de octubre de 2026** (Fase 9). Cuando
> este documento y el codigo no coincidan, manda el codigo: evitar esa deriva es
> justamente para lo que sirve tener esto escrito.
>
> Vive en el repositorio de codigo y no en `09-microservices/services/`, que es
> donde `00-sdd-guide.md` lo pediria. Es la misma decision pendiente que el resto
> de los documentos de entrega: **AT-003**.

## Esquema `pa_catalog`

Un esquema por servicio, con su propio usuario MySQL y privilegio minimo sobre
el suyo. **No hay ninguna clave ajena entre esquemas** (SRS RNF53): lo que un
servicio necesita de otro llega por eventos y vive en una tabla `*_ref` propia.

| Tabla | Que guarda |
|---|---|
| `categoria_servicio` | Las categorias de oficio. Clave natural: `nombre_categoria` |
| `servicio` | Los servicios publicados, con `estado` y `deleted_at` |
| `service_rating_summary` | Resumen de calificaciones por servicio: media y total. Lo alimentan los eventos de rating-service |
| `prestador_ref` | Replica de solo lectura del prestador |
| `outbox_event` | Eventos pendientes de publicar |
| `processed_event` | Marca de idempotencia |

## Las tablas `*_ref` no se escriben a mano

Son replicas de solo lectura alimentadas **unicamente** por eventos. Escribir en
ellas directamente las deja fuera de sincronia sin que nada lo note, porque
nadie las recalcula. Lo que las reconstruye es:

```bash
npm run db:reemit catalog
```

Las semillas **no** escriben en el outbox, asi que una base recien creada tiene
las tablas propias llenas y las replicas vacias. Ese es el paso que falta cuando
algo responde "no existe" sobre un dato que si existe en su dueno.

## Migraciones

```bash
npm run db:migrate                   # todos los esquemas
node db/cli.js status catalog
npm run db:rollback
```

Toda migracion es reversible: su `down` existe y se ejecuta. El usuario del
servicio tiene `DROP` acotado a `pa_catalog.*` precisamente para que
`rollback` funcione sin darle poder sobre los demas esquemas.
