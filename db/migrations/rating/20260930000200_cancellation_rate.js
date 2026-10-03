/**
 * pa_rating — tasa de cancelacion por usuario y faceta.
 *
 * SRS: RF180-RF183, RF192, seccion 10.2.6.
 *
 * La tasa vive aqui y no en pa_request porque es una metrica de reputacion: se
 * muestra junto a la puntuacion media, se calcula por faceta igual que ella y
 * comparte su ciclo de recalculo. pa_request es dueno del HECHO de cada
 * cancelacion; este servicio lo es de lo que ese hecho significa sobre una
 * persona.
 */
'use strict';

const { primaryId, checkIn } = require('../../helpers');

const FACETAS = ['COMO_OFERENTE', 'COMO_SOLICITANTE'];

exports.up = async function up(knex) {
  await knex.schema.createTable('tasa_cancelacion', (table) => {
    table.bigInteger('id_usuario').unsigned().notNullable();
    table.string('faceta', 30).notNullable();

    table
      .integer('contrataciones_en_ventana')
      .unsigned()
      .notNullable()
      .defaultTo(0)
      .comment('Denominador: contrataciones cerradas dentro de la ventana movil');
    table
      .decimal('cancelaciones_ponderadas', 6, 2)
      .notNullable()
      .defaultTo(0)
      .comment('Numerador: suma de los pesos, no el conteo. Cancelar tarde pesa mas');
    table
      .decimal('tasa', 5, 4)
      .notNullable()
      .defaultTo(0)
      .comment('cancelaciones_ponderadas / contrataciones_en_ventana');

    table
      .tinyint('umbral_alcanzado')
      .unsigned()
      .notNullable()
      .defaultTo(0)
      .comment('0 sin umbral, 1 aviso, 2 restriccion, 3 revision administrativa');
    table
      .boolean('evaluable')
      .notNullable()
      .defaultTo(false)
      .comment('Falso mientras no haya contrataciones suficientes en la ventana');

    table.datetime('ventana_desde').notNullable();
    table.datetime('calculada_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['id_usuario', 'faceta']);
    // Bandeja administrativa: quienes cruzaron un umbral.
    table.index(['umbral_alcanzado', 'calculada_at'], 'idx_tasa_umbral');
  });

  await checkIn(knex, 'tasa_cancelacion', 'faceta', FACETAS);
  await knex.raw(
    'ALTER TABLE `tasa_cancelacion` ADD CONSTRAINT `chk_tasa_rango` ' +
      'CHECK (`tasa` >= 0 AND `tasa` <= 3)'
  );
  await knex.raw(
    'ALTER TABLE `tasa_cancelacion` ADD CONSTRAINT `chk_tasa_umbral` ' +
      'CHECK (`umbral_alcanzado` BETWEEN 0 AND 3)'
  );

  /**
   * Cada cancelacion que llega por evento, para poder recalcular la ventana.
   *
   * Sin este detalle la tasa solo podria crecer: al salir una cancelacion de la
   * ventana movil de 90 dias habria que restarla, y para eso hace falta saber
   * cual fue y cuanto pesaba. Guardar solo el agregado haria que una mala racha
   * marcara a alguien de forma permanente, que es justo lo que una ventana
   * movil existe para evitar.
   */
  await knex.schema.createTable('cancelacion_ref', (table) => {
    primaryId(table, 'id_registro');
    table.bigInteger('id_cancelacion').unsigned().notNullable().unique();
    table.bigInteger('id_solicitud').unsigned().notNullable();
    table.bigInteger('id_usuario_imputado').unsigned().notNullable();
    table.string('faceta', 30).notNullable().comment('En que faceta actuaba el imputado');
    table.decimal('peso', 3, 2).notNullable();
    table.boolean('computa').notNullable();
    table.datetime('cancelada_at').notNullable();
    table.datetime('synced_at').notNullable().defaultTo(knex.fn.now());

    // El recalculo barre exactamente esto: lo que computa de una persona dentro
    // de la ventana.
    table.index(
      ['id_usuario_imputado', 'faceta', 'computa', 'cancelada_at'],
      'idx_cancelacion_ref_ventana'
    );
  });

  await checkIn(knex, 'cancelacion_ref', 'faceta', FACETAS);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('cancelacion_ref');
  await knex.schema.dropTableIfExists('tasa_cancelacion');
};
