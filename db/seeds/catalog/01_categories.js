/**
 * Semillas idempotentes del catalogo inicial (A-1 del backlog).
 *
 * El catalogo de categorias es un requisito de puesta en marcha (SRS 3.3.9):
 * sin el, ni se puede publicar un servicio ni clasificar una necesidad, y ambos
 * flujos quedarian bloqueados en un entorno nuevo.
 *
 * Idempotente por `nombre_categoria`, la clave natural. Antes este seed borraba
 * `prestador_ref`, `servicio`, `outbox_event` y la propia tabla de categorias:
 * un `docker compose up` destruia el trabajo de desarrollo. Ahora solo sincroniza
 * las categorias que son suyas y no toca ninguna otra fila.
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
  for (const [nombre_categoria, descripcion] of CATEGORIAS) {
    await knex('categoria_servicio')
      .insert({ nombre_categoria, descripcion, activa: true })
      .onConflict('nombre_categoria')
      .merge(['descripcion', 'activa']);
  }

  console.log(`    ${CATEGORIAS.length} categorias de servicio`);
};
