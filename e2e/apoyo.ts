/**
 * Apoyo compartido de las pruebas E2E (C-3).
 *
 * Nada de esto toca la interfaz: son las dos cosas que una prueba de navegador
 * no puede hacer por si misma —leer el enlace de un correo y conocer las
 * credenciales sembradas— resueltas por el camino que usa de verdad quien
 * desarrolla.
 */
import { spawnSync } from 'node:child_process';

/** Contenedor de notification-service, segun `docker-compose.yml`. */
const CONTENEDOR_NOTIFICACIONES = process.env['E2E_NOTIFICATION_CONTAINER'] ?? 'pa-notification';

export const USUARIOS = {
  solicitante: 'solicitante@puntoamigo.local',
  oferente: 'oferente@puntoamigo.local',
  ambos: 'ambos@puntoamigo.local',
  admin: 'admin@puntoamigo.local',
} as const;

/**
 * La contrasena de las cuentas sembradas.
 *
 * Es la misma variable que exige `db/seeds/auth/01_roles_and_users.js`. Sin ella
 * las pruebas no pueden entrar, y fallar aqui con un mensaje claro es mejor que
 * que cada prueba falle sola en el formulario de inicio de sesion.
 */
export function contrasenaSembrada(): string {
  const valor = process.env['SEED_DEV_PASSWORD'];
  if (valor === undefined || valor === '') {
    throw new Error(
      'Falta SEED_DEV_PASSWORD. Es la contrasena de las cuentas sembradas; cargue el .env antes de correr las E2E.'
    );
  }
  return valor;
}

/** No se pudo leer el registro. Distinto de "todavia no hay enlace". */
export class RegistroIlegible extends Error {}

/**
 * Lee el registro del contenedor juntando los DOS flujos.
 *
 * `docker logs` reparte la salida del contenedor entre stdout y stderr, y un
 * `execFileSync` normal devuelve solo stdout: la primera version de este
 * archivo leia cero bytes aunque el enlace estuviera ahi. En la linea de
 * comandos no se noto porque el `2>&1` los juntaba.
 */
function leerRegistro(): string {
  const r = spawnSync('docker', ['logs', '--tail', '400', CONTENEDOR_NOTIFICACIONES], {
    encoding: 'utf8',
  });

  if (r.error !== undefined) {
    throw new RegistroIlegible(`No se pudo ejecutar docker: ${r.error.message}`);
  }
  if (r.status !== 0) {
    throw new RegistroIlegible(
      `docker logs ${CONTENEDOR_NOTIFICACIONES} fallo con codigo ${String(r.status)}: ` +
        (r.stderr ?? '').slice(0, 200)
    );
  }

  return `${r.stdout ?? ''}${r.stderr ?? ''}`;
}

/**
 * El enlace esta dentro de una linea JSON, con los saltos escapados.
 *
 * `\S+?` es PEREZOSO a proposito: `\S` incluye la barra invertida de los `\n`
 * escapados del registro, asi que una version voraz se pasaria de largo hasta
 * la siguiente linea. Perezoso se detiene en el primer `/restablecer?token=`,
 * que es justo el limite que interesa.
 */
const ENLACE = /https?:\/\/\S+?\/restablecer\?token=[A-Za-z0-9_%-]+/g;

export function ultimoEnlaceDeRecuperacion(): string {
  const encontrados = leerRegistro().match(ENLACE);

  if (encontrados === null || encontrados.length === 0) {
    throw new Error(
      `No hay ningun enlace de recuperacion en el registro de ${CONTENEDOR_NOTIFICACIONES}. ` +
        'Compruebe que la pila esta levantada y que SMTP_HOST NO esta configurado.'
    );
  }

  // El ultimo: pedir una recuperacion invalida los tokens anteriores, asi que
  // el unico que sirve es el mas nuevo.
  return encontrados[encontrados.length - 1] as string;
}

