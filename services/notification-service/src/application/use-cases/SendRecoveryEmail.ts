/**
 * El correo transaccional de recuperacion de contrasena (C-1).
 *
 * `auth-service` crea el token y lo mete en un evento `UserProfileUpdated` con
 * `accion: 'RECUPERACION_SOLICITADA'`. Hasta ahora nadie lo consumia: el
 * consumidor hacia `ack` de un evento sin manejador y el enlace se descartaba
 * en silencio, asi que la pantalla `/restablecer?token=...` existia y nada
 * enviaba nunca esa URL.
 *
 * Es el UNICO correo que este servicio manda. La decision del 3/10/2026
 * descarto el push y el correo de producto: la bandeja intraaplicacion cubre el
 * MVP. Esto entra porque un canal de recuperacion tiene que funcionar SIN
 * sesion, y quien olvido su contrasena no puede entrar a leer la bandeja.
 */

/** Un correo listo para salir. Sin HTML: ver §Cuerpo mas abajo. */
export interface CorreoAEnviar {
  para: string;
  asunto: string;
  texto: string;
}

/**
 * Puerto de salida del envio de correo.
 *
 * Igual que los demas puertos de este servicio, la interfaz vive junto al caso
 * de uso y la implementacion en `infrastructure/`. Existe sobre todo para que
 * las pruebas no necesiten un servidor SMTP: lo que hay que comprobar es el
 * enlace y las reglas de seguridad, no que un servidor acepte una conexion.
 */
export interface IEnviadorCorreo {
  enviar(correo: CorreoAEnviar): Promise<void>;
}

interface Registrador {
  info(mensaje: string, datos?: Record<string, unknown>): void;
  error(mensaje: string, datos?: Record<string, unknown>): void;
}

const ACCION_RECUPERACION = 'RECUPERACION_SOLICITADA';

/**
 * Cuerpo en texto plano, sin HTML.
 *
 * Un correo de recuperacion no necesita maquetacion, y el HTML anade dos
 * problemas que no compensan aqui: los clientes que lo reescriben pueden
 * romper un enlace largo, y un cuerpo con imagenes remotas delata al servidor
 * de correo que la persona lo abrio.
 */
function cuerpo(nombre: string, enlace: string, caduca: string): string {
  return [
    `Hola${nombre === '' ? '' : ` ${nombre}`},`,
    '',
    'Alguien pidio restablecer la contrasena de esta cuenta en Punto Amigo.',
    'Si fue usted, abra este enlace:',
    '',
    enlace,
    '',
    `El enlace ${caduca} y solo sirve una vez.`,
    '',
    'Si no fue usted, no hace falta hacer nada: la contrasena no cambia hasta',
    'que alguien use el enlace.',
  ].join('\n');
}

/**
 * Cuando caduca, en palabras y sin prometer una hora exacta.
 *
 * `expiraAt` viene del reloj de auth-service en UTC. Dar una hora concreta
 * obligaria a decidir en que zona mostrarla, y equivocarse ahi es peor que no
 * decirla: alguien descarta un enlace que todavia vale.
 */
function comoCaduca(expiraAt: unknown): string {
  if (typeof expiraAt !== 'string') return 'caduca al poco tiempo';

  const vence = new Date(expiraAt);
  if (Number.isNaN(vence.getTime())) return 'caduca al poco tiempo';

  const minutos = Math.round((vence.getTime() - Date.now()) / 60_000);
  if (minutos <= 0) return 'ya puede haber caducado';
  if (minutos < 90) return `caduca en unos ${minutos} minutos`;
  return `caduca en unas ${Math.round(minutos / 60)} horas`;
}

export class SendRecoveryEmailUseCase {
  constructor(
    private readonly enviador: IEnviadorCorreo,
    private readonly logger: Registrador,
    private readonly config: { urlBaseCliente: string }
  ) {}

  /**
   * Envia el enlace. Devuelve si mando algo.
   *
   * Un payload que no es de recuperacion, o al que le falta el token o el
   * correo, devuelve `false` y NO lanza: `UserProfileUpdated` lo emiten tambien
   * otros caminos de auth-service, y lanzar mandaria a la cola de fallidos un
   * evento que no tiene nada de malo.
   *
   * Lo que SI se propaga es un fallo del envio. Tragarlo dejaria el evento
   * confirmado y el correo sin enviar, y quien pidio recuperar su contrasena
   * esperaria para siempre.
   */
  async alSolicitarRecuperacion(payload: Record<string, unknown>): Promise<boolean> {
    if (payload['accion'] !== ACCION_RECUPERACION) return false;

    const token = payload['token'];
    const correo = payload['correo'];
    if (typeof token !== 'string' || token === '') return false;
    if (typeof correo !== 'string' || correo === '') return false;

    // Sin barra doble: la URL base puede venir con barra final del entorno.
    const base = this.config.urlBaseCliente.replace(/\/+$/u, '');
    // `encodeURIComponent` y no interpolacion directa: el token es base64url,
    // que no lleva `+` ni `/`, pero esto no puede depender de como se genere.
    const enlace = `${base}/restablecer?token=${encodeURIComponent(token)}`;

    const nombre = typeof payload['nombre'] === 'string' ? payload['nombre'] : '';

    await this.enviador.enviar({
      para: correo,
      asunto: 'Restablezca su contrasena de Punto Amigo',
      texto: cuerpo(nombre, enlace, comoCaduca(payload['expiraAt'])),
    });

    /**
     * Se registra el envio, NO el token ni el enlace.
     *
     * Es el unico evento del sistema que transporta un secreto. Un token en el
     * registro es un token en cualquier agregador de logs, y con el se cambia
     * la contrasena de esa cuenta. Tampoco va el correo completo: basta el
     * identificador para seguir el rastro.
     */
    this.logger.info('correo de recuperacion enviado', { userId: payload['userId'] });
    return true;
  }
}

/**
 * Minimo que esta funcion necesita de un `EventConsumer`.
 *
 * Se declara aqui en lugar de importar el tipo de `@punto-amigo/messaging` para
 * que la prueba pueda pasar un doble sin construir un broker.
 */
export interface RegistroDeEventos {
  on(
    eventName: string,
    manejador: (sobre: { payload: Record<string, unknown> }) => Promise<void>
  ): unknown;
}

/**
 * Registra el manejador del correo de recuperacion.
 *
 * Existe como funcion y no en linea dentro de `main()` por una razon concreta:
 * el defecto que C-1 cierra era que ESTE REGISTRO NO EXISTIA. El evento llegaba
 * a la cola, el consumidor lo confirmaba sin manejador y el token se perdia, sin
 * error y sin rastro. Una prueba no puede comprobar un registro que vive dentro
 * de `main()`; puede comprobar esta funcion.
 */
export function registrarCorreoDeRecuperacion(
  consumidor: RegistroDeEventos,
  caso: SendRecoveryEmailUseCase,
  eventName: string
): void {
  consumidor.on(eventName, async (sobre) => {
    await caso.alSolicitarRecuperacion(sobre.payload);
  });
}
