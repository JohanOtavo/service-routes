import { AppError, EventName } from '@punto-amigo/shared';
import { Email } from '../../domain/value-objects/Email';
import { PlainPassword } from '../../domain/value-objects/PlainPassword';
import type {
  IClock,
  IEventPublisher,
  IPasswordHasher,
  IRecoveryTokenRepository,
  ISessionRepository,
  IUsuarioRepository,
} from '../../domain/ports/out';

export interface SolicitarRecuperacionInput {
  correo: string;
  correlationId: string;
}

export interface RestablecerInput {
  token: string;
  contrasena: string;
  confirmacionContrasena: string;
  correlationId: string;
}

/**
 * Recuperacion de contrasena.
 *
 * SRS: RF12, RF13, RF14.
 */
export class PasswordRecoveryUseCase {
  constructor(
    private readonly usuarios: IUsuarioRepository,
    private readonly tokensRecuperacion: IRecoveryTokenRepository,
    private readonly sesiones: ISessionRepository,
    private readonly hasher: IPasswordHasher,
    private readonly eventos: IEventPublisher,
    private readonly clock: IClock,
    private readonly vigenciaSegundos: number
  ) {}

  /**
   * Inicia el proceso.
   *
   * Responde lo mismo exista o no la cuenta. Decir "ese correo no esta
   * registrado" convierte el formulario de recuperacion en un verificador de
   * cuentas, que es justo lo que se evita en el inicio de sesion; dejarlo
   * abierto aqui anularia aquella precaucion.
   */
  async solicitar(input: SolicitarRecuperacionInput): Promise<void> {
    const email = Email.create(input.correo);
    const usuario = await this.usuarios.findByEmail(email);

    if (usuario === null || !usuario.puedeAutenticarse) return;

    // Invalida los tokens anteriores: varios vivos a la vez multiplican las
    // oportunidades de que uno sea interceptado.
    await this.tokensRecuperacion.invalidarPendientes(usuario.id);

    const ahora = this.clock.now();
    const token = await this.tokensRecuperacion.crear({
      idUsuario: usuario.id,
      expiraAt: new Date(ahora.getTime() + this.vigenciaSegundos * 1000),
    });

    /**
     * El token viaja en el evento para que notification-service lo envie.
     *
     * Es el unico evento que transporta un secreto, y por eso su consumidor
     * unico es el de notificaciones: no se replica a los modelos de lectura de
     * los demas servicios.
     */
    await this.eventos.enqueue(
      {
        eventName: EventName.UserProfileUpdated,
        aggregateType: 'Usuario',
        aggregateId: usuario.id,
        payload: {
          userId: usuario.id,
          correo: usuario.email.value,
          nombre: usuario.nombre,
          accion: 'RECUPERACION_SOLICITADA',
          token,
          expiraAt: new Date(ahora.getTime() + this.vigenciaSegundos * 1000).toISOString(),
        },
      },
      input.correlationId
    );
  }

  /** Consume el token y cambia la contrasena. */
  async restablecer(input: RestablecerInput): Promise<void> {
    const contrasena = PlainPassword.createWithConfirmation(
      input.contrasena,
      input.confirmacionContrasena
    );

    const registro = await this.tokensRecuperacion.buscarVigente(input.token, this.clock.now());
    if (registro === null) {
      // Un token vencido y uno inventado dan el mismo error: distinguirlos
      // permitiria averiguar cuales existieron.
      throw AppError.unauthenticated('El enlace de recuperacion ya no es valido.');
    }

    const usuario = await this.usuarios.findById(registro.idUsuario);
    if (usuario === null || !usuario.puedeAutenticarse) {
      throw AppError.unauthenticated('El enlace de recuperacion ya no es valido.');
    }

    usuario.cambiarContrasena(await this.hasher.hash(contrasena.reveal()));
    await this.usuarios.update(usuario);

    // Un solo uso (SRS RF14).
    await this.tokensRecuperacion.marcarUsado(registro.id, this.clock.now());

    /**
     * Cambiar la contrasena cierra todas las sesiones abiertas.
     *
     * Quien recupera su cuenta suele hacerlo porque sospecha que alguien mas
     * entro. Dejar vivas las sesiones existentes conservaria el acceso
     * precisamente a quien se intenta expulsar.
     */
    await this.sesiones.revocarTodasDe(usuario.id, 'CAMBIO_DE_CONTRASENA');

    await this.eventos.enqueue(
      {
        eventName: EventName.UserProfileUpdated,
        aggregateType: 'Usuario',
        aggregateId: usuario.id,
        payload: {
          userId: usuario.id,
          accion: 'CONTRASENA_RESTABLECIDA',
          occurredAt: this.clock.now().toISOString(),
        },
      },
      input.correlationId
    );
  }
}