/** El enlace que haya ahora, o null. Para comparar despues con el nuevo. */
export function enlaceActualONada(): string | null {
  try {
    return ultimoEnlaceDeRecuperacion();
  } catch (error) {
    if (error instanceof RegistroIlegible) throw error;
    return null;
  }
}

/**
 * Espera a que aparezca un enlace NUEVO.
 *
 * El relevo del outbox barre cada segundo y el consumidor tarda lo que tarde el
 * broker, asi que el enlace no esta en el registro en el instante en que la
 * pantalla dice "revise su correo". Comparar contra el anterior —y no solo
 * buscar "algun enlace"— es lo que evita usar el token de la ejecucion de antes
 * y fallar por caducado.
 */
export async function esperarEnlaceNuevo(anterior: string | null): Promise<string> {
  const limite = Date.now() + 30_000;

  while (Date.now() < limite) {
    try {
      const actual = ultimoEnlaceDeRecuperacion();
      if (actual !== anterior) return actual;
    } catch (error) {
      /**
       * "Todavia no hay enlace" se reintenta; "no puedo leer el registro", no.
       *
       * Tragar los dos por igual fue el primer defecto de este archivo: con
       * `docker logs` devolviendo vacio, la espera agotaba los 30 s y el
       * mensaje decia que el correo no habia llegado. Habia llegado tres veces.
       */
      if (error instanceof RegistroIlegible) throw error;
    }
    await new Promise((listo) => setTimeout(listo, 1_000));
  }

  throw new Error('El enlace de recuperacion no llego en 30 s.');
}

/**
 * Convierte el enlace del correo en una ruta relativa.
 *
 * El correo lleva la URL publica del cliente —en desarrollo
 * `http://localhost:5173`, que es `CORS_ORIGIN`—, y la prueba navega sobre el
 * `baseURL` de Playwright, que puede ser otro puerto. Lo que importa del enlace
 * es el token, no el anfitrion.
 */
export function rutaDelEnlace(enlace: string): string {
  const url = new URL(enlace);
  return `${url.pathname}${url.search}`;
}

/** Contenedor de MySQL, segun `docker-compose.yml`. */
const CONTENEDOR_MYSQL = process.env['E2E_MYSQL_CONTAINER'] ?? 'pa-mysql';

/**
 * Ejecuta SQL como root dentro del contenedor.
 *
 * Por `docker exec` y no con un cliente del anfitrion, igual que
 * `db/respaldo.sh`: asi la prueba no depende de que quien la corra tenga
 * instalado un cliente de la version correcta.
 */
function sql(sentencia: string): string {
  const clave = process.env['MYSQL_ROOT_PASSWORD'];
  if (clave === undefined || clave === '') {
    throw new Error('Falta MYSQL_ROOT_PASSWORD. Cargue el .env antes de correr las E2E.');
  }

  const r = spawnSync(
    'docker',
    [
      'exec',
      '-e',
      `MYSQL_PWD=${clave}`,
      CONTENEDOR_MYSQL,
      'mysql',
      '-uroot',
      '-s',
      '-N',
      '-e',
      sentencia,
    ],
    { encoding: 'utf8' }
  );

  if (r.error !== undefined) throw new Error(`No se pudo ejecutar docker: ${r.error.message}`);
  if (r.status !== 0) {
    throw new Error(`SQL fallo (${String(r.status)}): ${(r.stderr ?? '').slice(0, 300)}`);
  }

  return (r.stdout ?? '').trim();
}

/** El `id_usuario` de una cuenta sembrada. */
export function idUsuarioDe(correo: string): number {
  const salida = sql(`SELECT id_usuario FROM pa_auth.usuario WHERE correo = '${correo}';`);
  const id = Number(salida.split(/\s+/u)[0]);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`No existe la cuenta ${correo}. Ejecute npm run db:seed.`);
  }
  return id;
}

