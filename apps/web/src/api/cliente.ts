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
  details: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
});

export class ErrorApi extends Error {
  readonly estado: number;
  readonly codigo: string;
  readonly correlationId: string | undefined;
  readonly detalles: readonly { field: string; message: string }[];
  /**
   * Ruta que se estaba pidiendo.
   *
   * Vive en el error y no se pasa suelta por los componentes porque es lo unico
   * que permite decir QUE se cae cuando un servicio no responde (SRS RNF19).
   */
  readonly ruta: string;

  constructor(
    estado: number,
    codigo: string,
    mensaje: string,
    correlationId?: string,
    detalles: readonly { field: string; message: string }[] = [],
    ruta = ''
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
    this.estado = estado;
    this.codigo = codigo;
    this.correlationId = correlationId;
    this.detalles = detalles;
    this.ruta = ruta;
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

  /**
   * El fallo viene de un servicio que no responde, no de una peticion incorrecta.
   *
   * La distincion decide lo que se le dice a la persona y si vale la pena
   * esperar y reintentar: un 403 no se arregla esperando; un 503, a veces si.
   */
  get degradado(): boolean {
    return esFalloDeServicio(this.estado);
  }

  /** Microservicio dueno de la ruta; la puerta de enlace si no se reconoce. */
  get servicio(): string {
    return (capacidadDe(this.ruta) ?? CAPACIDAD_PUERTA).servicio;
  }

  /**
   * Que se pierde, sin la frase: "los avisos".
   *
   * `null` cuando el fallo no es de servicio, y tambien es la respuesta
   * correcta: un 401 o un 403 son un problema de la peticion, y anunciar una
   * caida que no existe asusta mas que informa.
   */
  get capacidad(): Capacidad | null {
    return this.degradado ? (capacidadDe(this.ruta) ?? CAPACIDAD_PUERTA) : null;
  }

  /** La frase entera, lista para pintar. */
  get mensajeDegradado(): string {
    return mensajeDeCapacidad(capacidadDe(this.ruta) ?? CAPACIDAD_PUERTA);
  }
}

/**
 * Estados que significan "no se pudo ni contestar".
 *
 * Solo 502, 503 y 504. Un 500 NO entra: es un error del servicio, no una
 * caida, y el gateway lo cuenta como fallo del cortacircuitos aunque el servicio
 * este de pie. Y un 4xx menos: un 422 significa que el servicio funciona y
 * rechaza la peticion, que es justo lo contrario de estar caido.
 */
export function esFalloDeServicio(estado: number): boolean {
  return estado === 502 || estado === 503 || estado === 504;
}

/** Lo que se pierde cuando un servicio no responde. */
export interface Capacidad {
  /** Prefijo de ruta que lo sirve. */
  prefijo: string;
  /** Microservicio dueno del prefijo. */
  servicio: string;
  /** Accion imposible, en la tercera persona del presente. */
  verbo: string;
  /** Aquello sobre lo que no se puede actuar, en la forma que pide el verbo. */
  texto: string;
  /** Si `texto` es plural: obliga a "se pueden" en vez de "se puede". */
  plural: boolean;
}

/**
 * Ruta -> microservicio -> capacidad afectada (SRS RNF19).
 *
 * La tabla esta copiada de `services/api-gateway/src/config/routes.ts` a
 * proposito, y no se deduce del nombre de la ruta. Adivinar por el nombre
 * daria el servicio equivocado: `/needs` y `/proposals` van las dos a
 * request-service, que es dueno del agregado completo, y `/categories` va al
 * catalogo y no a un servicio propio.
 *
 * Y esto NO es un `switch` en cada componente. Es una tabla, vive al lado del
 * unico sitio por el que pasa toda peticion, y se prueba sola: cuando la
 * topologia cambie se toca una vez y todas las pantallas lo cuentan a la vez.
 *
 * El orden de busqueda es el del gateway: gana el prefijo mas largo que
 * coincida, para que `/api/v1/services` gane sobre cualquier prefijo mas corto.
 */
const CAPACIDADES: readonly Capacidad[] = [
  {
    prefijo: '/api/v1/auth',
    servicio: 'auth-service',
    verbo: 'comprobar',
    texto: 'su sesion',
    plural: false,
  },
  {
    prefijo: '/api/v1/users',
    servicio: 'auth-service',
    verbo: 'cambiar',
    texto: 'sus datos de cuenta',
    plural: true,
  },
  {
    prefijo: '/api/v1/providers',
    servicio: 'provider-service',
    verbo: 'mostrar',
    texto: 'los perfiles de prestador',
    plural: true,
  },
  {
    prefijo: '/api/v1/services',
    servicio: 'catalog-service',
    verbo: 'mostrar',
    texto: 'el catalogo de servicios',
    plural: false,
  },
  {
    prefijo: '/api/v1/categories',
    servicio: 'catalog-service',
    verbo: 'mostrar',
    texto: 'las categorias',
    plural: true,
  },
  {
    prefijo: '/api/v1/needs',
    servicio: 'request-service',
    verbo: 'gestionar',
    texto: 'las necesidades',
    plural: true,
  },
  {
    prefijo: '/api/v1/proposals',
    servicio: 'request-service',
    verbo: 'enviar',
    texto: 'las propuestas',
    plural: true,
  },
  {
    prefijo: '/api/v1/requests',
    servicio: 'request-service',
    verbo: 'gestionar',
    texto: 'las contrataciones',
    plural: true,
  },
  {
    prefijo: '/api/v1/ratings',
    servicio: 'rating-service',
    verbo: 'mostrar',
    texto: 'las calificaciones',
    plural: true,
  },
  {
    prefijo: '/api/v1/notifications',
    servicio: 'notification-service',
    verbo: 'mostrar',
    texto: 'los avisos',
    plural: true,
  },
  {
    prefijo: '/api/v1/admin',
    servicio: 'admin-reporting-service',
    verbo: 'abrir',
    texto: 'la administracion',
    plural: false,
  },
];

/**
 * Cuando no encaja ningun prefijo, la que falla es la puerta de enlace.
 *
 * Ocurre con una ruta mal construida o con la puerta caida: en los dos casos la
 * verdad es que no se pudo ni reachar la plataforma, y decirlo asi no enseña
 * ningun nombre interno.
 */
const CAPACIDAD_PUERTA: Capacidad = {
  prefijo: '',
  servicio: 'api-gateway',
  verbo: 'conectar con',
  texto: 'Punto Amigo',
  plural: false,
};

/** Capacidad que sirve una ruta, o `null` si el prefijo no se reconoce. */
export function capacidadDe(ruta: string): Capacidad | null {
  // La consulta va suelta en las opciones, pero pelarla aqui hace que esta
  // funcion sirva igual con una ruta pelada y con una URL entera.
  const camino = ruta.split('?')[0] ?? ruta;

  let mejor: Capacidad | null = null;
  for (const capacidad of CAPACIDADES) {
    const coincide = camino === capacidad.prefijo || camino.startsWith(`${capacidad.prefijo}/`);
    if (coincide && (mejor === null || capacidad.prefijo.length > mejor.prefijo.length)) {
      mejor = capacidad;
    }
  }

  return mejor;
}

/**
 * Lo que se le ensena a la persona cuando una capacidad se cae.
 *
 * La segunda frase no es adorno: es la otra mitad de RNF19. Decir "no se pueden
 * mostrar los avisos" sin decir que el resto sigue en pie deja la impresion de
 * que la plataforma entera esta caida, que es justo lo que RNF19 prohibe.
 */
export function mensajeDeCapacidad(capacidad: Capacidad): string {
  const frase = capacidad.plural
    ? `No se pueden ${capacidad.verbo} ${capacidad.texto}.`
    : `No se puede ${capacidad.verbo} ${capacidad.texto}.`;

  return `${frase} El resto de la aplicacion sigue funcionando.`;
}

/**
 * Para un 5xx que no es una caida de servicio.
 *
 * Solo se llega aqui con un 500 o con un cuerpo que no se pudo leer, y en los dos
 * casos no se sabe que se perdio. Es el unico sitio que queda con un texto
 * generico, y es tambien el unico que puede: RNF19 exige nombrar la capacidad
 * cuando se sabe cual es, no adivinarla.
 */
function mensajeSinNombre(estado: number): string {
  return estado >= 500
    ? 'El sistema no esta disponible en este momento. Intentelo de nuevo en unos minutos.'
    : 'No se pudo completar la operacion.';
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

  /**
   * `enviarUnaVez` respaldada: convierte una red caida en un error nombrado.
   *
   * Se envuelve en una funcion para que el reintento del 401 pase por aqui
   * tambien. Si solo se envolviera la primera llamada, una caida de red durante
   * el reintento saldria como el `TypeError` crudo de `fetch`.
   */
  const intentar = async (): Promise<Response> => {
    try {
      return await enviarUnaVez(ruta, metodo, cuerpo, consulta, publica);
    } catch {
      throw caidaDeRed(ruta);
    }
  };

  let respuesta = await intentar();

  /**
   * Un 401 se reintenta UNA vez, y solo si la renovacion funciona.
   *
   * Sin ese limite, un token que el servidor rechaza por un motivo que no se
   * arregla renovando produciria un bucle infinito de peticiones.
   */
  if (respuesta.status === 401 && !publica) {
    if (await renovar()) {
      respuesta = await intentar();
    }
  }

  if (!respuesta.ok) throw await aError(respuesta, ruta);
  return respuesta;
}

/**
 * Traduce una red caida al mismo lenguaje que una caida de servicio.
 *
 * `fetch` lanza un `TypeError` opaco —"Failed to fetch"— que no le dice nada a
 * nadie, y ademas se colaba como un error cualquiera en pantallas que solo
 * saben leer `ErrorApi`.
 *
 * Se reporta como 503 y no como 0 a proposito: la politica de reintentos de
 * `main.tsx` decide por estado, y un 0 contaria como "menor de 500", es decir,
 * como algo que NO se reintenta. Quien navega con datos contados se quedaria sin
 * catalogo ante un corte de un segundo. Para la interfaz, una red caida y un
 * servicio parado son lo mismo.
 */
function caidaDeRed(ruta: string): ErrorApi {
  return new ErrorApi(
    503,
    'RED_NO_DISPONIBLE',
    mensajeDeCapacidad(capacidadDe(ruta) ?? CAPACIDAD_PUERTA),
    undefined,
    [],
    ruta
  );
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
 *
 * `ruta` es lo que permite nombrar la capacidad cuando el fallo es de servicio.
 * Sin ella solo queda decir "el sistema no esta disponible", que es exactamente
 * lo que RNF19 prohibe.
 */
async function aError(respuesta: Response, ruta: string): Promise<ErrorApi> {
  /**
   * Se decide antes de leer el cuerpo porque no depende de el.
   *
   * El cuerpo del gateway para un servicio caido SI tiene la forma esperada —
   * `AppError.upstreamUnavailable` responde 503 con un mensaje propio—, asi que
   * el texto que llega no nombra ninguna capacidad. Por eso el mensaje del
   * servidor se sustituye tambien cuando el cuerpo se pudo leer bien: no solo
   * cuando vino vacio. Alguien lee el mensaje, no el codigo.
   */
  const capacidad = esFalloDeServicio(respuesta.status)
    ? (capacidadDe(ruta) ?? CAPACIDAD_PUERTA)
    : null;

  try {
    const datos = esquemaError.parse(await respuesta.json());
    return new ErrorApi(
      respuesta.status,
      datos.code,
      capacidad === null ? datos.message : mensajeDeCapacidad(capacidad),
      datos.correlationId,
      datos.details ?? [],
      ruta
    );
  } catch {
    return new ErrorApi(
      respuesta.status,
      'RESPUESTA_INESPERADA',
      capacidad === null ? mensajeSinNombre(respuesta.status) : mensajeDeCapacidad(capacidad),
      undefined,
      [],
      ruta
    );
  }
}

/** Inicio de sesion. Vive aqui porque es quien crea la sesion. */
export async function iniciarSesion(correo: string, contrasena: string): Promise<void> {
  const ruta = '/api/v1/auth/login';

  let respuesta: Response;
  try {
    respuesta = await enviarUnaVez(ruta, 'POST', { correo, contrasena }, undefined, true);
  } catch {
    // Sin red no hay ni un mensaje que el servidor pueda dar: se dice que no se
    // puede comprobar la sesion, no que las credenciales son incorrectas.
    throw caidaDeRed(ruta);
  }

  if (!respuesta.ok) throw await aError(respuesta, ruta);

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
