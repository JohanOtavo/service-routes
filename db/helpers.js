/**
 * Convenciones compartidas por las migraciones de los siete esquemas.
 *
 * Existe para que las columnas de auditoria, las tablas del patron outbox y las
 * replicas entre servicios sean identicas en todas partes. Si cada migracion las
 * declarara por su cuenta, divergirian en cuanto alguien olvidara un indice.
 *
 * Todas las funciones reciben la instancia `knex` de la migracion: `raw` y `fn`
 * viven en la instancia, no en el modulo.
 */
'use strict';

/**
 * Identificador primario. BIGINT UNSIGNED y no INT: el modelo conceptual del
 * SRS dice INT, pero migrar una clave primaria con datos en produccion es caro
 * y el coste de 4 bytes por fila es irrelevante a esta escala.
 */
function primaryId(table, name) {
  table.bigIncrements(name).unsigned().primary();
}

/** Referencia a una fila de OTRO esquema. Nunca lleva clave foranea. */
function foreignRef(table, name, comment) {
  return table.bigInteger(name).unsigned().comment(comment);
}

/**
 * Campos de auditoria obligatorios en toda tabla de negocio.
 *
 * created_by guarda el usuario responsable del alta. Es NULL cuando la fila la
 * escribe el sistema y no una persona: replicas alimentadas por eventos,
 * proyecciones y procesos programados.
 *
 * created_by NO lleva clave foranea ni dentro del mismo esquema: en
 * request-service o rating-service el usuario vive en pa_auth, y una FK entre
 * esquemas romperia la propiedad de datos que exige el SRS (RNF53).
 */
function auditFields(knex, table, { softDelete = false } = {}) {
  table.datetime('created_at').notNullable().defaultTo(knex.fn.now());
  table
    .datetime('updated_at')
    .notNullable()
    .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
  table
    .bigInteger('created_by')
    .unsigned()
    .nullable()
    .comment('Usuario responsable del alta; NULL si la escribio el sistema');

  if (softDelete) {
    // NULL = activo. Con valor = borrado logico, conservando el historial.
    table.datetime('deleted_at').nullable().index();
  }
}

/**
 * Tabla outbox: todo servicio que publica eventos la necesita.
 *
 * El evento se escribe aqui dentro de la MISMA transaccion que el cambio de
 * negocio, y un proceso aparte lo publica despues. Asi el sistema no puede
 * quedar en el estado "la escritura se confirmo pero el evento se perdio"
 * (SRS RNF37, RNF46).
 */
async function createOutbox(knex) {
  await knex.schema.createTable('outbox_event', (table) => {
    primaryId(table, 'id_outbox');
    table
      .string('event_id', 36)
      .notNullable()
      .unique()
      .comment('UUID del evento; el consumidor lo usa para descartar duplicados');
    table.string('event_name', 80).notNullable();
    table.integer('event_version').unsigned().notNullable().defaultTo(1);
    table.string('aggregate_type', 60).notNullable();
    table.string('aggregate_id', 64).notNullable();
    table
      .string('correlation_id', 36)
      .notNullable()
      .comment('Se propaga desde el gateway para rastrear la operacion completa');
    table.string('causation_id', 36).nullable();
    table.json('payload').notNullable();
    table.datetime('occurred_at').notNullable().defaultTo(knex.fn.now());
    table
      .datetime('published_at')
      .nullable()
      .comment('NULL mientras el publicador no lo haya enviado al broker');
    table.integer('attempts').unsigned().notNullable().defaultTo(0);
    table.string('last_error', 500).nullable();

    // El publicador barre exactamente esto: lo no publicado, en orden.
    table.index(['published_at', 'occurred_at'], 'idx_outbox_pendientes');
  });
}

/**
 * Registro de eventos ya procesados: da idempotencia al consumidor.
 *
 * El broker garantiza entrega "al menos una vez", asi que el mismo evento puede
 * llegar dos veces. Sin esta tabla una notificacion se enviaria duplicada y un
 * contador se incrementaria dos veces (SRS RF95, RNF89).
 */
async function createProcessedEvents(knex) {
  await knex.schema.createTable('processed_event', (table) => {
    table.string('consumer', 60).notNullable().comment('Manejador que aplico el evento');
    table.string('event_id', 36).notNullable().comment('UUID del evento consumido');
    table.string('event_name', 80).notNullable();
    table.datetime('processed_at').notNullable().defaultTo(knex.fn.now());

    // La clave es (consumidor, evento), no el evento solo.
    //
    // Un mismo servicio suele tener varios manejadores del mismo evento: en
    // pa_admin, NeedPublished alimenta a la vez el registro de auditoria y la
    // proyeccion de estadisticas. Con el evento como clave unica, el primer
    // manejador que lo registra bloquea a los demas y el evento se pierde en
    // silencio para ellos. La idempotencia que exige RF95 es por consumidor,
    // no por servicio.
    table.primary(['consumer', 'event_id']);

    // Soporta la purga periodica de registros antiguos (SRS-DIST-07).
    table.index(['processed_at'], 'idx_processed_purga');
  });
}

/**
 * Replica local del usuario que vive en pa_auth.
 *
 * Es consistencia eventual, alimentada por los eventos de identidad. Guarda solo
 * lo necesario para mostrar, nunca credenciales. Una decision de escritura no
 * debe basarse en estos datos si se puede preguntar al propietario (SRS RNF54).
 */
async function createUsuarioRef(knex, extra) {
  await knex.schema.createTable('usuario_ref', (table) => {
    table
      .bigInteger('id_usuario')
      .unsigned()
      .primary()
      .comment('Identificador en pa_auth; sin FK, es otro esquema');
    table.string('nombre', 100).notNullable();
    table.string('correo', 150).nullable();
    table.string('telefono', 20).nullable();
    table.string('estado', 30).notNullable().defaultTo('ACTIVO');
    table.datetime('synced_at').notNullable().defaultTo(knex.fn.now());
    if (extra) extra(table);
  });
}

/**
 * Restringe una columna a un conjunto de valores mediante CHECK.
 *
 * Se usa en lugar de ENUM porque anadir un valor a un ENUM en MySQL reescribe
 * la tabla, mientras que sustituir un CHECK es una operacion de metadatos.
 */
function checkIn(knex, tableName, column, values) {
  const list = values.map((v) => `'${v}'`).join(', ');
  return knex.raw(
    `ALTER TABLE \`${tableName}\` ADD CONSTRAINT \`chk_${tableName}_${column}\` ` +
      `CHECK (\`${column}\` IN (${list}))`
  );
}

module.exports = {
  primaryId,
  foreignRef,
  auditFields,
  createOutbox,
  createProcessedEvents,
  createUsuarioRef,
  checkIn,
};
