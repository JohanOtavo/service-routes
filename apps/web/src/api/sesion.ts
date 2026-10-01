/**
 * El access token vive SOLO en memoria.
 *
 * Nunca en localStorage ni en sessionStorage, y la diferencia no es de estilo:
 * cualquier script que se cuele en la pagina puede leer esos almacenes con una
 * linea, asi que guardar el token ahi convierte un XSS en un robo de sesion que
 * sobrevive al cierre de la pestana. En memoria, un XSS sigue siendo grave pero
 * se acaba cuando se cierra la pagina.
 *
 * El precio es que al recargar no hay token. Se asume: el de refresco viaja en
 * una cookie httpOnly que el script no puede leer, y al arrancar se pide uno
 * nuevo con el. Eso es exactamente para lo que existe la rotacion.
 *
 * Es un modulo con estado y no un contexto de React porque el cliente HTTP lo
 * necesita fuera del arbol de componentes, al renovar tras un 401.
 */

export interface Sesion {
  accessToken: string;
  expiraEn: Date;
  usuario: { id: number; nombre: string; roles: readonly string[] };
}

let sesion: Sesion | null = null;

/**
 * Lo que hay que abandonar cuando se olvida la sesion.
 *
 * El cliente registra aqui como cancelar una renovacion en vuelo. Vive en este
 * modulo y no en el del cliente para que `borrarSesion` pueda invocarlo sin que
 * los dos modulos se importen en circulo.
 */
let abandonarRenovacion: (() => void) | null = null;

export function registrarAbandono(abandonar: (() => void) | null): void {
  abandonarRenovacion = abandonar;
}

/** Avisa a quien lo escuche de que la sesion cambio, para repintar. */
const oyentes = new Set<() => void>();

export function obtenerSesion(): Sesion | null {
  return sesion;
}

export function obtenerToken(): string | null {
  return sesion?.accessToken ?? null;
}

export function guardarSesion(nueva: Sesion): void {
  sesion = nueva;
  avisar();
}

/**
 * Olvida la sesion, y con ella cualquier renovacion en curso.
 *
 * Abandonar la renovacion importa: es una promesa compartida que vive en el
 * modulo del cliente, y si se quedara colgada —una peticion que no responde
 * nunca— toda renovacion posterior esperaria a ESA, y la aplicacion no podria
 * volver a renovar en lo que durara la pestana.
 */
export function borrarSesion(): void {
  sesion = null;
  abandonarRenovacion?.();
  avisar();
}

export function suscribirse(oyente: () => void): () => void {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

function avisar(): void {
  for (const oyente of oyentes) oyente();
}

/**
 * Si al token le queda poco.
 *
 * Se renueva ANTES de que expire, no cuando ya fallo: esperar el 401 cuesta una
 * peticion perdida y un parpadeo en la interfaz. El margen de 60 segundos cubre
 * el desfase de reloj entre el navegador y el servidor.
 */
export function estaPorExpirar(margenSegundos = 60): boolean {
  if (sesion === null) return true;
  return sesion.expiraEn.getTime() - Date.now() < margenSegundos * 1000;
}
