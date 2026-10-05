/**
 * Marca de re-emision en la outbox (A-4).
 *
 * `reemit_of` guarda el `event_id` del evento original cuando la fila es una
 * repeticion creada por `db/cli.js reemit`. Es `NULL` en todos los eventos que
 * escriben los servicios.
 *
 * **Por que una columna y no deducirlo de `causation_id`.**
 *
 * La primera version de este modulo reconocia las repeticiones porque su
 * `causation_id` apuntara a un `event_id` que existe en la misma outbox. Con los
 * datos actuales eso funciona, y aun asi es incorrecto, por dos razones que conviene
 * dejar escritas.
 *
 * La primera es que funciona por casualidad. `causation_id` esta definida en el
 * esquema pero ningun servicio la escribe: en los datos de desarrollo las unicas
 * filas que la traen son las copias que creo este mismo comando. El filtro no
 * estaba acertando, estaba aprovechando que el campo no se usa.
 *
 * La segunda es que los dos campos significan cosas distintas. `causation_id` es
 * causalidad de negocio —en un flujo, un evento lo causa otro—. Si algun servicio
 * empieza a usarla, que es justo para lo que existe, el filtro descartaria en
 * silencio los eventos encadenados, que son los que reconstruct `prestador_ref`:
 * reemitir unicamente los que no tienen causa es justo no poder rehacer el
 * catalogo. Un filtro que parece conservador y en realidad pierde informacion es
 * peor que no tener filtro.
 *
 * Con la columna, distinguir una repeticion es un `IS NULL` y no una conjetura.
 */

'use strict';

const NOMBRE_TABLA = 'outbox_event';

exports.up = async function up(knex) {
  const existe = await knex.schema.hasTable(NOMBRE_TABLA);
  if (!existe) return;

  await knex.schema.alterTable(NOMBRE_TABLA, (tabla) => {
    // Indice parcial no existe en MySQL, pero el filtro real es `IS NULL` y
    // MySQL si usa indice para ese caso, asi que basta con indexar la columna.
    tabla.string('reemit_of', 36).nullable().index();
  });
};

exports.down = async function down(knex) {
  const existe = await knex.schema.hasTable(NOMBRE_TABLA);
  if (!existe) return;

  await knex.schema.alterTable(NOMBRE_TABLA, (tabla) => {
    tabla.dropIndex(['reemit_of']);
    tabla.dropColumn('reemit_of');
  });
};
