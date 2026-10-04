import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { CorreoAEnviar, IEnviadorCorreo } from '../../application/use-cases/SendRecoveryEmail';

interface Registrador {
  info(mensaje: string, datos?: Record<string, unknown>): void;
  error(mensaje: string, datos?: Record<string, unknown>): void;
}

export interface ConfiguracionSmtp {
  host: string;
  puerto: number;
  seguro: boolean;
  usuario: string;
  contrasena: string;
  remitente: string;
}

/**
 * Envio por SMTP (C-1).
 *
 * `nodemailer` y no una llamada HTTP a un proveedor concreto: SMTP es el unico
 * protocolo que sirve igual contra un servidor propio, contra un buzon de
 * pruebas y contra cualquier proveedor, asi que la eleccion de proveedor queda
 * en el `.env` y no en el codigo.
 *
 * La version importa: `nodemailer@7` arrastra trece avisos de seguridad, entre
 * ellos inyeccion de comandos SMTP por CRLF y validacion de certificado TLS
 * incorrecta al pedir un token OAuth2. Esta fijado a `^10.0.14`, que es la
 * primera version sin ninguno.
 */
export class EnviadorCorreoSmtp implements IEnviadorCorreo {
  private readonly transporte: Transporter;

  constructor(
    private readonly config: ConfiguracionSmtp,
    private readonly logger: Registrador
  ) {
    this.transporte = nodemailer.createTransport({
      host: config.host,
      port: config.puerto,
      secure: config.seguro,
      auth: { user: config.usuario, pass: config.contrasena },
    });
  }

  async enviar(correo: CorreoAEnviar): Promise<void> {
    try {
      await this.transporte.sendMail({
        from: this.config.remitente,
        to: correo.para,
        subject: correo.asunto,
        text: correo.texto,
      });
    } catch (error) {
      /**
       * Se registra el fallo y se vuelve a lanzar.
       *
       * El mensaje del error puede traer la respuesta del servidor, que no
       * contiene el token —va en el cuerpo, no en el sobre— pero si el correo
       * de destino. Se registra solo el motivo, y el evento sube al consumidor
       * para que lo derive a la cola de fallidos en lugar de confirmarlo.
       */
      this.logger.error('no se pudo enviar un correo', {
        mensaje: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

/**
 * Enviador que no envia: deja el enlace en el registro.
 *
 * Para desarrollo y para cualquier entorno sin SMTP configurado. Existe porque
 * la alternativa era peor de las dos formas posibles: exigir SMTP haria que el
 * servicio no arrancara en una maquina de desarrollo, y tragar el envio en
 * silencio devolveria el defecto que C-1 viene a cerrar —un token que se
 * genera y no llega a ningun sitio—.
 *
 * `exigirCorreoEnProduccion` de `main.ts` impide que esto llegue a produccion:
 * el arranque se niega si falta `SMTP_HOST` con `NODE_ENV=production`.
 */
export class EnviadorCorreoRegistrado implements IEnviadorCorreo {
  constructor(private readonly logger: Registrador) {}

  async enviar(correo: CorreoAEnviar): Promise<void> {
    /**
     * Aqui SI va el cuerpo, con el enlace y su token.
     *
     * Es deliberado y es la razon de que esta clase no pueda existir en
     * produccion: sin un buzon al que mirar, la unica forma de probar la
     * recuperacion en local es leer el enlace del registro.
     */
    this.logger.info('SMTP no configurado: el correo NO se envio', {
      para: correo.para,
      asunto: correo.asunto,
      cuerpo: correo.texto,
    });
  }
}
