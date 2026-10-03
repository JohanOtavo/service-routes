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

/**
 * Siembra idempotente del catalogo inicial (A-1, B-3).
 *
 * Antes vaciaba seis tablas para insertar doce categorias. El coste real no
 * eran las categorias: eran `servicio`, `prestador_ref` y `processed_event`,
 * que no son datos de ejemplo. Arrancar el entorno dos veces borraba los
 * servicios publicados, la replica de prestadores que solo se puede
 * reconstruir con eventos, y el registro de que esos eventos ya se habian
 * procesado —asi que tampoco volvian a llegar—.
 *
 * Ahora solo toca su propia tabla, y por clave natural.
 */
exports.seed = async function seed(knex) {
  await knex('categoria_servicio')
    .insert(
      CATEGORIAS.map(([nombre_categoria, descripcion]) => ({
        nombre_categoria,
        descripcion,
        activa: true,
      }))
    )
    .onConflict('nombre_categoria')
    /**
     * `activa` se queda como este; solo se refresca la descripcion.
     *
     * Incluirla aqui reactivaria en cada arranque una categoria que un
     * administrador hubiera desactivado a proposito. Para las filas nuevas el
     * valor del INSERT —true— si se aplica.
     */
    .merge(['descripcion']);

  console.log(`    ${CATEGORIAS.length} categorias de servicio`);
};
