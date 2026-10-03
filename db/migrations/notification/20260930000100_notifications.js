/**
 * pa_notification — notificaciones al usuario y sus preferencias.
 *
 * SRS: RF86-RF96, RF168-RF173.
 *
 * Es un servicio puramente consumidor: no expone escritura de negocio, solo
 * reacciona a eventos. Por eso no tiene outbox, pero si processed_event: el
 * broker entrega "al menos una vez" y sin idempotencia el usuario recibiria
 * la misma notificacion dos veces (SRS RF95).
 */
'use strict';

const {
  primaryId,
  auditFields,
  checkIn,
  createProcessedEvents,
  createUsuarioRef,
} = require('../../helpers');

const ESTADOS = ['NO_LEIDA', 'LEIDA'];

exports.up = async function up(knex) {
  await createUsuarioRef(knex, (table) => {
    table
      .string('especialidad', 150)
      .nullable()
      .comment('Del perfil de prestador; dirige el aviso de necesidades afines (SRS RF172)');
  });

  await knex.schema.createTable('notificacion', (table) => {
    primaryId(table, 'id_notificacion');
    table.bigInteger('id_usuario').unsigned().notNullable();
    table
      .string('tipo', 60)
      .notNullable()
      .comment('Clase de notificacion; el usuario puede silenciarla por tipo');
    table.string('titulo', 150).notNullable();
    table.text('mensaje').notNullable();
    table
      .string('recurso_tipo', 40)
      .nullable()
      .comment('Recurso al que lleva: NECESIDAD, PROPUESTA, SOLICITUD...');
    table.bigInteger('recurso_id').unsigned().nullable();
    table.string('estado', 30).notNullable().defaultTo('NO_LEIDA');
    table.datetime('leida_at').nullable();
    table.datetime('fecha').notNullable().defaultTo(knex.fn.now());
    auditFields(knex, table, { softDelete: true });

    table
      .foreign('id_usuario', 'fk_notificacion_usuario')
      .references('id_usuario')
      .inTable('usuario_ref')
      .onDelete('CASCADE');

    // Dos indices y no uno compuesto, porque son dos consultas distintas.
    //
    // La bandeja por defecto NO filtra por estado: lista todo el historial del
    // usuario ordenado por fecha. Con un indice (id_usuario, estado, fecha),
    // MySQL solo puede usar el prefijo id_usuario y tiene que materializar y
    // ordenar todas las notificaciones de esa persona en memoria en cada
    // pagina. El contador de no leidas, en cambio, si filtra por estado y no
    // ordena por fecha.
    table.index(['id_usuario', 'fecha'], 'idx_notificacion_bandeja');
    table.index(['id_usuario', 'estado'], 'idx_notificacion_no_leidas');
  });

  await checkIn(knex, 'notificacion', 'estado', ESTADOS);

  /**
   * Preferencias por tipo (SRS RF173). Ausencia de fila = recibir por defecto,
   * de modo que un tipo nuevo no queda silenciado para todo el mundo.
   */
  await knex.schema.createTable('notification_preference', (table) => {
    table.bigInteger('id_usuario').unsigned().notNullable();
    table.string('tipo', 60).notNullable();
    table.boolean('habilitada').notNullable().defaultTo(true);
    table
      .datetime('updated_at')
      .notNullable()
      .defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));

    table.primary(['id_usuario', 'tipo']);
    table
      .foreign('id_usuario', 'fk_preferencia_usuario')
      .references('id_usuario')
      .inTable('usuario_ref')
      .onDelete('CASCADE');
  });

  await createProcessedEvents(knex);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('processed_event');
  await knex.schema.dropTableIfExists('notification_preference');
  await knex.schema.dropTableIfExists('notificacion');
  await knex.schema.dropTableIfExists('usuario_ref');
};
