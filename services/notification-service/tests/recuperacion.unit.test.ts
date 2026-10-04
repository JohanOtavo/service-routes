/**
 * El correo de recuperacion de contrasena (C-1).
 *
 * Hasta ahora `auth-service` creaba el token, lo metia en un evento
 * `UserProfileUpdated` con `accion: 'RECUPERACION_SOLICITADA'`, el relevo lo
 * publicaba, y NADIE lo consumia: el consumidor hacia `ack` de un evento sin
 * manejador y el enlace se descartaba en silencio. La pantalla
 * `/restablecer?token=...` existia y nada enviaba nunca esa URL.
 *
 * Esto prueba el caso de uso que la envia. Sin SMTP: lo que hay que comprobar
 * es el ENLACE y las reglas de seguridad, no que un servidor de correo acepte
 * la conexion.
 */
import {
  SendRecoveryEmailUseCase,
  registrarCorreoDeRecuperacion,
  type CorreoAEnviar,
  type IEnviadorCorreo,
} from '../src/application/use-cases/SendRecoveryEmail';
import { envSchema } from '../src/main';

const TOKEN = 'xU9-_abcDEF1234567890xyzABCDEFGH';
const BASE = 'https://puntoamigo.example';

class EnviadorFalso implements IEnviadorCorreo {
  public enviados: CorreoAEnviar[] = [];
  async enviar(correo: CorreoAEnviar): Promise<void> {
    this.enviados.push(correo);
  }
}

const construir = (): {
  caso: SendRecoveryEmailUseCase;
  enviador: EnviadorFalso;
  registrado: { nivel: string; mensaje: string; datos?: Record<string, unknown> }[];
} => {
  const enviador = new EnviadorFalso();
  const registrado: { nivel: string; mensaje: string; datos?: Record<string, unknown> }[] = [];
  const logger = {
    info: (mensaje: string, datos?: Record<string, unknown>): void => {
      registrado.push({ nivel: 'info', mensaje, ...(datos === undefined ? {} : { datos }) });
    },
    error: (mensaje: string, datos?: Record<string, unknown>): void => {
      registrado.push({ nivel: 'error', mensaje, ...(datos === undefined ? {} : { datos }) });
    },
  };
  const caso = new SendRecoveryEmailUseCase(enviador, logger, { urlBaseCliente: BASE });
  return { caso, enviador, registrado };
};

const payload = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  userId: 42,
  correo: 'persona@puntoamigo.local',
  nombre: 'Persona de Prueba',
  accion: 'RECUPERACION_SOLICITADA',
  token: TOKEN,
  expiraAt: '2026-10-03T23:30:00.000Z',
  ...extra,
});

