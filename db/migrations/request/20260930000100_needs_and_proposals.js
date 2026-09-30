/**
 * pa_request — flujo dirigido por la demanda: necesidades y propuestas.
 *
 * SRS: RF117-RF149. El solicitante publica lo que necesita y los oferentes
 * validados le presentan propuestas.
 *
 * Necesidad y Propuesta forman un solo agregado (NEED-AGGR-INV-007): adjudicar
 * cambia la necesidad, la propuesta ganadora y las descartadas a la vez. Por eso
 * viven en el mismo esquema que la solicitud que produce la adjudicacion.
 */
'use strict';

const {
  primaryId,
  auditFields,
  checkIn,
  createUsuarioRef,
} = require('../../helpers');

const ESTADOS_NECESIDAD = ['ABIERTA', 'ADJUDICADA', 'VENCIDA', 'CERRADA', 'CANCELADA'];
const ESTADOS_PROPUESTA = ['ENVIADA', 'ACEPTADA', 'RECHAZADA', 'RETIRADA', 'DESCARTADA'];

exports.up = async function up(knex) {
  await createUsuarioRef(knex);

  /** Replica del prestador: la propuesta necesita su nombre y su estado. */
  await knex.schema.createTable('prestador_ref', (table) => {
    table.bigInteger('id_prestador').unsigned().primary();
    table.bigInteger('id_usuario').unsigned().notNullable();
    table.string('nombre', 100).notNullable();
    table.string('especialidad', 150).nullable();
    table.string('estado', 30).notNullable().defaultTo('PENDING_VALIDATION');
    table.datetime('synced_at').notNullable().defaultTo(knex.fn.now());

    table.index(['id_usuario'], 'idx_prestador_ref_usuario');
  });

  /** Replica del servicio y de la categoria, para validar y mostrar. */
  await knex.schema.createTable('servicio_ref', (table) => {
    table.bigInteger('id_servicio').unsigned().primary();
    table.bigInteger('id_prestador').unsigned().notNullable();
    table.bigInteger('id_categoria').unsigned().notNullable();
    table.string('nombre_servicio', 150).notNullable();
    table.string('estado', 30).notNullable().defaultTo('ACTIVE');
    table.datetime('synced_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('categoria_ref', (table) => {
    table.bigInteger('id_categoria').unsigned().primary();
    table.string('nombre_categoria', 100).notNullable();
    table.boolean('activa').notNullable().defaultTo(true);
    table.datetime('synced_at').notNullable().defaultTo(knex.fn.now());
  });

  /**
   * Replica de la reputacion, que vive en pa_rating.
   *
   * RF146 exige listar las propuestas recibidas CON la reputacion del oferente,
   * y RF167 mostrar la del solicitante en el detalle de la necesidad. Sin esta
   * replica, pintar una lista de veinte propuestas costaria veinte llamadas
   * sincronas a rating-service, y la pagina dejaria de responder en cuanto ese
   * servicio se degradara —justo lo que RNF36 prohibe—.
   *
   * Se alimenta del evento de recalculo que publica el outbox de pa_rating.
   * Es un valor para MOSTRAR: ninguna decision de escritura depende de el.
   */
  await knex.schema.createTable('reputacion_ref', (table) => {
    table.bigInteger('id_usuario').unsigned().notNullable();
    table.string('faceta', 30).notNullable().comment('COMO_OFERENTE o COMO_SOLICITANTE');
    table.decimal('puntuacion_media', 3, 2).notNullable().defaultTo(0);
    table.integer('total_calificaciones').unsigned().notNullable().defaultTo(0);
    table.datetime('synced_at').notNullable().defaultTo(knex.fn.now());

    table.primary(['id_usuario', 'faceta']);
  });

  await knex.schema.createTable('necesidad', (table) => {
    primaryId(table, 'id_necesidad');
    table.string('titulo', 150).notNullable();
    table.text('descripcion').notNullable();
    table.bigInteger('id_usuario').unsigned().notNullable().comment('Solicitante autor');
    table.bigInteger('id_categoria').unsigned().notNullable();
    // DECIMAL y no FLOAT: el dinero no admite error de redondeo binario.
    table.decimal('presupuesto_estimado', 12, 2).nullable();
    table.date('fecha_deseada').nullable();
    table
      .string('ubicacion_aproximada', 150)
      .nullable()
      .comment('Granularidad minima necesaria; nunca una direccion exacta (SRS §10.5)');
    table.string('estado', 30).notNullable().defaultTo('ABIERTA');
    table.datetime('fecha_publicacion').notNullable().defaultTo(knex.fn.now());
    table.datetime('fecha_vigencia').notNullable();
    table.string('motivo_cierre', 255).nullable();
    auditFields(knex, table, { softDelete: true });

    table
      .foreign('id_usuario', 'fk_necesidad_usuario')
      .references('id_usuario')
      .inTable('usuario_ref')
      .onDelete('RESTRICT');
    table
      .foreign('id_categoria', 'fk_necesidad_categoria')
      .references('id_categoria')
      .inTable('categoria_ref')
      .onDelete('RESTRICT');

    // Listado publico de necesidades abiertas y vigentes (SRS RF130, RF134),
    // y barrido del proceso que vence las caducadas (SRS RF121).
    table.index(['estado', 'fecha_vigencia'], 'idx_necesidad_abiertas');
    // Limite de necesidades abiertas por usuario (SRS RF125) y "mis necesidades".
    table.index(['id_usuario', 'estado'], 'idx_necesidad_autor');
    table.index(['id_categoria', 'estado'], 'idx_necesidad_categoria');
  });

  await checkIn(knex, 'necesidad', 'estado', ESTADOS_NECESIDAD);

  // La vigencia posterior a la publicacion es un invariante (NEED-INV-002).
  await knex.raw(
    'ALTER TABLE `necesidad` ADD CONSTRAINT `chk_necesidad_vigencia` ' +
      'CHECK (`fecha_vigencia` > `fecha_publicacion`)'
  );
  await knex.raw(
    'ALTER TABLE `necesidad` ADD CONSTRAINT `chk_necesidad_presupuesto` ' +
      'CHECK (`presupuesto_estimado` IS NULL OR `presupuesto_estimado` > 0)'
  );

  await knex.raw(
    'ALTER TABLE `necesidad` ADD FULLTEXT INDEX `ft_necesidad_texto` (`titulo`, `descripcion`)'
  );

  await knex.schema.createTable('propuesta', (table) => {
    primaryId(table, 'id_propuesta');
    table.bigInteger('id_necesidad').unsigned().notNullable();
    table.bigInteger('id_prestador').unsigned().notNullable();
    table.decimal('precio', 12, 2).notNullable();
    table.integer('tiempo_estimado').unsigned().notNullable().comment('Dias');
    table.text('mensaje').notNullable();
    table
      .bigInteger('id_servicio')
      .nullable()
      .unsigned()
      .comment('Servicio propio adjuntado como referencia (SRS RF138)');
    table.string('estado', 30).notNullable().defaultTo('ENVIADA');
    table.datetime('fecha_envio').notNullable().defaultTo(knex.fn.now());
    auditFields(knex, table, { softDelete: true });

    table
      .foreign('id_necesidad', 'fk_propuesta_necesidad')
      .references('id_necesidad')
      .inTable('necesidad')
      .onDelete('CASCADE');
    table
      .foreign('id_prestador', 'fk_propuesta_prestador')
      .references('id_prestador')
      .inTable('prestador_ref')
      .onDelete('RESTRICT');
    table
      .foreign('id_servicio', 'fk_propuesta_servicio')
      .references('id_servicio')
      .inTable('servicio_ref')
      .onDelete('SET NULL');

    // "Las propuestas de esta necesidad", ordenadas (SRS RF146).
    table.index(['id_necesidad', 'estado'], 'idx_propuesta_necesidad');
    // "Mis propuestas" (SRS RF145).
    table.index(['id_prestador', 'estado'], 'idx_propuesta_prestador');
    // Limite de propuestas por ventana de tiempo (SRS RNF86).
    table.index(['id_prestador', 'fecha_envio'], 'idx_propuesta_ventana');
  });

  await checkIn(knex, 'propuesta', 'estado', ESTADOS_PROPUESTA);
  await knex.raw(
    'ALTER TABLE `propuesta` ADD CONSTRAINT `chk_propuesta_precio` CHECK (`precio` > 0)'
  );
  await knex.raw(
    'ALTER TABLE `propuesta` ADD CONSTRAINT `chk_propuesta_tiempo` CHECK (`tiempo_estimado` > 0)'
  );

  /**
   * "Una sola propuesta vigente por oferente y necesidad" (SRS RF139).
   *
   * La columna generada vale 1 mientras la propuesta esta ENVIADA y NULL en
   * cuanto deja de estarlo. MySQL considera distintos los NULL en un indice
   * unico, asi que la restriccion solo aplica a las vigentes: un oferente que
   * retiro su propuesta puede volver a proponer, pero no puede tener dos
   * esperando decision a la vez.
   */
  await knex.raw(
    "ALTER TABLE `propuesta` " +
      "ADD COLUMN `vigente` TINYINT(1) " +
      "AS (CASE WHEN `estado` = 'ENVIADA' THEN 1 ELSE NULL END) STORED, " +
      'ADD CONSTRAINT `uq_propuesta_vigente` UNIQUE (`id_necesidad`, `id_prestador`, `vigente`)'
  );

  /**
   * "Como maximo una propuesta adjudicada por necesidad" (NEED-AGGR-INV-008).
   *
   * `uq_propuesta_vigente` no cubre esto: solo restringe las ENVIADA. Sin esta
   * segunda restriccion, dos adjudicaciones concurrentes sobre la misma
   * necesidad podrian dejar dos propuestas en ACEPTADA, y la necesidad tendria
   * dos contrataciones. Es el invariante central del agregado y no puede
   * depender de que la aplicacion compruebe antes de escribir: dos
   * transacciones simultaneas comprobarian ambas que no hay ninguna adjudicada.
   *
   * Mismo patron que arriba: la columna generada vale 1 solo para la propuesta
   * aceptada y NULL para las demas, y MySQL trata los NULL como distintos.
   */
  await knex.raw(
    "ALTER TABLE `propuesta` " +
      "ADD COLUMN `adjudicada` TINYINT(1) " +
      "AS (CASE WHEN `estado` = 'ACEPTADA' THEN 1 ELSE NULL END) STORED, " +
      'ADD CONSTRAINT `uq_propuesta_adjudicada` UNIQUE (`id_necesidad`, `adjudicada`)'
  );
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('propuesta');
  await knex.schema.dropTableIfExists('necesidad');
  await knex.schema.dropTableIfExists('categoria_ref');
  await knex.schema.dropTableIfExists('servicio_ref');
  await knex.schema.dropTableIfExists('prestador_ref');
  await knex.schema.dropTableIfExists('usuario_ref');
};
