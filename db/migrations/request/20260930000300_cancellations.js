/**
 * pa_request — cancelaciones, incomparecencias y disputas.
 *
 * SRS: RF174-RF193, seccion 10.2.
 *
 * Cierra el riesgo R-009: hasta aqui el modelo no contemplaba que el Oferente
 * se retirara despues de aceptar, lo que dejaba al Solicitante sin recurso
 * justo en el caso mas danino, porque la adjudicacion ya descarto todas las
 * demas propuestas.
 *
 * La politica sigue el mecanismo de las plataformas de transporte —ventana de
 * gracia, peso por antelacion, motivos excusados, incomparecencia y umbrales
 * graduales— con una diferencia de fondo: aqui no hay cobro por cancelar,
 * porque el alcance excluye los pagos. Los unicos instrumentos son la
 * reputacion, la visibilidad y el acceso.
 */
'use strict';

const { primaryId, auditFields, checkIn } = require('../../helpers');

const PARTES = ['SOLICITANTE', 'OFERENTE', 'ADMINISTRADOR', 'SISTEMA'];

const FRANJAS = ['GRACIA', 'HOLGADA', 'AJUSTADA', 'TARDIA'];

const ESTADOS_CANCELACION = [
  'REGISTRADA', // computa o no segun el motivo, sin nada pendiente
  'EN_DISPUTA', // la contraparte impugno una incomparecencia
  'EN_REVISION', // escalada a un administrador
  'RESUELTA', // un administrador la confirmo o la reclasifico
];

/** Motivos y si computan por defecto. Los excusados exigen validacion o disputa. */
const MOTIVOS = [
  ['CONTRAPARTE_NO_SE_PRESENTO', false],
  ['CONTRAPARTE_LO_PIDIO', false],
  ['CONTRAPARTE_ILOCALIZABLE', false],
  ['RIESGO_PARA_LA_INTEGRIDAD', false],
  ['FUERZA_MAYOR', false],
  ['ALCANCE_DISTINTO_AL_PACTADO', false],
  ['YA_NO_LO_NECESITO', true],
  ['CONSEGUI_OTRA_OPCION', true],
  ['NO_PUEDO_ATENDERLO', true],
  ['ME_EQUIVOQUE_AL_ACEPTAR', true],
  ['PRECIO_O_PLAZO_INVIABLE', true],
  ['OTRO', true],
];

