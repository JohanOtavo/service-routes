/**
 * pa_auth — sesiones, recuperacion de contrasena y bloqueo por intentos fallidos.
 *
 * SRS: RF6-RF14 (login, logout, expiracion, recuperacion), RF20 (registro de
 *      eventos de autenticacion), RNF22 (JWT).
 *
 * Nota de alcance: el bloqueo progresivo (tabla `login_attempt`) NO estaba en el
 * SRS. Lo exige el brief de construccion y queda documentado como RF propuesto,
 * no colado en silencio.
 */
'use strict';

const { primaryId } = require('../../helpers');

exports.up = async function up(knex) {
  /**
   * Refresh tokens rotativos. Se guarda el hash, no el token: si alguien lee
   * esta tabla no puede suplantar a nadie.
   *
   * `reemplazado_por` encadena la rotacion. Si un token ya rotado vuelve a
   * usarse, es senal de robo y hay que revocar toda la cadena.
   */
  await knex.schema.createTable('refresh_session', (table) => {
    primaryId(table, 'id_sesion');
    table.bigInteger('id_usuario').unsigned().notNullable();
    table
      .string('token_hash', 255)
      .notNullable()
      .unique()
      .comment('SHA-256 del refresh token; el valor en claro solo existe en la cookie');
    table.datetime('emitido_at').notNullable().defaultTo(knex.fn.now());
    table.datetime('expira_at').notNullable();
    table.datetime('revocado_at').nullable();
    table.string('motivo_revocacion', 60).nullable();
    table
      .bigInteger('reemplazado_por')
      .unsigned()
      .nullable()
      .comment('Sesion que sustituyo a esta al rotar; detecta reuso de un token robado');
    table.string('user_agent', 255).nullable();
    table.string('ip_origen', 45).nullable().comment('Soporta IPv6');

    table
      .foreign('id_usuario', 'fk_refresh_usuario')
      .references('id_usuario')
      .inTable('usuario')
      .onDelete('CASCADE');
    table
      .foreign('reemplazado_por', 'fk_refresh_rotacion')
      .references('id_sesion')
      .inTable('refresh_session')
      .onDelete('SET NULL');

    // Cerrar sesion en todos los dispositivos: buscar las activas del usuario.
    table.index(['id_usuario', 'revocado_at'], 'idx_refresh_activas');
    // Purga de sesiones vencidas.
    table.index(['expira_at'], 'idx_refresh_expiracion');
  });

  /**
   * Token de recuperacion de contrasena: un solo uso y vigencia corta
   * (SRS RF13, RF14). Tambien se almacena hasheado.
   */
  await knex.schema.createTable('password_recovery_token', (table) => {
    primaryId(table, 'id_token');
    table.bigInteger('id_usuario').unsigned().notNullable();
    table.string('token_hash', 255).notNullable().unique();
    table.datetime('emitido_at').notNullable().defaultTo(knex.fn.now());
    table.datetime('expira_at').notNullable();
    table
      .datetime('usado_at')
      .nullable()
      .comment('Con valor, el token ya se consumio y debe rechazarse (SRS RF14)');

    table
      .foreign('id_usuario', 'fk_recovery_usuario')
      .references('id_usuario')
      .inTable('usuario')
      .onDelete('CASCADE');

    table.index(['id_usuario', 'usado_at'], 'idx_recovery_usuario');
    table.index(['expira_at'], 'idx_recovery_expiracion');
  });

  /**
   * Lista de denegacion de access tokens (SRS RF10).
   *
   * El JWT es autocontenido: sin esta lista, un token robado seguiria siendo
   * valido hasta expirar aunque el usuario cerrara sesion. Solo guarda el
   * identificador del token (jti), nunca el token completo.
   *
   * Redis lleva la copia caliente que consulta el gateway; esta tabla es la
   * fuente durable que sobrevive a un reinicio de Redis.
   */
  await knex.schema.createTable('token_denylist', (table) => {
    table.string('jti', 36).primary().comment('Identificador del access token revocado');
    table.bigInteger('id_usuario').unsigned().notNullable();
    table.datetime('revocado_at').notNullable().defaultTo(knex.fn.now());
    table
      .datetime('expira_at')
      .notNullable()
      .comment('Expiracion natural del token; despues la fila puede purgarse');

    table
      .foreign('id_usuario', 'fk_denylist_usuario')
      .references('id_usuario')
      .inTable('usuario')
      .onDelete('CASCADE');

    table.index(['expira_at'], 'idx_denylist_purga');
  });

  /**
   * Intentos de autenticacion, para el bloqueo progresivo.
   *
   * Registra exitos y fallos: los exitos alimentan la auditoria (SRS RF20) y
   * los fallos el calculo del bloqueo. Guarda el correo tal como se tecleo,
   * porque un intento contra una cuenta inexistente tambien interesa.
   *
   * No guarda la contrasena probada, ni siquiera hasheada.
   */
  await knex.schema.createTable('login_attempt', (table) => {
    primaryId(table, 'id_intento');
    table
      .string('correo_intentado', 150)
      .notNullable()
      .comment('Correo tecleado; puede no corresponder a ninguna cuenta');
    table
      .bigInteger('id_usuario')
      .unsigned()
      .nullable()
      .comment('Resuelto solo si la cuenta existe');
    table.boolean('exitoso').notNullable();
    table.string('ip_origen', 45).nullable();
    table.string('user_agent', 255).nullable();
    table.datetime('intentado_at').notNullable().defaultTo(knex.fn.now());

    table
      .foreign('id_usuario', 'fk_intento_usuario')
      .references('id_usuario')
      .inTable('usuario')
      .onDelete('SET NULL');

    // Consulta del bloqueo: fallos recientes de este correo y de esta IP.
    table.index(['correo_intentado', 'exitoso', 'intentado_at'], 'idx_intento_correo');
    table.index(['ip_origen', 'exitoso', 'intentado_at'], 'idx_intento_ip');
    // La tabla crece con cada intento; su purga por antiguedad necesita empezar
    // por la fecha, no terminar en ella.
    table.index(['intentado_at'], 'idx_intento_purga');
  });

  /**
   * Estado vigente del bloqueo, derivado de `login_attempt`.
   *
   * Se materializa en su propia tabla en lugar de recalcularlo en cada login:
   * la comprobacion ocurre en el camino critico de la autenticacion y debe ser
   * una lectura por clave primaria, no un COUNT sobre un historial que crece.
   * Es una desnormalizacion deliberada y justificada.
   */
  await knex.schema.createTable('login_lockout', (table) => {
    table.string('correo', 150).primary();
    table.integer('fallos_consecutivos').unsigned().notNullable().defaultTo(0);
    table
      .datetime('bloqueado_hasta')
      .nullable()
      .comment('NULL = sin bloqueo. El retardo crece con cada fallo sucesivo');
    table.datetime('ultimo_fallo_at').nullable();
    table.datetime('updated_at').notNullable().defaultTo(knex.raw('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'));
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('login_lockout');
  await knex.schema.dropTableIfExists('login_attempt');
  await knex.schema.dropTableIfExists('token_denylist');
  await knex.schema.dropTableIfExists('password_recovery_token');
  await knex.schema.dropTableIfExists('refresh_session');
};
