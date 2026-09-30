/**
 * pa_auth — outbox de eventos de identidad.
 *
 * Publica: UserRegistered, UserAuthenticated, UserRoleAssigned,
 *          UserProfileUpdated, UserAccountSuspended (SRS RF14 del modulo, RF20).
 *
 * auth-service no consume eventos de nadie, asi que no necesita processed_event:
 * es la raiz del grafo de dependencias.
 */
'use strict';

const { createOutbox } = require('../../helpers');

exports.up = async function up(knex) {
  await createOutbox(knex);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('outbox_event');
};
