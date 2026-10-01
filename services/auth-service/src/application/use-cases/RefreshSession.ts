import { AppError } from '@punto-amigo/shared';
import type {
  IClock,
  ISessionRepository,
  ITokenService,
  IUsuarioRepository,
} from '../../domain/ports/out';

export interface RefreshInput {
  refreshToken: string | undefined;
  ip: string | null;
  userAgent: string | null;
}

export interface RefreshOutput {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

/**
 * Renovacion de sesion con rotacion y deteccion de reuso.
 *
 * SRS: RF8.
 *
 * Cada renovacion emite un refresh token nuevo e invalida el anterior. Sin
 * rotacion, un token robado sirve durante toda su vida —siete dias— sin que
 * nadie pueda notarlo; con rotacion, el robo se delata en cuanto una de las dos
 * partes renueva, porque la otra intentara usar un token ya consumido.
 */
export class RefreshSessionUseCase {
  constructor(
    private readonly usuarios: IUsuarioRepository,
    private readonly sesiones: ISessionRepository,
    private readonly tokens: ITokenService,
    private readonly clock: IClock
  ) {}

  async execute(input: RefreshInput): Promise<RefreshOutput> {
    if (input.refreshToken === undefined || input.refreshToken.length === 0) {
      throw AppError.unauthenticated('No hay sesion que renovar.');
    }

    const hash = this.tokens.hashRefreshToken(input.refreshToken);
    const sesion = await this.sesiones.buscarPorHash(hash);

    if (sesion === null) {
      throw AppError.unauthenticated('La sesion no es valida.');
    }

    /**
     * Reuso de un token ya rotado: alguien mas lo tiene.
     *
     * Cuando una sesion ya fue reemplazada y su token vuelve a presentarse,
     * significa que existen dos copias: la legitima, que ya renovo, y otra. No
     * hay forma de saber cual esta llamando, asi que se invalida la cadena
     * entera y ambas partes tienen que autenticarse de nuevo. Es incomodo para
     * el usuario legitimo y es la unica respuesta correcta.
     */
    if (sesion.reemplazadoPor !== null || sesion.revocadaAt !== null) {
      await this.sesiones.revocarCadena(sesion.id, 'REUSO_DETECTADO');
      throw AppError.unauthenticated('La sesion fue invalidada por seguridad.');
    }

    if (sesion.expiraAt.getTime() <= this.clock.now().getTime()) {
      await this.sesiones.revocar(sesion.id, 'EXPIRADA');
      throw AppError.unauthenticated('La sesion expiro.');
    }

    const usuario = await this.usuarios.findById(sesion.idUsuario);

    // Se vuelve a comprobar el estado de la cuenta: pudo suspenderse despues de
    // emitir el token, y el JWT por si solo no se entera.
    if (usuario === null || !usuario.puedeAutenticarse) {
      await this.sesiones.revocarCadena(sesion.id, 'CUENTA_NO_ACTIVA');
      throw AppError.unauthenticated('La sesion no es valida.');
    }

    const emitidos = await this.tokens.issue(usuario);

    const idNueva = await this.sesiones.crear({
      idUsuario: usuario.id,
      tokenHash: this.tokens.hashRefreshToken(emitidos.refreshToken),
      expiraAt: emitidos.refreshExpiresAt,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    // Encadena la rotacion: es lo que permite detectar el reuso mas adelante.
    await this.sesiones.marcarRotada(sesion.id, idNueva);

    return {
      accessToken: emitidos.accessToken,
      refreshToken: emitidos.refreshToken,
      accessExpiresAt: emitidos.accessExpiresAt,
      refreshExpiresAt: emitidos.refreshExpiresAt,
    };
  }
}
