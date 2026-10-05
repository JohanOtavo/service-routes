/**
 * Semillas idempotentes de autenticacion (A-1 del backlog).
 *
 * Crea los tres roles del SRS y cuatro cuentas de prueba, entre ellas una que
 * tiene Solicitante y Oferente a la vez: es el caso que el modelo anterior no
 * podia representar y conviene poder probar desde el primer dia (SRS RF159).
 *
 * Idempotente, y no por|-- una cuestion de estilo. Antes este seed borraba sus
 * tablas y las volvia a insertar. `usuario.id_usuario` es un autoincremento,
 * asi que cambia en cada ejecucion, y todo lo que apuntara a un usuario -las
 * replicas `usuario_ref` de los demas esquemas, que no tienen clave foranea
 * porque viven en otro esquema- se quedaba colgando sin que MySQL avisara.
 * Un `docker compose up` destruia el estado de desarrollo en silencio.
 *
 * Ahora cada escritura es `onConflict().merge()` sobre la clave natural, de
 * modo que repetir el seed conserva los mismos `id_usuario`. Lo que el seed no
 * es dueno no lo toca.
 */
'use strict';

const { randomUUID } = require('node:crypto');

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
  {
    nombre_rol: 'ADMINISTRADOR',
    descripcion: 'Supervision, moderacion y configuracion de la plataforma',
  },
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
  for (const rol of ROLES) {
    await knex('rol').insert(rol).onConflict('nombre_rol').merge(['descripcion']);
  }

  const roles = await knex('rol').select('id_rol', 'nombre_rol');
  const rolePorNombre = new Map(roles.map((r) => [r.nombre_rol, r.id_rol]));

  const contrasenaHash = await hash(DEV_PASSWORD, ARGON_OPTS);

  for (const u of USUARIOS) {
    /**
     * `correo` es la clave natural de `usuario`. Mergear por el correo mantiene
     * el `id_usuario` que ya existe, que es justo lo que las replicas de los
     * demas esquemas apuntan.
     */
    await knex('usuario')
      .insert({
        nombre: u.nombre,
        correo: u.correo,
        contrasena_hash: contrasenaHash,
        telefono: u.telefono,
        estado: 'ACTIVO',
      })
      .onConflict('correo')
      .merge(['nombre', 'contrasena_hash', 'telefono', 'estado']);

    const usuario = await knex('usuario').where({ correo: u.correo }).first('id_usuario');

    /**
     * Los roles del seed son los exactos: se retiran los que sobren. Un seed
     * que solo anade deja que `usuario_rol` crezca como registro de todo lo que
     * alguien concedio alguna vez, y la prueba de idempotencia comprueba
     * precisamente que eso no pase.
     */
    await knex('usuario_rol').where({ id_usuario: usuario.id_usuario }).del();

    await knex('usuario_rol').insert(
      u.roles.map((nombreRol) => ({
        id_usuario: usuario.id_usuario,
        id_rol: rolePorNombre.get(nombreRol),
        // NULL: SOLICITANTE se concede en el alta, no lo asigna un administrador.
        asignado_por: null,
      }))
    );

    /**
     * El seed tambien escribe el evento de alta en el outbox.
     *
     * Sin esto, el usuario existe en pa_auth y NO existe para nadie mas: los
     * demas esquemas guardan una replica `usuario_ref` que se alimenta de
     * `UserRegistered`, y varias tablas la tienen como clave foranea. El
     * resultado era que una cuenta sembrada podia iniciar sesion pero no crear
     * una solicitud, porque la FK no encontraba a su propio dueno.
     *
     * Se escribe en el outbox y no se publica aqui a proposito: el relevo de
     * auth-service lo envia al arrancar, por el mismo camino que cualquier alta
     * real. Asi el seed ejercita la ruta de verdad en lugar de rodearla.
     *
     * Solo si no existe ya: reanunciar el alta haria que los consumidores
     * volvieran a procesar una cuenta que ya conocian.
     */
    const yaAnunciado = await knex('outbox_event')
      .where({ event_name: 'UserRegistered', aggregate_id: String(usuario.id_usuario) })
      .first('event_id');

    if (!yaAnunciado) {
      await knex('outbox_event').insert({
        event_id: randomUUID(),
        event_name: 'UserRegistered',
        event_version: 1,
        aggregate_type: 'Usuario',
        aggregate_id: String(usuario.id_usuario),
        correlation_id: randomUUID(),
        causation_id: null,
        payload: JSON.stringify({
          userId: usuario.id_usuario,
          nombre: u.nombre,
          correo: u.correo,
          roles: u.roles,
          occurredAt: new Date().toISOString(),
        }),
        occurred_at: new Date(),
      });
    }
  }

  console.log(`    ${USUARIOS.length} usuarios de prueba (contrasena: la de SEED_DEV_PASSWORD)`);
};
