/**
 * pa_admin — auditoria, moderacion, reportes y control de respaldos.
 *
 * SRS: RF101-RF116, RNF81, RNF88.
 *
 * Todo lo que hay aqui se construye consumiendo eventos: este servicio nunca
 * consulta la base de datos de otro (SRS RF108). La auditoria es inmutable, de
 * modo que no se expone actualizacion ni borrado (SRS RF103).
 */
'use strict';

const {
  primaryId,
  auditFields,
  checkIn,
  createOutbox,
  createProcessedEvents,
} = require('../../helpers');

const RESULTADOS = ['EXITO', 'FALLO', 'DENEGADO'];
const TIPOS_CONTENIDO = ['SERVICIO', 'NECESIDAD', 'PROPUESTA', 'PERFIL', 'COMENTARIO'];

exports.up = async function up(knex) {
  /**
   * Registro de auditoria. Append-only, sin borrado logico: una fila que puede
   * desaparecer no sirve como evidencia.
   */
  await knex.schema.createTable('audit_record', (table) => {
    primaryId(table, 'id_auditoria');
    table.datetime('ocurrido_at').notNullable().comment('Cuando paso, no cuando se registro');
    table.datetime('registrado_at').notNullable().defaultTo(knex.fn.now());
    table.bigInteger('id_actor').unsigned().nullable().comment('NULL si lo hizo el sistema');
    table.string('actor_rol', 30).nullable();
    table.string('accion', 80).notNullable();
    table.string('recurso_tipo', 40).notNullable();
    table.string('recurso_id', 64).nullable();
    table.string('resultado', 20).notNullable();
    table
      .string('correlation_id', 36)
      .nullable()
      .comment('Enlaza la entrada con los registros de los demas servicios');
    table
      .json('detalle')
      .nullable()
      .comment('Contexto de la accion. Nunca contrasenas, tokens ni datos personales de mas');
    table.string('ip_origen', 45).nullable();

    // Filtros de consulta de la auditoria (SRS RF102).
    table.index(['ocurrido_at'], 'idx_auditoria_fecha');
    table.index(['id_actor', 'ocurrido_at'], 'idx_auditoria_actor');
    table.index(['accion', 'ocurrido_at'], 'idx_auditoria_accion');
    table.index(['recurso_tipo', 'recurso_id', 'ocurrido_at'], 'idx_auditoria_recurso');
    // La columna existe para reconstruir una operacion a traves de los servicios
    // (RNF78); sin indice, esa reconstruccion recorre la tabla entera.
    table.index(['correlation_id'], 'idx_auditoria_correlacion');
  });

  await checkIn(knex, 'audit_record', 'resultado', RESULTADOS);

  /**
   * Inmutabilidad de la auditoria, impuesta por la base de datos.
   *
   * RF103 y RNF81 exigen que la auditoria no se pueda modificar ni borrar. No
   * exponer esas operaciones en la API no basta: el usuario pa_admin_svc tiene
   * UPDATE y DELETE sobre todo su esquema, asi que un error de programacion o
   * una consulta manual bastarian para alterar la evidencia, que es
   * precisamente lo que la auditoria existe para impedir.
   *
   * Estos disparadores convierten la regla en algo que el motor hace cumplir.
   * La purga por retencion, cuando se defina, tendra que eliminarlos de forma
   * explicita y deliberada.
   */
  await knex.raw(`
    CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_record
    FOR EACH ROW SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'audit_record es inmutable: no admite UPDATE (SRS RF103)'
  `);

  await knex.raw(`
    CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_record
    FOR EACH ROW SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'audit_record es inmutable: no admite DELETE (SRS RF103)'
  `);

  /** Moderacion de contenido inapropiado (SRS RF104). */
  await knex.schema.createTable('content_moderation', (table) => {
    primaryId(table, 'id_moderacion');
    table.string('recurso_tipo', 40).notNullable();
    table.bigInteger('recurso_id').unsigned().notNullable();
    table.bigInteger('reportado_por').unsigned().nullable();
    table.bigInteger('moderado_por').unsigned().notNullable().comment('Administrador');
    table.string('motivo', 500).notNullable();
    table.boolean('retirado').notNullable().defaultTo(true);
    table.datetime('moderado_at').notNullable().defaultTo(knex.fn.now());

    table.index(['recurso_tipo', 'recurso_id'], 'idx_moderacion_recurso');
    table.index(['moderado_at'], 'idx_moderacion_fecha');
  });

  await checkIn(knex, 'content_moderation', 'recurso_tipo', TIPOS_CONTENIDO);

  /**
   * Proyeccion de indicadores (SRS §7.5, RF109-RF115).
   *
   * Instantaneas precalculadas por dia y dimension. Los reportes agregan sobre
   * millones de eventos; resolverlos en tiempo real cada vez que un
   * administrador abre el panel no escala.
   */
  await knex.schema.createTable('statistics_snapshot', (table) => {
    primaryId(table, 'id_snapshot');
    table.date('fecha').notNullable();
    table.string('metrica', 60).notNullable().comment('necesidades_publicadas, tasa_cobertura...');
    // 'TOTAL' como centinela y no NULL: MySQL considera distintos los NULL en
    // un indice unico, asi que con NULL la restriccion uq_snapshot_punto no
    // impediria insertar el total del mismo dia dos veces, que es justo el caso
    // que un recalculo diario produce.
    table
      .string('dimension', 60)
      .notNullable()
      .defaultTo('TOTAL')
      .comment("Categoria, rol o estado; 'TOTAL' para el agregado sin desglose");
    table.decimal('valor', 14, 4).notNullable();
    table.datetime('calculado_at').notNullable().defaultTo(knex.fn.now());

    // Un valor por metrica, dimension y dia: recalcular sustituye, no duplica.
    table.unique(['fecha', 'metrica', 'dimension'], { indexName: 'uq_snapshot_punto' });
    table.index(['metrica', 'fecha'], 'idx_snapshot_serie');
  });

  /** Ejecucion de respaldos (SRS RF106, RF107, RNF74). */
  await knex.schema.createTable('backup_record', (table) => {
    primaryId(table, 'id_respaldo');
    table.string('esquema', 40).notNullable();
    table.datetime('iniciado_at').notNullable();
    table.datetime('finalizado_at').nullable();
    table.boolean('exitoso').nullable().comment('NULL mientras esta en curso');
    table.bigInteger('tamano_bytes').unsigned().nullable();
    table.string('ubicacion', 255).nullable();
    table.string('error', 500).nullable();
    table.datetime('restauracion_probada_at').nullable().comment('SRS RNF74');

    table.index(['esquema', 'iniciado_at'], 'idx_respaldo_esquema');
  });

  /** Parametros del sistema (SRS RF105). */
  await knex.schema.createTable('system_parameter', (table) => {
    table.string('clave', 80).primary();
    table.string('valor', 500).notNullable();
    table.string('descripcion', 255).nullable();
    table.string('tipo_dato', 20).notNullable().defaultTo('string');
    auditFields(knex, table);
  });

  // Publica InappropriateContentRemoved y las alertas administrativas.
  await createOutbox(knex);
  await createProcessedEvents(knex);
};

exports.down = async function down(knex) {
  // Los disparadores primero: una tabla con disparadores vivos no se suelta.
  await knex.raw('DROP TRIGGER IF EXISTS trg_audit_no_delete');
  await knex.raw('DROP TRIGGER IF EXISTS trg_audit_no_update');

  await knex.schema.dropTableIfExists('processed_event');
  await knex.schema.dropTableIfExists('outbox_event');
  await knex.schema.dropTableIfExists('system_parameter');
  await knex.schema.dropTableIfExists('backup_record');
  await knex.schema.dropTableIfExists('statistics_snapshot');
  await knex.schema.dropTableIfExists('content_moderation');
  await knex.schema.dropTableIfExists('audit_record');
};