/**
 * Deja al oferente con un perfil de prestador ACTIVO y replicado.
 *
 * Es la precondicion del recorrido de negocio: sin perfil no se puede enviar
 * una propuesta, y sin la replica en `pa_request` no se puede adjudicar.
 *
 * Se siembra en `pa_provider` —que es el dueno del dato— y se propaga con
 * `npm run db:reemit provider`, el comando de A-2. Conducir las pantallas de
 * administracion para validar el perfil anadiria media prueba de un flujo que
 * no es el que se quiere probar, y pasaria por un rol mas.
 *
 * Como efecto secundario, cada ejecucion comprueba que la re-emision funciona
 * de verdad contra la pila completa.
 */
export function prepararPrestadorActivo(correo: string, telefonoPerfil: string): number {
  const idUsuario = idUsuarioDe(correo);

  sql(
    `INSERT INTO pa_provider.prestador
       (id_usuario, nombre, especialidad, telefono, estado)
     VALUES (${idUsuario}, 'Oferente de la prueba E2E', 'Plomeria', '${telefonoPerfil}', 'ACTIVE')
     ON DUPLICATE KEY UPDATE
       nombre = VALUES(nombre),
       especialidad = VALUES(especialidad),
       telefono = VALUES(telefono),
       estado = VALUES(estado),
       deleted_at = NULL;`
  );

  const r = spawnSync('npm run db:reemit provider', {
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, NODE_ENV: 'development', MYSQL_HOST: '127.0.0.1' },
  });
  if (r.status !== 0) {
    throw new Error(`db:reemit fallo: ${((r.stdout ?? '') + (r.stderr ?? '')).slice(0, 400)}`);
  }

  return idUsuario;
}

/**
 * Espera a que la replica de `pa_request` tenga el perfil.
 *
 * El relevo publica cada segundo y el consumidor tarda lo que tarde el broker,
 * asi que la fila no esta ahi en el instante en que `db:reemit` termina.
 */
export async function esperarPrestadorReplicado(idUsuario: number): Promise<void> {
  const limite = Date.now() + 30_000;

  while (Date.now() < limite) {
    const n = sql(
      `SELECT COUNT(*) FROM pa_request.prestador_ref WHERE id_usuario = ${idUsuario} AND estado = 'ACTIVE';`
    );
    if (Number(n) > 0) return;
    await new Promise((listo) => setTimeout(listo, 1_000));
  }

  throw new Error(
    `El perfil del usuario ${idUsuario} no llego a pa_request.prestador_ref en 30 s. ` +
      'Compruebe que request-service y RabbitMQ estan levantados.'
  );
}

/** Cierra las necesidades que dejara una ejecucion anterior de la prueba. */
export function limpiarNecesidadesDePrueba(marca: string): void {
  sql(
    `UPDATE pa_request.necesidad SET estado = 'CERRADA'
     WHERE titulo LIKE '%${marca}%' AND estado = 'ABIERTA';`
  );
}

/**
 * Deja las cuatro cuentas sembradas con la contrasena de `SEED_DEV_PASSWORD`.
 *
 * Las E2E establecen su propia precondicion en lugar de suponerla, y hay un
 * motivo concreto: `db/tests/seeds.int.test.ts` ejecuta el seed de verdad, y si
 * corre sin `SEED_DEV_PASSWORD` en el entorno usa su propio valor por omision.
 * Eso reescribe la contrasena de las cuatro cuentas, asi que correr la suite de
 * integracion antes de las E2E dejaba el recorrido sin poder iniciar sesion.
 *
 * El refresco idempotente de A-1 es justo la herramienta: repetir el seed no
 * toca los identificadores y si pone la contrasena que toca.
 */
export function asegurarContrasenaSembrada(): void {
  contrasenaSembrada();

  const r = spawnSync('npm run db:seed', {
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, NODE_ENV: 'development', MYSQL_HOST: '127.0.0.1' },
  });

  if (r.status !== 0) {
    throw new Error(
      `No se pudo sembrar antes de las E2E: ${((r.stdout ?? '') + (r.stderr ?? '')).slice(0, 400)}`
    );
  }
}
