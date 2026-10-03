/**
 * Seed de desarrollo para pa_catalog.
 *
 * El catalogo inicial de categorias es un requisito de puesta en marcha
 * (SRS §3.3.9): sin el, ni se puede publicar un servicio ni clasificar una
 * necesidad, y ambos flujos quedarian bloqueados en un entorno nuevo.
 */
'use strict';

const CATEGORIAS = [
  ['Plomeria', 'Instalacion y reparacion de redes de agua y desagues'],
  ['Electricidad', 'Instalaciones electricas, tomas, iluminacion y tableros'],
  ['Carpinteria', 'Fabricacion y reparacion de muebles y estructuras en madera'],
  ['Pintura', 'Pintura de interiores, exteriores y acabados'],
  ['Cerrajeria', 'Apertura, cambio y reparacion de cerraduras'],
  ['Limpieza', 'Aseo de hogares, oficinas y locales'],
  ['Jardineria', 'Mantenimiento de jardines, poda y zonas verdes'],
  ['Mudanzas', 'Transporte y traslado de enseres'],
  ['Reparacion de electrodomesticos', 'Diagnostico y reparacion de linea blanca y marron'],
  ['Construccion y remodelacion', 'Obra civil menor, enchapes y remodelaciones'],
  ['Tecnologia y computo', 'Soporte tecnico, redes y mantenimiento de equipos'],
  ['Clases particulares', 'Refuerzo academico y ensenanza personalizada'],
];

exports.seed = async function seed(knex) {
  await knex('service_rating_summary').del();
  await knex('servicio').del();
  await knex('outbox_event').del();
  await knex('processed_event').del();
  await knex('prestador_ref').del();
  await knex('categoria_servicio').del();

  await knex('categoria_servicio').insert(
    CATEGORIAS.map(([nombre_categoria, descripcion]) => ({
      nombre_categoria,
      descripcion,
      activa: true,
    }))
  );

  console.log(`    ${CATEGORIAS.length} categorias de servicio`);
};