describe('correo de recuperacion de contrasena', () => {
  it('envia el enlace al correo del payload', async () => {
    const { caso, enviador } = construir();

    const enviado = await caso.alSolicitarRecuperacion(payload());

    expect(enviado).toBe(true);
    expect(enviador.enviados).toHaveLength(1);
    expect(enviador.enviados[0]?.para).toBe('persona@puntoamigo.local');
  });

  it('construye el enlace que la pantalla de restablecer sabe leer', async () => {
    const { caso, enviador } = construir();

    await caso.alSolicitarRecuperacion(payload());

    /**
     * `Restablecer.tsx` lee `consulta.get('token')`, asi que el token va en la
     * cadena de consulta y no en la ruta. Si esto cambiara, la pantalla se
     * quedaria sin formulario y diria que el enlace no es valido.
     */
    expect(enviador.enviados[0]?.texto).toContain(`${BASE}/restablecer?token=${TOKEN}`);
  });

  it('escapa el token en la URL', async () => {
    const { caso, enviador } = construir();
    // Un token con un caracter que cambia de significado en una URL.
    await caso.alSolicitarRecuperacion(payload({ token: 'abc+def/ghi=' }));

    const texto = enviador.enviados[0]?.texto ?? '';
    expect(texto).toContain('token=abc%2Bdef%2Fghi%3D');
    expect(texto).not.toContain('token=abc+def/ghi=');
  });

  it('no deja el token en el registro', async () => {
    const { caso, registrado } = construir();

    await caso.alSolicitarRecuperacion(payload());

    /**
     * Es el unico evento del sistema que transporta un secreto. Un token en el
     * registro es un token en cualquier agregador de logs, y con el se cambia
     * la contrasena de esa cuenta.
     */
    expect(JSON.stringify(registrado)).not.toContain(TOKEN);
    expect(registrado.length).toBeGreaterThan(0);
  });

  it('no manda nada si la accion es otra', async () => {
    const { caso, enviador } = construir();

    expect(await caso.alSolicitarRecuperacion(payload({ accion: 'CUENTA_REACTIVADA' }))).toBe(
      false
    );
    expect(enviador.enviados).toEqual([]);
  });

  it('no manda nada si falta el token o el correo', async () => {
    const { caso, enviador } = construir();

    expect(await caso.alSolicitarRecuperacion(payload({ token: undefined }))).toBe(false);
    expect(await caso.alSolicitarRecuperacion(payload({ correo: undefined }))).toBe(false);
    expect(enviador.enviados).toEqual([]);
  });

  it('no revela en el cuerpo si la cuenta existe', async () => {
    const { caso, enviador } = construir();

    await caso.alSolicitarRecuperacion(payload());

    /**
     * El endpoint devuelve 202 siempre, exista o no la cuenta, para no ser un
     * verificador de correos registrados. El correo no puede deshacer eso
     * afirmando la existencia de la cuenta ni nombrando otra.
     */
    const cuerpo = `${enviador.enviados[0]?.asunto} ${enviador.enviados[0]?.texto}`;
    expect(cuerpo).not.toMatch(/su cuenta existe|cuenta registrada|esta registrad/iu);
  });

  it('dice cuando caduca el enlace, que es lo que evita un segundo intento a ciegas', async () => {
    const { caso, enviador } = construir();

    await caso.alSolicitarRecuperacion(payload());

    expect(enviador.enviados[0]?.texto).toMatch(/caduca|valido hasta|vence/iu);
  });

  it('propaga el fallo del enviador en lugar de tragarlo', async () => {
    const { caso } = construir();
    const roto = new SendRecoveryEmailUseCase(
      {
        enviar: async () => {
          throw new Error('SMTP rechazo la conexion');
        },
      },
      { info: () => {}, error: () => {} },
      { urlBaseCliente: BASE }
    );
    void caso;

    /**
     * Tragarlo dejaria el evento confirmado y el correo sin enviar: quien pidio
     * recuperar su contrasena esperaria para siempre. Al propagarlo, el
     * consumidor lo deriva a la cola de fallidos, que es donde se ve.
     */
    await expect(roto.alSolicitarRecuperacion(payload())).rejects.toThrow(
      'SMTP rechazo la conexion'
    );
  });

  it('no deja una barra doble si la URL base trae barra final', async () => {
    const enviador = new EnviadorFalso();
    const caso = new SendRecoveryEmailUseCase(
      enviador,
      { info: () => {}, error: () => {} },
      { urlBaseCliente: 'https://puntoamigo.example/' }
    );

    await caso.alSolicitarRecuperacion(payload());

    expect(enviador.enviados[0]?.texto).toContain('https://puntoamigo.example/restablecer?token=');
    expect(enviador.enviados[0]?.texto).not.toContain('example//restablecer');
  });
});

/**
 * El registro del manejador, que es LO QUE FALTABA.
 *
 * El defecto de C-1 no era un envio mal hecho: era que nadie escuchaba el
 * evento. Llegaba a la cola, el consumidor lo confirmaba por no tener manejador
 * y el token se perdia sin error y sin rastro. Por eso el registro se extrajo a
 * una funcion: un registro dentro de `main()` no se puede comprobar.
 */
