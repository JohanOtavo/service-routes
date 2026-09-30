/**
 * pa_catalog — servicios publicados, categorias y busqueda.
 *
 * SRS: RF33-RF53. Cubre el flujo dirigido por la oferta: el prestador publica,
 * el solicitante busca.
 */
'use strict';

const {
  primaryId,
  auditFields,
  checkIn,
  createOutbox,
  createProcessedEvents,
} = require('../../helpers');

const ESTADOS_SERVICIO = ['ACTIVE', 'INACTIVE'];

exports.up = async function up(knex) {
  await knex.schema.createTable('categoria_servicio', (table) => {
    primaryId(table, 'id_categoria');
    // La unicidad del nombre es regla de negocio (SRS RF42).
    table.string('nombre_categoria', 100).notNullable().unique();
    table.string('descripcion', 255).nullable();
    table.boolean('activa').notNullable().defaultTo(true);
    auditFields(knex, table, { softDelete: true });

    table.index(['activa', 'deleted_at'], 'idx_categoria_disponibles');
  });

  /**
   * Replica del prestador, alimentada por los eventos de pa_provider.
   *
   * Existe para que la busqueda de servicios pueda mostrar el nombre y filtrar
   * por estado del prestador sin una llamada sincrona por resultado. Es
   * consistencia eventual: la decision de SI se puede publicar se sigue tomando
   * preguntando a provider-service (SRS RNF54).
   */
  await knex.schema.createTable('prestador_ref', (table) => {
    table.bigInteger('id_prestador').unsigned().primary();
    table.bigInteger('id_usuario').unsigned().notNullable();
    table.string('nombre', 100).notNullable();
    table.string('especialidad', 150).nullable();
    table.string('estado', 30).notNullable().defaultTo('PENDING_VALIDATION');
    table.datetime('synced_at').notNullable().defaultTo(knex.fn.now());

    table.index(['estado'], 'idx_prestador_ref_estado');
  });

  await knex.schema.createTable('servicio', (table) => {
    primaryId(table, 'id_servicio');
    table.string('nombre_servicio', 150).notNullable();
    table.text('descripcion').notNullable();
    table.bigInteger('id_prestador').unsigned().notNullable();
    table.bigInteger('id_categoria').unsigned().notNullable();
    table.string('estado', 30).notNullable().defaultTo('ACTIVE');
    auditFields(knex, table, { softDelete: true });

    table
      .foreign('id_prestador', 'fk_servicio_prestador')
      .references('id_prestador')
      .inTable('prestador_ref')
      .onDelete('RESTRICT');
    table
      .foreign('id_categoria', 'fk_servicio_categoria')
      .references('id_categoria')
      .inTable('categoria_servicio')
      // RESTRICT implementa "no se borra una categoria con servicios" (SRS RF43).
      .onDelete('RESTRICT');

    // Busqueda publica: activos y no borrados, filtrando por categoria.
    table.index(['estado', 'deleted_at', 'id_categoria'], 'idx_servicio_busqueda');
    // "Los servicios de este prestador" (SRS RF52).
    table.index(['id_prestador', 'estado'], 'idx_servicio_prestador');
  });

  await checkIn(knex, 'servicio', 'estado', ESTADOS_SERVICIO);

  // Indice de texto completo para la busqueda libre (SRS RF45). Knex no lo
  // expone, asi que va en SQL.
  await knex.raw(
    'ALTER TABLE `servicio` ADD FULLTEXT INDEX `ft_servicio_texto` (`nombre_servicio`, `descripcion`)'
  );

  /**
   * Agregado de calificaciones por servicio.
   *
   * Desnormalizacion deliberada: la puntuacion media se muestra en cada fila de
   * cada pagina de resultados (SRS RF53). Calcularla con un AVG sobre pa_rating
   * exigiria una llamada entre servicios por resultado. Se mantiene al consumir
   * RatingSubmitted (SRS RF84) y su fuente de verdad sigue siendo rating-service.
   */
  await knex.schema.createTable('service_rating_summary', (table) => {
    table.bigInteger('id_servicio').unsigned().primary();
    table.decimal('puntuacion_media', 3, 2).notNullable().defaultTo(0);
    table.integer('total_calificaciones').unsigned().notNullable().defaultTo(0);
    table.datetime('actualizado_at').notNullable().defaultTo(knex.fn.now());

    table
      .foreign('id_servicio', 'fk_resumen_servicio')
      .references('id_servicio')
      .inTable('servicio')
      .onDelete('CASCADE');

    // Orden "mejor calificados primero".
    table.index(['puntuacion_media', 'total_calificaciones'], 'idx_resumen_orden');
  });

  await createOutbox(knex);
  await createProcessedEvents(knex);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('processed_event');
  await knex.schema.dropTableIfExists('outbox_event');
  await knex.schema.dropTableIfExists('service_rating_summary');
  await knex.schema.dropTableIfExists('servicio');
  await knex.schema.dropTableIfExists('prestador_ref');
  await knex.schema.dropTableIfExists('categoria_servicio');
};
