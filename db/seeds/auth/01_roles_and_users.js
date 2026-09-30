/**
 * Seed de desarrollo para pa_auth.
 *
 * Crea los tres roles del SRS y cuatro cuentas de prueba, entre ellas una que
 * tiene Solicitante y Oferente a la vez: es el caso que el modelo anterior no
 * podia representar y conviene poder probar desde el primer dia (SRS RF159).
 *
 * Las contrasenas se hashean con Argon2id en tiempo de ejecucion. No se
 * versiona ningun hash: un hash fijo en el repositorio acaba copiado a un
 * entorno real. El valor en claro solo existe aqui y solo para desarrollo.
 */
'use strict';

const { hash } = require('@node-rs/argon2');

/**
 * La contrasena de desarrollo llega por entorno y NO se versiona.
 *
 * Tenerla escrita aqui la convertia en una credencial publicada: cualquiera con
 * acceso al repositorio conoce la clave de una cuenta con rol ADMINISTRADOR, y
 * basta con que el seed corra una vez fuera de local para que sea explotable.
 *
 * El CLI ya restringe los seeds a NODE_ENV development o test; esto es la
 * segunda barrera, por si alguien invoca knex directamente.
 */
const DEV_PASSWORD = process.env.SEED_DEV_PASSWORD;

if (!DEV_PASSWORD) {
  throw new Error(
    'Falta SEED_DEV_PASSWORD. Definela en tu .env (ver .env.example) antes de cargar los seeds.'
  );
}

if (DEV_PASSWORD.length < 12) {
  throw new Error('SEED_DEV_PASSWORD debe tener al menos 12 caracteres.');
}

const ARGON_OPTS = {
  memoryCost: Number(process.env.ARGON2_MEMORY_COST || 19456),
  timeCost: Number(process.env.ARGON2_TIME_COST || 2),
  parallelism: Number(process.env.ARGON2_PARALLELISM || 1),
};

const ROLES = [
  { nombre_rol: 'ADMINISTRADOR', descripcion: 'Supervision, moderacion y configuracion de la plataforma' },
  { nombre_rol: 'OFERENTE', descripcion: 'Publica servicios y envia propuestas' },
  { nombre_rol: 'SOLICITANTE', descripcion: 'Busca servicios, publica necesidades y contrata' },
];

const USUARIOS = [
  {
    nombre: 'Administradora Punto Amigo',
    correo: 'admin@puntoamigo.local',
    telefono: '3000000001',
    roles: ['ADMINISTRADOR', 'SOLICITANTE'],
  },
  {
    nombre: 'Marta Solicitante',
    correo: 'solicitante@puntoamigo.local',
    telefono: '3000000002',
    roles: ['SOLICITANTE'],
  },
  {
    nombre: 'Pedro Oferente',
    correo: 'oferente@puntoamigo.local',
    telefono: '3000000003',
    roles: ['SOLICITANTE', 'OFERENTE'],
  },
  {
    // El caso que motivo RF159: presta un servicio y ademas necesita otros.
    nombre: 'Lucia Ambos Roles',
    correo: 'ambos@puntoamigo.local',
    telefono: '3000000004',
    roles: ['SOLICITANTE', 'OFERENTE'],
  },
];

exports.seed = async function seed(knex) {
  // Orden inverso al de las dependencias para no chocar con las claves foraneas.
  await knex('usuario_rol').del();
  await knex('login_lockout').del();
  await knex('login_attempt').del();
  await knex('token_denylist').del();
  await knex('password_recovery_token').del();
  await knex('refresh_session').del();
  await knex('outbox_event').del();
  await knex('usuario').del();
  await knex('rol').del();

  await knex('rol').insert(ROLES);
  const roles = await knex('rol').select('id_rol', 'nombre_rol');
  const rolePorNombre = new Map(roles.map((r) => [r.nombre_rol, r.id_rol]));

  const contrasenaHash = await hash(DEV_PASSWORD, ARGON_OPTS);

  for (const u of USUARIOS) {
    const [idUsuario] = await knex('usuario').insert({
      nombre: u.nombre,
      correo: u.correo,
      contrasena_hash: contrasenaHash,
      telefono: u.telefono,
      estado: 'ACTIVO',
    });

    await knex('usuario_rol').insert(
      u.roles.map((nombreRol) => ({
        id_usuario: idUsuario,
        id_rol: rolePorNombre.get(nombreRol),
        // NULL: SOLICITANTE se concede en el alta, no lo asigna un administrador.
        asignado_por: null,
      }))
    );
  }

  // eslint-disable-next-line no-console
  console.log(`    ${USUARIOS.length} usuarios de prueba (contrasena: la de SEED_DEV_PASSWORD)`);
};
