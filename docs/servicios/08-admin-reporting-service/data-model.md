# Modelo de datos — admin-reporting-service

> Documentacion extraida del codigo el **4 de octubre de 2026** (Fase 9). Cuando
> este documento y el codigo no coincidan, manda el codigo: evitar esa deriva es
> justamente para lo que sirve tener esto escrito.
>
> Vive en el repositorio de codigo y no en `09-microservices/services/`, que es
> donde `00-sdd-guide.md` lo pediria. Es la misma decision pendiente que el resto
> de los documentos de entrega: **AT-003**.

## Esquema `pa_admin`

Un esquema por servicio, con su propio usuario MySQL y privilegio minimo sobre
el suyo. **No hay ninguna clave ajena entre esquemas** (SRS RNF53): lo que un
servicio necesita de otro llega por eventos y vive en una tabla `*_ref` propia.

| Tabla | Que guarda |
|---|---|
| `audit_record` | La auditoria. **Inmutable**: tiene disparadores que impiden actualizarla y borrarla |
| `system_parameter` | Los parametros del sistema, cambiables sin desplegar |
| `statistics_snapshot` | Las series calculadas: una fila por fecha, metrica y dimension |
| `backup_record` | Los respaldos, con `restauracion_probada_at`: la prueba de que la restauracion se hizo de verdad (AT-004) |
| `content_moderation` | Moderacion de contenido. La tabla esta, el flujo no |
| `outbox_event · processed_event` | Outbox e idempotencia |

## Las tablas `*_ref` no se escriben a mano

Son replicas de solo lectura alimentadas **unicamente** por eventos. Escribir en
ellas directamente las deja fuera de sincronia sin que nada lo note, porque
nadie las recalcula. Lo que las reconstruye es:

```bash
npm run db:reemit admin
```

Las semillas **no** escriben en el outbox, asi que una base recien creada tiene
las tablas propias llenas y las replicas vacias. Ese es el paso que falta cuando
algo responde "no existe" sobre un dato que si existe en su dueno.

## Migraciones

```bash
npm run db:migrate                   # todos los esquemas
node db/cli.js status admin
npm run db:rollback
```

Toda migracion es reversible: su `down` existe y se ejecuta. El usuario del
servicio tiene `DROP` acotado a `pa_admin.*` precisamente para que
`rollback` funcione sin darle poder sobre los demas esquemas.
