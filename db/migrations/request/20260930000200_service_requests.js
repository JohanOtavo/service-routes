/**
 * pa_request — solicitudes de servicio e historial de estados.
 *
 * SRS: RF54-RF77, RF150-RF158.
 *
 * Los dos caminos de intermediacion convergen aqui. `origen` distingue si la
 * solicitud nacio de una busqueda en el catalogo (DIRECTA) o de adjudicar una
 * propuesta (ADJUDICACION), y el CHECK impide que las referencias contradigan
 * al origen declarado (REQUEST-INV-003).
 */
'use strict';

const {
  primaryId,
  auditFields,
  checkIn,
  createOutbox,
  createProcessedEvents,
} = require('../../helpers');

const ESTADOS_SOLICITUD = ['PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'COMPLETADA', 'CANCELADA'];
const ORIGENES = ['DIRECTA', 'ADJUDICACION'];

exports.up = async function up(knex) {
  await knex.schema.createTable('solicitud_servicio', (table) => {
    primaryId(table, 'id_solicitud');
    table.string('estado', 30).notNullable().defaultTo('PENDIENTE');
    table.string('origen', 20).notNullable().defaultTo('DIRECTA');
    table.text('descripcion_problema').notNullable();

    table.bigInteger('id_usuario').unsigned().notNullable().comment('Solicitante');
    table
      .bigInteger('id_prestador')
      .unsigned()
      .notNullable()
      .comment('Explicito: en una adjudicacion no siempre hay servicio del que derivarlo');

    // Nullables: cual de los tres aplica lo decide `origen`.
    table.bigInteger('id_servicio').unsigned().nullable();
    table.bigInteger('id_necesidad').unsigned().nullable();
    table.bigInteger('id_propuesta').unsigned().nullable();

    // Copiados de la propuesta al adjudicar y congelados (REQUEST-INV-009).
    // Se registran aunque el sistema no cobre: sin este dato, cualquier via de
    // ingreso futura exigiria migrar el historico (SRS §7.6).
    table.decimal('valor_acordado', 12, 2).nullable();
    table.integer('plazo_acordado').unsigned().nullable().comment('Dias');

    table.datetime('fecha_solicitud').notNullable().defaultTo(knex.fn.now());
    table.datetime('fecha_completada').nullable();
    table.string('motivo_estado', 255).nullable().comment('Motivo del rechazo o la cancelacion');
    auditFields(knex, table, { softDelete: true });

    table
      .foreign('id_usuario', 'fk_solicitud_usuario')
      .references('id_usuario')
      .inTable('usuario_ref')
      .onDelete('RESTRICT');
    table
      .foreign('id_prestador', 'fk_solicitud_prestador')
      .references('id_prestador')
      .inTable('prestador_ref')
      .onDelete('RESTRICT');
    table
      .foreign('id_servicio', 'fk_solicitud_servicio')
      .references('id_servicio')
      .inTable('servicio_ref')
      .onDelete('RESTRICT');
    table
      .foreign('id_necesidad', 'fk_solicitud_necesidad')
      .references('id_necesidad')
      .inTable('necesidad')
      .onDelete('RESTRICT');
    table
      .foreign('id_propuesta', 'fk_solicitud_propuesta')
      .references('id_propuesta')
      .inTable('propuesta')
      .onDelete('RESTRICT');

    // "Mis solicitudes" como solicitante y como oferente (SRS RF60, RF61).
    table.index(['id_usuario', 'estado'], 'idx_solicitud_solicitante');
    table.index(['id_prestador', 'estado'], 'idx_solicitud_oferente');
    // Cancelacion en cascada cuando un servicio se desactiva (SRS RF70).
    table.index(['id_servicio', 'estado'], 'idx_solicitud_servicio');
    // Reportes por estado y rango de fechas (SRS RF111, RF113).
    table.index(['estado', 'fecha_solicitud'], 'idx_solicitud_reportes');
  });

  await checkIn(knex, 'solicitud_servicio', 'estado', ESTADOS_SOLICITUD);
  await checkIn(knex, 'solicitud_servicio', 'origen', ORIGENES);

  /**
   * El origen determina que referencias deben existir (REQUEST-INV-003).
   * Sin este CHECK, la aplicacion podria crear una solicitud "por adjudicacion"
   * sin propuesta, y nada en la base de datos lo impediria.
   */
  await knex.raw(
    'ALTER TABLE `solicitud_servicio` ADD CONSTRAINT `chk_solicitud_origen` CHECK (' +
      "(`origen` = 'DIRECTA' AND `id_servicio` IS NOT NULL " +
      'AND `id_necesidad` IS NULL AND `id_propuesta` IS NULL) OR ' +
      "(`origen` = 'ADJUDICACION' AND `id_necesidad` IS NOT NULL " +
      'AND `id_propuesta` IS NOT NULL))'
  );

  /**
   * El estado inicial depende del origen (REQUEST-INV-004).
   *
   * `estado` lleva DEFAULT 'PENDIENTE', que es lo correcto para una solicitud
   * directa y lo incorrecto para una adjudicacion: ahi el acuerdo YA se alcanzo
   * al aceptar la propuesta, y pasar por PENDIENTE significaria pedirle al
   * oferente que acepte algo que el mismo propuso. Olvidar el estado explicito
   * al insertar dejaria la contratacion esperando una aprobacion que nadie va a
   * dar, y el CHECK lo impide.
   */
  await knex.raw(
    'ALTER TABLE `solicitud_servicio` ADD CONSTRAINT `chk_solicitud_estado_origen` CHECK (' +
      "NOT (`origen` = 'ADJUDICACION' AND `estado` = 'PENDIENTE'))"
  );

  // Una propuesta adjudicada produce como mucho una contratacion.
  await knex.raw(
    'ALTER TABLE `solicitud_servicio` ADD CONSTRAINT `uq_solicitud_propuesta` UNIQUE (`id_propuesta`)'
  );

  await knex.raw(
    'ALTER TABLE `solicitud_servicio` ADD CONSTRAINT `chk_solicitud_valor` ' +
      'CHECK (`valor_acordado` IS NULL OR `valor_acordado` > 0)'
  );

  /**
   * Historial de cambios de estado. Append-only: se escribe en la MISMA
   * transaccion que el cambio (SRS RF74) y no se modifica jamas (SRS RF77).
   */
  await knex.schema.createTable('historial_solicitud', (table) => {
    primaryId(table, 'id_historial');
    table.bigInteger('id_solicitud').unsigned().notNullable();
    table.string('estado_anterior', 30).nullable().comment('NULL en la creacion');
    table.string('estado_nuevo', 30).notNullable();
    table.datetime('fecha_cambio').notNullable().defaultTo(knex.fn.now());
    table
      .bigInteger('cambiado_por')
      .unsigned()
      .notNullable()
      .comment('Usuario que provoco el cambio; vive en pa_auth');
    table.string('motivo', 255).nullable();

    table
      .foreign('id_solicitud', 'fk_historial_solicitud')
      .references('id_solicitud')
      .inTable('solicitud_servicio')
      .onDelete('CASCADE');

    table.index(['id_solicitud', 'fecha_cambio'], 'idx_historial_solicitud');
  });

  // El historial es la evidencia del ciclo de vida: si admite estados que no
  // existen, deja de ser fiable como traza (SRS RF71-RF77).
  await checkIn(knex, 'historial_solicitud', 'estado_nuevo', ESTADOS_SOLICITUD);
  await knex.raw(
    'ALTER TABLE `historial_solicitud` ADD CONSTRAINT `chk_historial_estado_anterior` CHECK (' +
      '`estado_anterior` IS NULL OR `estado_anterior` IN (' +
      ESTADOS_SOLICITUD.map((e) => `'${e}'`).join(', ') +
      '))'
  );

  /**
   * Claves de idempotencia (SRS RF68, SRS-DIST-05).
   *
   * Sin esto, un reintento del cliente tras un tiempo de espera agotado crearia
   * una segunda solicitud o adjudicaria dos veces. La respuesta original se
   * guarda para devolverla tal cual ante la repeticion.
   */
  await knex.schema.createTable('idempotency_key', (table) => {
    // El usuario forma parte de la clave primaria, y no es opcional.
    //
    // La clave de idempotencia la elige el CLIENTE. Si dos usuarios envian la
    // misma cadena para la misma operacion —algo tan probable como 'retry-1'—
    // y el usuario no acota la clave, el segundo encuentra la fila del primero
    // y recibe SU respuesta almacenada: una solicitud ajena, con los datos de
    // contacto de otra persona. Acotar por usuario lo convierte en imposible.
    table.bigInteger('id_usuario').unsigned().notNullable();
    table.string('idempotency_key', 64).notNullable();
    table.string('operacion', 60).notNullable();
    table
      .string('request_hash', 64)
      .notNullable()
      .comment('Detecta la misma clave con otro cuerpo');
    table.json('respuesta').nullable();
    table.integer('status_http').unsigned().nullable();
    table.datetime('creado_at').notNullable().defaultTo(knex.fn.now());
    table.datetime('expira_at').notNullable();

    table.primary(['id_usuario', 'idempotency_key', 'operacion']);
    table.index(['expira_at'], 'idx_idempotency_purga');
  });

  await createOutbox(knex);
  await createProcessedEvents(knex);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('processed_event');
  await knex.schema.dropTableIfExists('outbox_event');
  await knex.schema.dropTableIfExists('idempotency_key');
  await knex.schema.dropTableIfExists('historial_solicitud');
  await knex.schema.dropTableIfExists('solicitud_servicio');
};
