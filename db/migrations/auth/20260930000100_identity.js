/**
 * pa_auth — identidad: usuarios, roles y la relacion entre ambos.
 *
 * SRS: RF1-RF5 (registro), RF15-RF19 (roles), RF159-RF163 (roles simultaneos),
 *      RF97-RF100 (gestion administrativa de cuentas).
 *
 * Decision central: los roles NO son una columna de `usuario`. El modelo previo
 * usaba `tipo_usuario VARCHAR`, lo que obligaba a quien ofrece y ademas necesita
 * servicios a abrir dos cuentas, partiendo su reputacion en dos identidades
 * (SRS RF159, USER-INV-008).
 */
'use strict';

const { primaryId, auditFields, checkIn } = require('../../helpers');

const ESTADOS_CUENTA = ['ACTIVO', 'SUSPENDIDO', 'INACTIVO'];

exports.up = async function up(knex) {
  await knex.schema.createTable('rol', (table) => {
    primaryId(table, 'id_rol');
    table.string('nombre_rol', 30).notNullable().unique();
    table.string('descripcion', 255).nullable();
    auditFields(knex, table);
  });

  await knex.schema.createTable('usuario', (table) => {
    primaryId(table, 'id_usuario');
    table.string('nombre', 100).notNullable();
    // La unicidad del correo es una regla de negocio (SRS RF4, USER-INV-002),
    // por eso la impone la base de datos y no solo la capa de aplicacion.
    table.string('correo', 150).notNullable().unique();
    table
      .string('contrasena_hash', 255)
      .notNullable()
      .comment('Argon2id. Jamas texto plano ni un hash reversible (SRS RNF21)');
    table.string('telefono', 20).nullable();
    table.string('estado', 30).notNullable().defaultTo('ACTIVO');
    table.string('motivo_suspension', 255).nullable();
    table.datetime('ultimo_acceso_at').nullable();
    auditFields(knex, table, { softDelete: true });

    // No se anade indice por correo: la restriccion UNIQUE de mas arriba ya
    // crea uno, y el login devuelve como mucho una fila, asi que filtrar
    // deleted_at sobre ese unico resultado no necesita indice. Un segundo
    // indice solo anadiria coste a cada escritura.
    table.index(['estado'], 'idx_usuario_estado');
  });

  await checkIn(knex, 'usuario', 'estado', ESTADOS_CUENTA);

  await knex.schema.createTable('usuario_rol', (table) => {
    table.bigInteger('id_usuario').unsigned().notNullable();
    table.bigInteger('id_rol').unsigned().notNullable();
    table.datetime('asignado_en').notNullable().defaultTo(knex.fn.now());
    table
      .bigInteger('asignado_por')
      .unsigned()
      .nullable()
      .comment('Administrador que concedio el rol; NULL para el rol de alta automatica');

    // La clave compuesta es la que impide asignar dos veces el mismo rol.
    table.primary(['id_usuario', 'id_rol']);

    table
      .foreign('id_usuario', 'fk_usuario_rol_usuario')
      .references('id_usuario')
      .inTable('usuario')
      .onDelete('CASCADE');
    table
      .foreign('id_rol', 'fk_usuario_rol_rol')
      .references('id_rol')
      .inTable('rol')
      .onDelete('RESTRICT');
    table
      .foreign('asignado_por', 'fk_usuario_rol_asignador')
      .references('id_usuario')
      .inTable('usuario')
      .onDelete('SET NULL');

    // "Que roles tiene este usuario" se resuelve con la clave primaria;
    // "que usuarios tienen este rol" necesita el indice inverso.
    table.index(['id_rol'], 'idx_usuario_rol_inverso');
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('usuario_rol');
  await knex.schema.dropTableIfExists('usuario');
  await knex.schema.dropTableIfExists('rol');
};
