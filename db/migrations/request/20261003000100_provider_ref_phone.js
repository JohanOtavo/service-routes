/**
 * El telefono del perfil de prestador llega a `pa_request` (B-1).
 *
 * La decision del 3/10/2026 es que el telefono que se revela tras el acuerdo
 * sale del PERFIL de prestador, que es donde el oferente lo declara *para que
 * le contacten*. El de la cuenta se dio para administrarla.
 *
 * Hasta ahora `pa_request` no tenia forma de conocer ese dato: la replica
 * `prestador_ref` no lo copiaba y ningun evento lo transportaba. El detalle de
 * contratacion devolvia `contacto.telefono` leyendolo de `usuario_ref`, y esa
 * columna NUNCA se rellena porque `UserRegistered` no lleva el telefono. El
 * cliente web ya mostraba el campo; lo que mostraba era null, siempre.
 *
 * Es una columna de datos personales mas en un segundo esquema. Entra porque la
 * funcion la necesita, y queda anotada en la politica de datos personales
 * (docs/04-POLITICA-DATOS-PERSONALES.md §1) como replica de contacto que hay
 * que conservar y anonimizar con el resto.
 */
'use strict';

exports.up = async function up(knex) {
  await knex.schema.alterTable('prestador_ref', (table) => {
    // Mismo largo que `pa_provider.prestador.telefono`: una replica con menos
    // espacio que su origen trunca en silencio.
    table
      .string('telefono', 20)
      .nullable()
      .comment(
        'Telefono declarado en el perfil de prestador; se revela tras el acuerdo (SRS RF156)'
      );
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('prestador_ref', (table) => {
    table.dropColumn('telefono');
  });
};
