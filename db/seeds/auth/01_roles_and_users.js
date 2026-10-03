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

/**
 * Siembra idempotente: repetirla conserva los identificadores.
 *
 * Antes borraba nueve tablas y volvia a insertar. Eso hacia que cada ejecucion
 * reasignara `id_usuario`, y ahi estaba el dano: los otros seis esquemas
 * guardan una replica `usuario_ref` con ese identificador y SIN clave foranea,
 * porque una FK entre esquemas rompe la propiedad de datos que exige el SRS
 * (RNF53). El motor no puede avisar de nada, asi que un `docker compose up` de
 * desarrollo dejaba perfiles, solicitudes y calificaciones apuntando a usuarios
 * que ya no existian.
 *
 * Ahora cada fila se inserta o se refresca por su clave natural —`nombre_rol`,
 * `correo`— y el identificador no se vuelve a tocar nunca (A-1, B-3).
 */
exports.seed = async function seed(knex) {
  /**
   * Las tablas de sesion y bloqueo ya no se borran.
   *
   * Eran la otra mitad del mismo problema: `login_lockout` y `login_attempt`
   * son estado operativo, no datos de ejemplo, y vaciarlas en cada arranque
   * borraba el bloqueo progresivo de quien lo estuviera probando.
   */
  await knex('rol').insert(ROLES).onConflict('nombre_rol').merge(['descripcion']);
  const roles = await knex('rol').select('id_rol', 'nombre_rol');
  const rolePorNombre = new Map(roles.map((r) => [r.nombre_rol, r.id_rol]));

  const contrasenaHash = await hash(DEV_PASSWORD, ARGON_OPTS);

  let creados = 0;

  for (const u of USUARIOS) {
    /**
     * Se consulta antes de escribir porque hay que saber si el alta es NUEVA.
     *
     * No es solo para conservar el identificador: de ello depende si se encola
     * `UserRegistered` mas abajo. Un upsert a ciegas no distingue los dos casos
     * —MySQL devuelve `insertId` tanto al insertar como al actualizar— y
     * acabaria anunciando el alta de los mismos usuarios en cada ejecucion.
     */
    const existente = await knex('usuario')
      .select('id_usuario')
      .where({ correo: u.correo })
      .first();
    const esNuevo = existente === undefined;

    let idUsuario;
    if (esNuevo) {
      [idUsuario] = await knex('usuario').insert({
        nombre: u.nombre,
        correo: u.correo,
        contrasena_hash: contrasenaHash,
        telefono: u.telefono,
        estado: 'ACTIVO',
      });
      creados += 1;
    } else {
      idUsuario = existente.id_usuario;
      /**
       * Se refresca el resto, incluida la contrasena.
       *
       * Cambiar SEED_DEV_PASSWORD y volver a sembrar tiene que surtir efecto;
       * si no, la unica forma de recuperar el acceso a las cuentas de prueba
       * seria borrar el esquema, que es justo lo que esto viene a evitar.
       */
      await knex('usuario').where({ id_usuario: idUsuario }).update({
        nombre: u.nombre,
        contrasena_hash: contrasenaHash,
        telefono: u.telefono,
        estado: 'ACTIVO',
      });
    }

    /**
     * `merge` y no `ignore`.
     *
     * En MySQL, Knex compila `onConflict().ignore()` a `INSERT IGNORE`, que se
     * traga tambien los errores que NO son la clave duplicada: una clave
     * foranea invalida o un valor truncado pasarian como si nada. `merge`
     * emite ON DUPLICATE KEY UPDATE, que solo actua ante el choque real y deja
     * que el resto falle a la vista.
     */
    await knex('usuario_rol')
      .insert(
        u.roles.map((nombreRol) => ({
          id_usuario: idUsuario,
          id_rol: rolePorNombre.get(nombreRol),
          // NULL: SOLICITANTE se concede en el alta, no lo asigna un administrador.
          asignado_por: null,
        }))
      )
      .onConflict(['id_usuario', 'id_rol'])
      .merge(['asignado_por']);

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
     * Solo para las altas NUEVAS. El consumidor es idempotente por `event_id`,
     * no por contenido, asi que un `event_id` nuevo en cada ejecucion esquiva
     * esa proteccion: el alta de los cuatro usuarios de prueba se volveria a
     * anunciar en cada arranque. Reconstruir una replica que se haya perdido
     * NO es trabajo del seed; para eso esta la re-emision (A-2).
     */
    if (esNuevo) {
      await knex('outbox_event').insert({
        event_id: randomUUID(),
        event_name: 'UserRegistered',
        event_version: 1,
        aggregate_type: 'Usuario',
        aggregate_id: String(idUsuario),
        correlation_id: randomUUID(),
        causation_id: null,
        payload: JSON.stringify({
          userId: idUsuario,
          nombre: u.nombre,
          correo: u.correo,
          roles: u.roles,
          occurredAt: new Date().toISOString(),
        }),
        occurred_at: new Date(),
      });
    }
  }

  // Distinguir creados de refrescados: es la unica senal de que la siembra es
  // idempotente de verdad. La segunda ejecucion debe informar de 0 nuevos.
  console.log(
    `    ${USUARIOS.length} usuarios de prueba, ${creados} nuevos ` +
      `(contrasena: la de SEED_DEV_PASSWORD)`
  );
};
