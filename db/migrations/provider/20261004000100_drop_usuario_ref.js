/**
 * pa_provider — retira `usuario_ref`, que se creo y nunca se escribio.
 *
 * Cierra A-5 del backlog.
 *
 * La tabla se declaro en `20260930000100_provider.js` copiando el patron de
 * `pa_request` y `pa_notification`, donde si hace falta: alli hay tablas que la
 * usan como clave foranea. Aqui no hay **ninguna**. Ni una sola tabla de este
 * esquema declara FK contra `usuario_ref`, y ningun proceso la escribe:
 * provider-service no se suscribe a `UserRegistered`, solo a
 * `iam.usuario.user_account_suspended`, que no la replica porque no necesita el
 * nombre.
 *
 * Es andamiaje declarado y nunca usado. Se retira porque su coste no es el
 * espacio: es que cualquier herramienta que sacque la lista de tablas que
 * replican usuarios -la comprobacion de orfandad de A-1, el grafo de eventos,
 * el runbook de reconstruccion de A-4- la cuenta como una replica mas, y una
 * replica que no se puede reconstruir porque nadie la escribe es exactamente el
 * defecto que esas herramientas existen para detectar.
 *
 * Si algun dia este servicio necesita datos de usuario, no se restaura esta
 * tabla: se consulta a su dueno, `pa_auth`, por API. Replicar datos de otro
 * esquema para no hacer una llamada es la decision que el SRS RNF54 desaconseja
 * de forma explicita.
 *
 * `down` la vuelve a crear para que `node db/cli.js reset` siga siendo
 * reversible: el patron de este repositorio es que toda migracion se deshace.
 */
'use strict';

const { createUsuarioRef } = require('../../helpers');

exports.up = async function up(knex) {
  await knex.schema.dropTableIfExists('usuario_ref');
};

exports.down = async function down(knex) {
  await createUsuarioRef(knex);
};