exports.up = async function up(knex) {
  /**
   * Catalogo de motivos. Es una tabla y no un CHECK porque los administradores
   * necesitan poder anadir un motivo sin desplegar una migracion, y porque cada
   * motivo lleva metadatos: si computa, si exige texto libre y si abre revision.
   */
  await knex.schema.createTable('motivo_cancelacion', (table) => {
    table.string('codigo', 40).primary();
    table.string('descripcion', 255).notNullable();
    table
      .boolean('computa')
      .notNullable()
      .comment('Si suma a la tasa de cancelacion de quien cancela');
    table
      .boolean('traslada_falta')
      .notNullable()
      .defaultTo(false)
      .comment('Si la falta pasa a la contraparte en lugar de a quien cancela');
    table
      .boolean('exige_validacion')
      .notNullable()
      .defaultTo(false)
      .comment('Si un administrador debe confirmarlo antes de que surta efecto');
    table.boolean('exige_detalle').notNullable().defaultTo(false);
    table.boolean('activo').notNullable().defaultTo(true);
    auditFields(knex, table);
  });

  await knex('motivo_cancelacion').insert(
    MOTIVOS.map(([codigo, computa]) => ({
      codigo,
      descripcion: codigo,
      computa,
      traslada_falta: codigo === 'CONTRAPARTE_NO_SE_PRESENTO',
      exige_validacion: ['FUERZA_MAYOR', 'ALCANCE_DISTINTO_AL_PACTADO', 'RIESGO_PARA_LA_INTEGRIDAD'].includes(codigo),
      exige_detalle: codigo === 'OTRO',
      activo: true,
    }))
  );

  /**
   * El hecho de la cancelacion.
   *
   * Vive separado de `solicitud_servicio` y no como columnas suyas porque tiene
   * su propio ciclo —disputa, revision, resolucion— y porque una solicitud
   * cancelada conserva su historial intacto: la cancelacion es un hecho nuevo,
   * no una modificacion del anterior.
   */
  await knex.schema.createTable('cancelacion', (table) => {
    primaryId(table, 'id_cancelacion');
    table.bigInteger('id_solicitud').unsigned().notNullable().unique();

    table.string('parte_canceladora', 20).notNullable().comment('Quien ejecuta la cancelacion');
    table
      .bigInteger('id_usuario_cancela')
      .unsigned()
      .notNullable()
      .comment('Usuario concreto; vive en pa_auth');
    table
      .bigInteger('id_usuario_afectado')
      .unsigned()
      .notNullable()
      .comment('La contraparte que sufre la cancelacion');

    table.string('estado_origen', 30).notNullable().comment('Estado de la solicitud al cancelar');
    table.string('codigo_motivo', 40).notNullable();
    table.string('detalle', 500).nullable().comment('Obligatorio cuando el motivo lo exige');

    // Clasificacion temporal (SRS 10.2.3).
    table.string('franja', 20).notNullable();
    table
      .integer('horas_de_antelacion')
      .nullable()
      .comment('Respecto de la fecha acordada; NULL si no habia fecha pactada');
    table
      .decimal('peso', 3, 2)
      .notNullable()
      .comment('Cuanto suma a la tasa: 0 en gracia, hasta 1.5 si es tardia');

    table
      .boolean('computa')
      .notNullable()
      .comment('Resultado de combinar motivo y franja; un administrador puede cambiarlo');
    table
      .bigInteger('id_usuario_imputado')
      .unsigned()
      .nullable()
      .comment('A quien se le carga; difiere de quien cancela si el motivo traslada la falta');

    table.string('estado', 20).notNullable().defaultTo('REGISTRADA');
    table.datetime('cancelada_at').notNullable().defaultTo(knex.fn.now());

    // Resolucion administrativa (RF191).
    table.bigInteger('resuelta_por').unsigned().nullable();
    table.datetime('resuelta_at').nullable();
    table.string('resolucion', 500).nullable();

    table
      .boolean('reabrio_necesidad')
      .notNullable()
      .defaultTo(false)
      .comment('RF184: si esta cancelacion devolvio la necesidad a ABIERTA');

    auditFields(knex, table);

    table
      .foreign('id_solicitud', 'fk_cancelacion_solicitud')
      .references('id_solicitud')
      .inTable('solicitud_servicio')
      .onDelete('RESTRICT');
    table
      .foreign('codigo_motivo', 'fk_cancelacion_motivo')
      .references('codigo')
      .inTable('motivo_cancelacion')
      .onDelete('RESTRICT');

    // La tasa se calcula sobre quien resulta imputado, en una ventana movil.
    table.index(['id_usuario_imputado', 'computa', 'cancelada_at'], 'idx_cancelacion_tasa');
    // Bandeja de revision administrativa.
    table.index(['estado', 'cancelada_at'], 'idx_cancelacion_revision');
  });

  await checkIn(knex, 'cancelacion', 'parte_canceladora', PARTES);
  await checkIn(knex, 'cancelacion', 'franja', FRANJAS);
  await checkIn(knex, 'cancelacion', 'estado', ESTADOS_CANCELACION);
  await knex.raw(
    'ALTER TABLE `cancelacion` ADD CONSTRAINT `chk_cancelacion_peso` ' +
      'CHECK (`peso` >= 0 AND `peso` <= 3)'
  );
  // Quien cancela y quien lo sufre no pueden ser la misma persona.
  await knex.raw(
    'ALTER TABLE `cancelacion` ADD CONSTRAINT `chk_cancelacion_partes` ' +
      'CHECK (`id_usuario_cancela` <> `id_usuario_afectado`)'
  );
  // Una cancelacion que computa tiene que tener a alguien imputado.
  await knex.raw(
    'ALTER TABLE `cancelacion` ADD CONSTRAINT `chk_cancelacion_imputado` ' +
      'CHECK (`computa` = 0 OR `id_usuario_imputado` IS NOT NULL)'
  );

  /**
   * Incomparecencias y su disputa (RF187-RF190).
   *
   * Separada de `cancelacion` porque se declara ANTES de que exista una
   * cancelacion: primero alguien afirma que la otra parte no se presento, y
   * solo cuando se confirma o vence el plazo de disputa se produce la
   * cancelacion con la falta ya asignada.
   */
  await knex.schema.createTable('incomparecencia', (table) => {
    primaryId(table, 'id_incomparecencia');
    table.bigInteger('id_solicitud').unsigned().notNullable();
    table.bigInteger('id_usuario_declara').unsigned().notNullable();
    table.bigInteger('id_usuario_senalado').unsigned().notNullable();
    table.string('detalle', 500).nullable();
    table.datetime('declarada_at').notNullable().defaultTo(knex.fn.now());
    table
      .datetime('disputable_hasta')
      .notNullable()
      .comment('Vencido el plazo sin disputa, la falta se da por aceptada');

    table.boolean('disputada').notNullable().defaultTo(false);
    table.datetime('disputada_at').nullable();
    table.string('argumento_disputa', 500).nullable();

    table
      .string('resultado', 20)
      .nullable()
      .comment('CONFIRMADA, DESESTIMADA o NULL mientras sigue abierta');
    table.bigInteger('resuelta_por').unsigned().nullable();
    table.datetime('resuelta_at').nullable();

    auditFields(knex, table);

    table
      .foreign('id_solicitud', 'fk_incomparecencia_solicitud')
      .references('id_solicitud')
      .inTable('solicitud_servicio')
      .onDelete('RESTRICT');

    // Una declaracion por parte y solicitud: ambas pueden acusarse mutuamente,
    // pero ninguna dos veces.
    table.unique(['id_solicitud', 'id_usuario_declara'], { indexName: 'uq_incomparecencia_parte' });
    // Proceso que cierra las no disputadas al vencer el plazo.
    table.index(['resultado', 'disputable_hasta'], 'idx_incomparecencia_vencimiento');
  });

  await knex.raw(
    'ALTER TABLE `incomparecencia` ADD CONSTRAINT `chk_incomparecencia_resultado` ' +
      "CHECK (`resultado` IS NULL OR `resultado` IN ('CONFIRMADA', 'DESESTIMADA'))"
  );
  await knex.raw(
    'ALTER TABLE `incomparecencia` ADD CONSTRAINT `chk_incomparecencia_partes` ' +
      'CHECK (`id_usuario_declara` <> `id_usuario_senalado`)'
  );

  /**
   * Restricciones activas (RF182).
   *
   * Es una proyeccion: la tasa de cancelacion la calcula y posee
   * rating-service, que publica el evento al cruzarse un umbral. Este servicio
   * guarda solo el efecto que debe aplicar, porque es quien recibe la peticion
   * de enviar una propuesta o publicar una necesidad y tiene que poder
   * rechazarla sin una llamada sincrona a otro servicio en el camino critico.
   */
  await knex.schema.createTable('restriccion_usuario', (table) => {
    primaryId(table, 'id_restriccion');
    table.bigInteger('id_usuario').unsigned().notNullable();
    table
      .string('tipo', 40)
      .notNullable()
      .comment('PROPUESTAS_BLOQUEADAS o NECESIDADES_LIMITADAS');
    table.integer('valor').unsigned().nullable().comment('Limite, cuando el tipo lo tiene');
    table.string('origen', 40).notNullable().defaultTo('TASA_CANCELACION');
    table.datetime('vigente_desde').notNullable().defaultTo(knex.fn.now());
    table.datetime('vigente_hasta').nullable().comment('NULL = sin fecha de fin');
    table.datetime('levantada_at').nullable();
    table.bigInteger('levantada_por').unsigned().nullable();
    auditFields(knex, table);

    // Comprobacion en el camino critico: "que restricciones tiene este usuario
    // ahora mismo".
    table.index(['id_usuario', 'levantada_at', 'vigente_hasta'], 'idx_restriccion_activas');
  });

  await checkIn(knex, 'restriccion_usuario', 'tipo', [
    'PROPUESTAS_BLOQUEADAS',
    'NECESIDADES_LIMITADAS',
    'CUENTA_EN_REVISION',
  ]);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('restriccion_usuario');
  await knex.schema.dropTableIfExists('incomparecencia');
  await knex.schema.dropTableIfExists('cancelacion');
  await knex.schema.dropTableIfExists('motivo_cancelacion');
};
