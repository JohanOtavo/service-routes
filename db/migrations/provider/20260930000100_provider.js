/**
 * pa_provider — perfiles de prestador y su validacion administrativa.
 *
 * SRS: RF22-RF32. Un perfil recien creado queda en PENDING_VALIDATION y no es
 * publicamente visible hasta que un administrador lo valida (RF24, RF25).
 */
'use strict';

const {
  primaryId,
  auditFields,
  checkIn,
  createOutbox,
  createProcessedEvents,
  createUsuarioRef,
} = require('../../helpers');

const ESTADOS_PERFIL = ['PENDING_VALIDATION', 'ACTIVE', 'SUSPENDED', 'INACTIVE'];

exports.up = async function up(knex) {
  await createUsuarioRef(knex);

  await knex.schema.createTable('prestador', (table) => {
    primaryId(table, 'id_prestador');
    // UNIQUE es la regla "un perfil como maximo por usuario" (SRS RF23).
    // Sin FK: el usuario vive en pa_auth, otro esquema.
    table
      .bigInteger('id_usuario')
      .unsigned()
      .notNullable()
      .unique()
      .comment('Identificador en pa_auth; un perfil por usuario (SRS RF23)');
    table.string('nombre', 100).notNullable();
    table.string('especialidad', 150).notNullable();
    table.string('experiencia', 500).nullable();
    table.string('telefono', 20).nullable();
    table.string('correo', 150).nullable();
    table.string('disponibilidad', 255).nullable();
    table.string('estado', 30).notNullable().defaultTo('PENDING_VALIDATION');
    auditFields(knex, table, { softDelete: true });

    // El listado publico filtra por estado activo y no borrado.
    table.index(['estado', 'deleted_at'], 'idx_prestador_visibles');
    // La busqueda por especialidad alimenta el aviso a oferentes afines (RF172).
    table.index(['especialidad'], 'idx_prestador_especialidad');
  });

  await checkIn(knex, 'prestador', 'estado', ESTADOS_PERFIL);

  /**
   * Bitacora de validaciones. Es append-only: registra quien valido o rechazo
   * un perfil y cuando (SRS RF26, RF27). No se actualiza ni se borra.
   */
  await knex.schema.createTable('provider_validation_log', (table) => {
    primaryId(table, 'id_validacion');
    table.bigInteger('id_prestador').unsigned().notNullable();
    table.string('estado_anterior', 30).nullable();
    table.string('estado_nuevo', 30).notNullable();
    table
      .bigInteger('validado_por')
      .unsigned()
      .notNullable()
      .comment('Administrador responsable; vive en pa_auth');
    table.string('motivo', 500).nullable().comment('Obligatorio al rechazar (SRS RF27)');
    table.datetime('registrado_at').notNullable().defaultTo(knex.fn.now());

    table
      .foreign('id_prestador', 'fk_validacion_prestador')
      .references('id_prestador')
      .inTable('prestador')
      .onDelete('CASCADE');

    table.index(['id_prestador', 'registrado_at'], 'idx_validacion_perfil');
  });

  await createOutbox(knex);
  await createProcessedEvents(knex);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('processed_event');
  await knex.schema.dropTableIfExists('outbox_event');
  await knex.schema.dropTableIfExists('provider_validation_log');
  await knex.schema.dropTableIfExists('prestador');
  await knex.schema.dropTableIfExists('usuario_ref');
};
