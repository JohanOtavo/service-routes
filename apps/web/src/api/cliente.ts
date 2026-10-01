import { z } from 'zod';
import {
  borrarSesion,
  estaPorExpirar,
  guardarSesion,
  obtenerSesion,
  obtenerToken,
  registrarAbandono,
} from './sesion';

/**
 * Cliente HTTP contra el gateway.
 *
 * Todo pasa por aqui. No hay un `fetch` suelto en ningun componente, y eso es
 * lo que permite que la renovacion del token, el manejo de errores y la
 * validacion de respuestas existan en UN sitio en lugar de repetirse mal en
 * veinte.
 */

/** Forma del error que devuelve el backend. Es la misma en los ocho servicios. */
const esquemaError = z.object({
  code: z.string(),
  message: z.string(),
  correlationId: z.string().optional(),
  details: z
    .array(z.object({ field: z.string(), message: z.string() }))
    .optional(),
});

export class ErrorApi extends Error {
  readonly estado: number;
  readonly codigo: string;
  readonly correlationId: string | undefined;
  readonly detalles: readonly { field: string; message: string }[];

  constructor(
    estado: number,
    codigo: string,
    mensaje: string,
    correlationId?: string,
    detalles: readonly { field: string; message: string }[] = []
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.estado = estado;
    this.codigo = codigo;
    this.correlationId = correlationId;
    this.detalles = detalles;
  }

  /** Un fallo de propiedad llega como 404, no como 403: asi lo decide el servidor. */
  get noEncontrado(): boolean {
    return this.estado === 404;
  }

  get sinAutenticar(): boolean {
    return this.estado === 401;
  }

  get sinPermiso(): boolean {
    return this.estado === 403;
  }
}

/** Respuesta del inicio de sesion y de la renovacion. */
const esquemaSesion = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.string(),
  usuario: z
    .object({
      id: z.number(),
      nombre: z.string(),
      roles: z.array(z.string()),
    })
    .optional(),
});

/**
 * Renovacion en vuelo, compartida.
 *
 * Si cinco peticiones reciben 401 a la vez y cada una renueva por su cuenta,
 * cuatro de esas renovaciones usarian un token de refresco ya rotado. El
 * servidor interpreta eso como robo y revoca la cadena entera, cerrando la
 * sesion de alguien que no hizo nada mal. Compartir la promesa lo evita.
 */
let renovacionEnVuelo: Promise<boolean> | null = null;

/**
 * Tope de la renovacion.
 *
 * Sin el, una peticion que nunca responde deja la promesa compartida colgada y
 * TODA renovacion posterior espera a esa: la aplicacion se queda sin poder
 * renovar mientras dure la pestana, sin un solo error en la consola.
 */
const TOPE_RENOVACION_MS = 15_000;

/**
 * Olvida la sesion SIN abandonar la renovacion en curso.
 *
 * `borrarSesion` aborta la renovacion, y llamarlo desde dentro de la propia
 * renovacion la haria abortarse a si misma. Aqui ya se sabe que termino.
 */
function sesionFuera(): void {
  registrarAbandono(null);
  borrarSesion();
}

async function renovar(): Promise<boolean> {
  renovacionEnVuelo ??= (async () => {
    const corte = new AbortController();
    const temporizador = setTimeout(() => corte.abort(), TOPE_RENOVACION_MS);
    // `borrarSesion` puede abandonarla antes: cerrar sesion o un fallo de
    // autenticacion no deben quedarse esperando a una renovacion que ya no
    // interesa.
    registrarAbandono(() => {
      corte.abort();
      renovacionEnVuelo = null;
    });

    try {
      const respuesta = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        // La cookie de refresco es httpOnly: el script no la lee, solo pide que
        // el navegador la envie.
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        signal: corte.signal,
      });

      if (!respuesta.ok) {
        sesionFuera();
        return false;
      }

      const datos = esquemaSesion.parse(await respuesta.json());
      const anterior = obtenerSesion();

      guardarSesion({
        accessToken: datos.accessToken,
        expiraEn: new Date(datos.expiresAt),
        // La renovacion no reenvia el usuario: se conserva el que ya habia.
        usuario: datos.usuario ?? anterior?.usuario ?? { id: 0, nombre: '', roles: [] },
      });
      return true;
    } catch {
      // Incluye el corte por tiempo: una renovacion que no responde se trata
      // como una que fallo.
      sesionFuera();
      return false;
    } finally {
      clearTimeout(temporizador);
      registrarAbandono(null);
      renovacionEnVuelo = null;
    }
  })();

  return renovacionEnVuelo;
}

/** Intenta recuperar la sesion al arrancar, con la cookie de refresco. */
export async function recuperarSesion(): Promise<boolean> {
  return renovar();
}

interface Opciones {
  metodo?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  cuerpo?: unknown;
  consulta?: Record<string, string | number | undefined>;
  /** Rutas publicas: no se intenta renovar ni se adjunta token. */
  publica?: boolean;
}