describe('registro del manejador de recuperacion', () => {
  const EVENTO = 'UserProfileUpdated';

  it('se suscribe al evento que transporta el token', () => {
    const registrados: string[] = [];
    const { caso } = construir();

    registrarCorreoDeRecuperacion(
      {
        on: (nombre) => {
          registrados.push(nombre);
          return undefined;
        },
      },
      caso,
      EVENTO
    );

    expect(registrados).toEqual([EVENTO]);
  });

  it('el manejador registrado envia el correo al recibir el sobre', async () => {
    const { caso, enviador } = construir();
    let manejador: ((sobre: { payload: Record<string, unknown> }) => Promise<void>) | null = null;

    registrarCorreoDeRecuperacion(
      {
        on: (_nombre, m) => {
          manejador = m;
          return undefined;
        },
      },
      caso,
      EVENTO
    );

    expect(manejador).not.toBeNull();
    await manejador!({ payload: payload() });

    expect(enviador.enviados).toHaveLength(1);
    expect(enviador.enviados[0]?.texto).toContain(`${BASE}/restablecer?token=${TOKEN}`);
  });

  it('un sobre de otra accion pasa por el manejador sin enviar nada', async () => {
    const { caso, enviador } = construir();
    let manejador: ((sobre: { payload: Record<string, unknown> }) => Promise<void>) | null = null;

    registrarCorreoDeRecuperacion(
      {
        on: (_nombre, m) => {
          manejador = m;
          return undefined;
        },
      },
      caso,
      EVENTO
    );

    // `UserProfileUpdated` lo emiten tambien otros caminos de auth-service, y
    // ninguno debe acabar en la cola de fallidos por no ser una recuperacion.
    await expect(
      manejador!({ payload: payload({ accion: 'CUENTA_REACTIVADA' }) })
    ).resolves.toBeUndefined();
    expect(enviador.enviados).toEqual([]);
  });
});

/**
 * El entorno acepta las claves de correo vacias.
 *
 * `.env.example` las trae vacias, que es como un fichero de entorno dice "sin
 * valor". Sin tratarlo, `z.string().min(1).optional()` las rechazaba —la clave
 * esta, aunque no tenga valor— y notification-service no arrancaba. En la
 * maquina de desarrollo no se veia porque alli las claves no existian; lo
 * encontro CI al levantar la pila desde un `.env` copiado del ejemplo.
 */
describe('entorno de correo', () => {
  const base = {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    CORS_ORIGIN: 'http://localhost:5173',
    MYSQL_HOST: 'localhost',
    REDIS_HOST: 'localhost',
    DB_NOTIFICATION_USER: 'u',
    DB_NOTIFICATION_PASSWORD: 'p',
    RABBITMQ_HOST: 'localhost',
    RABBITMQ_USER: 'u',
    RABBITMQ_PASSWORD: 'p',
    INTERNAL_SERVICE_SECRET: 'secreto-de-al-menos-16',
  };

  it('acepta SMTP_HOST, SMTP_USER, SMTP_PASSWORD y WEB_PUBLIC_URL vacios', () => {
    const r = envSchema.safeParse({
      ...base,
      SMTP_HOST: '',
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      WEB_PUBLIC_URL: '',
    });

    expect(r.success).toBe(true);
    if (r.success) {
      // Vacio se lee como ausente, que es lo que elige el enviador de reserva.
      expect(r.data.SMTP_HOST).toBeUndefined();
      expect(r.data.WEB_PUBLIC_URL).toBeUndefined();
    }
  });

  it('sigue aceptando que no esten', () => {
    expect(envSchema.safeParse(base).success).toBe(true);
  });

  it('y sigue rechazando una URL que no es una URL', () => {
    const r = envSchema.safeParse({ ...base, WEB_PUBLIC_URL: 'no-es-una-url' });
    expect(r.success).toBe(false);
  });
});
