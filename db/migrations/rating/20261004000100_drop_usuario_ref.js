/**
 * pa_rating — retira `usuario_ref`, que se creo y nunca se escribio.
 *
 * Cierra A-5 del backlog. El razonamiento completo esta en la migracion gemela
 * de provider, `20261004000100_drop_usuario_ref.js`, y es el mismo caso.
 *
 * Aqui la tabla es todavia mas evidentemente inutil: `tasa_cancelacion` y
 * `cancelacion_ref` guardan `id_usuario` y `id_usuario_imputado` como
 * **numeros sueltos**, sin FK y sin consultar esta tabla. rating-service solo
 * se suscribe a `request.solicitud.*`, y ninguno de esos eventos lleva el nombre
 * del usuario, asi que no hay de donde llenarla ni para que serviria.
 *
 * El efecto de quitarla es que `id_usuario` en esas dos tablas queda sin
 * resolucion local. Es el estado correcto y ya es el real: hoy esa tabla esta
 * vacia y las consultas funcionan igual.
 */
'use strict';

const { createUsuarioRef } = require('../../helpers');

exports.up = async function up(knex) {
  await knex.schema.dropTableIfExists('usuario_ref');
};

exports.down = async function down(knex) {
  await createUsuarioRef(knex);
};
