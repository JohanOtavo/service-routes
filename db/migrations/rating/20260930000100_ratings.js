/**
 * pa_rating — calificaciones bidireccionales y reputacion.
 *
 * SRS: RF78-RF85, RF164-RF167.
 *
 * La calificacion dejo de ser unidireccional: en un mercado de dos lados el
 * oferente tambien necesita saber si el solicitante estuvo presente y pago.
 * Ambas permanecen ocultas hasta que las dos existan o venza el plazo, para que
 * nadie se reserve la suya como represalia (SRS RF166).
 */
'use strict';

const {
  primaryId,
  auditFields,
  checkIn,
  createOutbox,
  createProcessedEvents,
} = require('../../helpers');

const DIRECCIONES = ['SOLICITANTE_A_OFERENTE', 'OFERENTE_A_SOLICITANTE'];
const FACETAS = ['COMO_OFERENTE', 'COMO_SOLICITANTE'];

exports.up = async function up(knex) {
  // `usuario_ref` se creo aqui y se retiro en 20261004000100: nunca tuvo
  // escritor ni dependientes. Ver esa migracion y A-5 del backlog.

  /** Replica minima de la solicitud: solo lo necesario para validar y mostrar. */
  await knex.schema.createTable('solicitud_ref', (table) => {
    table.bigInteger('id_solicitud').unsigned().primary();
    table.bigInteger('id_usuario').unsigned().notNullable().comment('Solicitante');
    table.bigInteger('id_prestador').unsigned().notNullable();
    /**
     * El usuario que hay DETRAS del prestador, no solo el perfil.
     *
     * Las calificaciones y la reputacion se expresan en identificadores de
     * usuario, porque una misma persona puede ser calificada como oferente y
     * como solicitante (RF165). Sin esta columna, al completarse una solicitud
     * el servicio sabria a que PERFIL calificar pero no a que PERSONA, y no
     * habria manera de resolverlo dentro del esquema: el mapeo perfil-usuario
     * vive en pa_provider.
     */
    table
      .bigInteger('id_usuario_prestador')
      .unsigned()
      .notNullable()
      .comment('Usuario dueno del perfil de prestador; vive en pa_auth');
    table.bigInteger('id_servicio').unsigned().nullable();
    table.string('estado', 30).notNullable();
    table
      .datetime('completada_at')
      .nullable()
      .comment('Solo una solicitud COMPLETADA habilita calificar (SRS RF81)');
    table.datetime('synced_at').notNullable().defaultTo(knex.fn.now());

    table.index(['estado', 'completada_at'], 'idx_solicitud_ref_completadas');
    // "Las solicitudes en las que participo", desde cualquiera de los dos lados.
    table.index(['id_usuario'], 'idx_solicitud_ref_solicitante');
    table.index(['id_usuario_prestador'], 'idx_solicitud_ref_oferente');
  });

  await knex.schema.createTable('calificacion', (table) => {
    primaryId(table, 'id_calificacion');
    table.bigInteger('id_solicitud').unsigned().notNullable();
    table
      .string('direccion', 30)
      .notNullable()
      .comment('Quien califica a quien; permite una calificacion por parte');
    table.bigInteger('id_emisor').unsigned().notNullable().comment('Usuario que califica');
    table.bigInteger('id_receptor').unsigned().notNullable().comment('Usuario calificado');
    table.bigInteger('id_servicio').unsigned().nullable();
    table.tinyint('puntuacion').unsigned().notNullable();
    table.text('comentario').nullable();
    table
      .datetime('visible_at')
      .nullable()
      .comment('NULL mientras este en periodo ciego; con valor, ya es publica (SRS RF166)');
    table.boolean('oculta_por_moderacion').notNullable().defaultTo(false).comment('SRS RF85');
    table.datetime('fecha').notNullable().defaultTo(knex.fn.now());
    auditFields(knex, table, { softDelete: true });

    table
      .foreign('id_solicitud', 'fk_calificacion_solicitud')
      .references('id_solicitud')
      .inTable('solicitud_ref')
      .onDelete('RESTRICT');

    // "Una calificacion por parte y por solicitud" (SRS RF82).
    table.unique(['id_solicitud', 'direccion'], { indexName: 'uq_calificacion_parte' });

    // Calificaciones publicas de un servicio (SRS RF83).
    table.index(['id_servicio', 'visible_at'], 'idx_calificacion_servicio');
    // Reputacion de una persona.
    table.index(['id_receptor', 'visible_at'], 'idx_calificacion_receptor');
    // El proceso programado que levanta el periodo ciego (RF166) busca las
    // calificaciones aun ocultas cuyo plazo vencio: necesita visible_at
    // primero, no como ultima columna de un compuesto.
    table.index(['visible_at', 'fecha'], 'idx_calificacion_periodo_ciego');
  });

  await checkIn(knex, 'calificacion', 'direccion', DIRECCIONES);
  await knex.raw(
    'ALTER TABLE `calificacion` ADD CONSTRAINT `chk_calificacion_puntuacion` ' +
      'CHECK (`puntuacion` BETWEEN 1 AND 5)'
  );
  // Nadie se califica a si mismo.
  await knex.raw(
    'ALTER TABLE `calificacion` ADD CONSTRAINT `chk_calificacion_partes` ' +
      'CHECK (`id_emisor` <> `id_receptor`)'
  );

  /**
   * Reputacion agregada por usuario y faceta (SRS RF165).
   *
   * Separada por faceta a proposito: ser buen prestador y ser buen cliente son
   * cosas distintas, y mezclarlas en un solo numero destruye informacion.
   *
   * Desnormalizacion justificada: se lee en cada listado de propuestas
   * (SRS RF167) y recalcularla con un AVG en cada lectura no escalaria.
   */
  await knex.schema.createTable('reputacion', (table) => {
    table.bigInteger('id_usuario').unsigned().notNullable();
    table.string('faceta', 30).notNullable();
    table.decimal('puntuacion_media', 3, 2).notNullable().defaultTo(0);
    table.integer('total_calificaciones').unsigned().notNullable().defaultTo(0);
    table.datetime('actualizado_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['id_usuario', 'faceta']);
  });

  await checkIn(knex, 'reputacion', 'faceta', FACETAS);

  await createOutbox(knex);
  await createProcessedEvents(knex);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('processed_event');
  await knex.schema.dropTableIfExists('outbox_event');
  await knex.schema.dropTableIfExists('reputacion');
  await knex.schema.dropTableIfExists('calificacion');
  await knex.schema.dropTableIfExists('solicitud_ref');
  // Se mantiene el drop aunque `up` ya no cree la tabla: es lo que hace que un
  // rollback completo termine en el mismo estado de antes, sin dejar una tabla
  // suelta por el camino. Es un `if exists`, asi que no falla si no esta.
  await knex.schema.dropTableIfExists('usuario_ref');
};
