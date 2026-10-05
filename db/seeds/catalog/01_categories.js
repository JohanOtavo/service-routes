/**
 * Semillas idempotentes para categorías de catálogo.
 *
 * No borran datos existentes. Usa `onConflict` para no duplicar categorías
 * base entre reinicios de desarrollo (F1-1/F2-3).
 */
const CATEGORIAS = [
  { id_categoria: 1, nombre_categoria: 'Plomería', activa: true },
  { id_categoria: 2, nombre_categoria: 'Electricidad', activa: true },
  { id_categoria: 3, nombre_categoria: 'Limpieza', activa: true },
  { id_categoria: 4, nombre_categoria: 'Jardinería', activa: true },
  { id_categoria: 5, nombre_categoria: 'Pintura', activa: true },
];

exports.seed = async function (knex) {
  for (const categoria of CATEGORIAS) {
    await knex('categoria_servicio').insert(categoria).onConflict('id_categoria').ignore();
  }
};
