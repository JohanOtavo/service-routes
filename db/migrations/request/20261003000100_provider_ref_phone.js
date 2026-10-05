/**
 * pa_request — `prestador_ref.telefono`.
 *
 * Recupera una migracion que se aplico en los entornos de desarrollo y nunca llego
 * al repositorio. Ver la nota de estado del final.
 *
 * Anade el telefono de contacto del prestador a la replica local. No hay clave
 * foranea ni nada que dependa de la columna: `prestador_ref` es una copia de
 * datos de `pa_provider`, que es de otro esquema, y por eso no puede referenciarlo.
 */
'use strict';

exports.up = async function up(knex) {
  await knex.schema.alterTable('prestador_ref', (table) => {
    table
      .string('telefono', 20)
      .nullable()
      .comment('Telefono de contacto declarado por el prestador; sin FK, es otro esquema');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('prestador_ref', (table) => {
    table.dropColumn('telefono');
  });
};

/*
 * Nota de estado — 4 de octubre de 2026
 *
 * Este archivo se reconstruyo a partir del estado de la base, no de su codigo
 * original: la migracion estaba aplicada en pa_request —aparece en
 * `knex_migrations` con el nombre exacto de este archivo— pero el archivo no
 * estaba en el repositorio, ni en HEAD ni en el historial de git. Sin el,
 * `node db/cli.js migrate` fallaba con «The migration directory is corrupt» en
 * el esquema `request`, lo que bloqueaba el flujo documentado del README.
 *
 * Lo que se pudo comprobar antes de escribir esto:
 *
 * - La unica diferencia de esquema era esta columna. `prestador_ref` tiene
 *   `telefono varchar(20) NULL` en la base y ninguna en el repositorio; el
 *   resto de tablas y columnas de `pa_request` coinciden.
 *
 * - Ningun proceso la escribe ni la lee. `upsertPrestador`
 *   (`services/request-service/src/infrastructure/persistence/KnexSupportRepositories.ts:201`)
 *   no la incluye ni en el `insert` ni en el `merge`, la interfaz `PrestadorRef`
 *   no la declara, y las pruebas de integracion insertan la replica sin ella.
 *
 * Es decir: la columna esta vacia en todas partes y nada depende de que exista.
 *
 * Se conserva en lugar de eliminarla, por dos razones deliberadas. Primera: si
 * se eliminara, habria que borrar la fila de `knex_migrations` y tirar la
 * columna, que es cirugia sobre el historial de la base y no algo que deba
 * hacerse sin acordarlo. Segunda: `telefono` es exactamente el dato del que
 * habla B-1 —«el telefono no llega al contacto posterior al acuerdo»—, cuya
 * opcion (c) recomienda sacarlo del perfil de prestador. Si se toma esa
 * decision, la columna y su migracion ya estan.
 *
 * Mientras B-1 siga abierta, esta columna no tiene escritor. Su cierre honesto
 * es uno de estos dos: «B-1 eligio la opcion (c) y algo la escribe» o «se
 * elimina la columna y su migracion». Dejarla aqui es la opcion
 * conservadora, no una recomendacion.
 */
