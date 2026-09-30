import { AppError, EventName } from '@punto-amigo/shared';
import { Email } from '../../domain/value-objects/Email';
import type {
  AttemptContext,
  IClock,
  IEventPublisher,
  ILockoutPolicy,
  IPasswordHasher,
  ISessionRepository,
  ITokenService,
  IUsuarioRepository,
} from '../../domain/ports/out';

export interface AuthenticateInput {
  correo: string;
  contrasena: string;
  correlationId: string;
  ip: string | null;
  userAgent: string | null;
}

export interface AuthenticateOutput {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  usuario: { id: number; nombre: string; correo: string; roles: string[] };
}

/**
 * Inicio de sesion.
 *
 * SRS: RF6 a RF9, RF20, RNF21, RNF22, y el bloqueo progresivo del brief de
 * construccion.
 *
 * El orden de las comprobaciones importa tanto como las comprobaciones mismas.
 */
export class AuthenticateUserUseCase {
  constructor(
    private readonly usuarios: IUsuarioRepository,
    private readonly hasher: IPasswordHasher,
    private readonly tokens: ITokenService,
    private readonly sesiones: ISessionRepository,
    private readonly lockout: ILockoutPolicy,
    private readonly eventos: IEventPublisher,
    private readonly clock: IClock
  ) {}

  async execute(input: AuthenticateInput): Promise<AuthenticateOutput> {
    const email = Email.create(input.correo);
    const contexto: AttemptContext = {
      idUsuario: null,
      ip: input.ip,
      userAgent: input.userAgent,
    };

    // El bloqueo se consulta ANTES de tocar la base de usuarios: si no, una
    // cuenta bajo ataque seguiria pagando una consulta y un hasheo por intento.
    const bloqueo = await this.lockout.check(email.value);
    if (bloqueo.bloqueado) {
      throw AppError.accountLocked(bloqueo.segundosRestantes);
    }

    const usuario = await this.usuarios.findByEmail(email);

    /**
     * Si el correo no existe se verifica igualmente contra un hash ficticio.
     *
     * Sin esto, una peticion con un correo desconocido responde mucho antes que
     * una con un correo real —no hay hash que comprobar— y esa diferencia de
     * tiempo permite averiguar que cuentas existen aunque el mensaje de error
     * sea siempre el mismo.
     */
    if (usuario === null) {
      await this.hasher.verify(input.contrasena, HASH_SENUELO);
      await this.lockout.registrarFallo(email.value, contexto);
      throw AppError.unauthenticated();
    }

    contexto.idUsuario = usuario.id;

    const coincide = await this.hasher.verify(input.contrasena, usuario.contrasenaHash);
    if (!coincide) {
      const estado = await this.lockout.registrarFallo(email.value, contexto);
      if (estado.bloqueado) {
        throw AppError.accountLocked(estado.segundosRestantes);
      }
      throw AppError.unauthenticated();
    }

    /**
     * El estado de la cuenta se comprueba DESPUES de validar la contrasena.
     *
     * Hacerlo antes convertiria el formulario en un detector de cuentas
     * suspendidas: bastaria con probar correos y leer el mensaje.
     */
    if (!usuario.puedeAutenticarse) {
      throw AppError.unauthenticated();
    }

    await this.lockout.registrarExito(email.value, contexto);

    const emitidos = await this.tokens.issue(usuario);

    await this.sesiones.crear({
      idUsuario: usuario.id,
      // Se guarda el hash, no el token: quien lea esta tabla no puede suplantar
      // a nadie.
      tokenHash: this.tokens.hashRefreshToken(emitidos.refreshToken),
      expiraAt: emitidos.refreshExpiresAt,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    const ahora = this.clock.now();
    usuario.registrarAcceso(ahora);
    await this.usuarios.update(usuario);

    /**
     * Si el algoritmo de hasheo quedo por detras de los parametros actuales, se
     * recalcula ahora que la contrasena en claro esta disponible. Es el unico
     * momento en que se puede hacer sin pedirsela al usuario.
     */
    if (this.hasher.needsRehash(usuario.contrasenaHash)) {
      usuario.cambiarContrasena(await this.hasher.hash(input.contrasena));
      await this.usuarios.update(usuario);
    }

    await this.eventos.enqueue(
      {
        eventName: EventName.UserAuthenticated,
        aggregateType: 'Usuario',
        aggregateId: usuario.id,
        payload: {
          userId: usuario.id,
          occurredAt: ahora.toISOString(),
          // La direccion se registra para la auditoria (RF101). El agente de
          // usuario no: aporta poco y es un dato de seguimiento.
          sourceIp: input.ip,
        },
      },
      input.correlationId
    );

    return {
      accessToken: emitidos.accessToken,
      refreshToken: emitidos.refreshToken,
      accessExpiresAt: emitidos.accessExpiresAt,
      refreshExpiresAt: emitidos.refreshExpiresAt,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        correo: usuario.email.value,
        roles: usuario.roles.toArray(),
      },
    };
  }
}

/**
 * Hash con forma valida de Argon2id que no corresponde a ninguna contrasena.
 *
 * Solo sirve para que la verificacion consuma el mismo tiempo cuando el correo
 * no existe. No es un secreto y no protege nada por si mismo.
 */
const HASH_SENUELO =
  '$argon2id$v=19$m=19456,t=2,p=1$c2VudWVsb3NlbnVlbG8$3+ZP0Zt9v0Xk1kq0kQ0kQ0kQ0kQ0kQ0kQ0kQ0kQ0kQ0';
