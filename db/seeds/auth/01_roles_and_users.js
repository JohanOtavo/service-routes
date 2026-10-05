/**
 * Semillas idempotentes para autenticaciÃ³n.
 *
 * No borran datos existentes: usan `onConflict` para ignorar inserciones
 * duplicadas. Esto evita que un `docker compose up` destruya usuarios de
 * desarrollo ya creados y cumple con el criterio de semillas idempotentes
 * (F1-1/F2-3).
 */
const ROLES = [
  { id_rol: 1, nombre_rol: 'SOLICITANTE' },
  { id_rol: 2, nombre_rol: 'OFERENTE' },
  { id_rol: 3, nombre_rol: 'ADMINISTRADOR' },
];

exports.seed = async function (knex) {
  for (const rol of ROLES) {
    await knex('rol').insert(rol).onConflict('id_rol').ignore();
  }

  await knex('usuario')
    .insert({
      id_usuario: 1,
      correo: 'admin@puntoamigo.local',
      contrasena_hash: '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
      estado: 'ACTIVO',
    })
    .onConflict('id_usuario')
    .ignore();

  await knex('usuario')
    .insert({
      id_usuario: 2,
      correo: 'solicitante@puntoamigo.local',
      contrasena_hash: '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
      estado: 'ACTIVO',
    })
    .onConflict('id_usuario')
    .ignore();

  await knex('usuario')
    .insert({
      id_usuario: 3,
      correo: 'oferente@puntoamigo.local',
      contrasena_hash: '$2b$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
      estado: 'ACTIVO',
    })
    .onConflict('id_usuario')
    .ignore();
};