function construirUrl(ruta: string, consulta?: Opciones['consulta']): string {
  if (consulta === undefined) return ruta;

  const parametros = new URLSearchParams();
  for (const [clave, valor] of Object.entries(consulta)) {
    if (valor !== undefined && valor !== '') parametros.set(clave, String(valor));
  }

  const cadena = parametros.toString();
  return cadena === '' ? ruta : `${ruta}?${cadena}`;
}

/**
 * Hace la peticion y devuelve el cuerpo YA VALIDADO contra el esquema.
 *
 * Validar la respuesta parece paranoia hasta que un servicio cambia un campo y
 * la interfaz muestra `undefined` en mitad de una pantalla sin que nada falle.
 * Validando, el fallo aparece aqui, con el nombre del campo, y no tres
 * componentes mas abajo.
 */
export async function pedir<T>(
  ruta: string,
  esquema: z.ZodType<T>,
  opciones: Opciones = {}
): Promise<T> {
  const respuesta = await enviar(ruta, opciones);

  if (respuesta.status === 204) {
    // Sin cuerpo. El esquema de quien llama tiene que admitirlo.
    return esquema.parse(undefined);
  }

  const crudo: unknown = await respuesta.json();
  return esquema.parse(crudo);
}

/** Para las operaciones que no devuelven cuerpo. */
export async function ejecutar(ruta: string, opciones: Opciones = {}): Promise<void> {
  await enviar(ruta, opciones);
}

async function enviar(ruta: string, opciones: Opciones): Promise<Response> {
  const { metodo = 'GET', cuerpo, consulta, publica = false } = opciones;

  // Se renueva ANTES de enviar si al token le queda poco, para no gastar una
  // peticion en descubrir que expiro.
  if (!publica && obtenerToken() !== null && estaPorExpirar()) {
    await renovar();
  }

  let respuesta = await enviarUnaVez(ruta, metodo, cuerpo, consulta, publica);

  /**
   * Un 401 se reintenta UNA vez, y solo si la renovacion funciona.
   *
   * Sin ese limite, un token que el servidor rechaza por un motivo que no se
   * arregla renovando produciria un bucle infinito de peticiones.
   */
  if (respuesta.status === 401 && !publica) {
    if (await renovar()) {
      respuesta = await enviarUnaVez(ruta, metodo, cuerpo, consulta, publica);
    }
  }

  if (!respuesta.ok) throw await aError(respuesta);
  return respuesta;
}

async function enviarUnaVez(
  ruta: string,
  metodo: string,
  cuerpo: unknown,
  consulta: Opciones['consulta'],
  publica: boolean
): Promise<Response> {
  const cabeceras: Record<string, string> = { accept: 'application/json' };
  if (cuerpo !== undefined) cabeceras['content-type'] = 'application/json';

  const token = obtenerToken();
  if (!publica && token !== null) cabeceras['authorization'] = `Bearer ${token}`;

  return fetch(construirUrl(ruta, consulta), {
    method: metodo,
    headers: cabeceras,
    // Siempre: es lo que hace llegar la cookie de refresco en /auth/refresh.
    credentials: 'include',
    ...(cuerpo === undefined ? {} : { body: JSON.stringify(cuerpo) }),
  });
}

/**
 * Traduce la respuesta de error.
 *
 * Si el cuerpo no tiene la forma esperada —un 502 del proxy, por ejemplo— se
 * construye un error generico en vez de lanzar al analizar: fallar mientras se
 * maneja un fallo esconde el problema original.
 */
async function aError(respuesta: Response): Promise<ErrorApi> {
  try {
    const datos = esquemaError.parse(await respuesta.json());
    return new ErrorApi(
      respuesta.status,
      datos.code,
      datos.message,
      datos.correlationId,
      datos.details ?? []
    );
  } catch {
    return new ErrorApi(
      respuesta.status,
      'RESPUESTA_INESPERADA',
      respuesta.status >= 500
        ? 'El sistema no esta disponible en este momento. Intentelo de nuevo en unos minutos.'
        : 'No se pudo completar la operacion.'
    );
  }
}

/** Inicio de sesion. Vive aqui porque es quien crea la sesion. */
export async function iniciarSesion(correo: string, contrasena: string): Promise<void> {
  const respuesta = await enviarUnaVez(
    '/api/v1/auth/login',
    'POST',
    { correo, contrasena },
    undefined,
    true
  );

  if (!respuesta.ok) throw await aError(respuesta);

  const datos = esquemaSesion.parse(await respuesta.json());
  guardarSesion({
    accessToken: datos.accessToken,
    expiraEn: new Date(datos.expiresAt),
    usuario: datos.usuario ?? { id: 0, nombre: '', roles: [] },
  });
}

/**
 * Cierre de sesion.
 *
 * Borra la sesion local AUNQUE la peticion falle. Si el servidor no responde,
 * dejar el token en memoria seria lo peor de los dos mundos: la persona cree
 * que cerro sesion y la pestana sigue autenticada.
 */
export async function cerrarSesion(): Promise<void> {
  try {
    await enviar('/api/v1/auth/logout', { metodo: 'POST' });
  } catch {
    // Se ignora a proposito: el borrado local es lo que importa.
  } finally {
    borrarSesion();
  }
}
