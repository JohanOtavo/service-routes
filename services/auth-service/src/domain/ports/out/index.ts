/**
 * Puertos de salida: lo que el dominio NECESITA, expresado por el dominio.
 *
 * Las interfaces viven aqui y las implementaciones en infrastructure/. Asi la
 * dependencia apunta hacia adentro: cambiar Argon2 por otro algoritmo, o MySQL
 * por otro motor, no toca una sola linea de dominio ni de casos de uso.
 */
import type { Usuario } from '../../entities/Usuario';
import type { Email } from '../../value-objects/Email';
import type { EventNameValue } from '@punto-amigo/shared';

export interface IUsuarioRepository {
  findByEmail(email: Email): Promise<Usuario | null>;
  findById(id: number): Promise<Usuario | null>;
  existsByEmail(email: Email): Promise<boolean>;
  /** Persiste y devuelve el usuario con el identificador ya asignado. */
  save(usuario: Usuario): Promise<Usuario>;
  update(usuario: Usuario): Promise<void>;
}

export interface IPasswordHasher {
  hash(plain: string): Promise<string>;
  /**
   * Debe comparar en tiempo constante: una comparacion que sale antes cuando
   * los primeros caracteres difieren filtra informacion por el tiempo.
   */
  verify(plain: string, hash: string): Promise<boolean>;
  /** Indica si el hash se creo con parametros ya obsoletos y conviene recalcularlo. */
  needsRehash(hash: string): boolean;
}

export interface TokenClaims {
  sub: string;
  roles: string[];
  jti: string;
}

export interface IssuedTokens {
  accessToken: string;
  /** Valor en claro. Solo viaja en la cookie; en la base se guarda su hash. */
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  jti: string;
}

export interface ITokenService {
  issue(usuario: Usuario): Promise<IssuedTokens>;
  verifyAccess(token: string): Promise<TokenClaims>;
  hashRefreshToken(token: string): string;
}

/** Resultado de consultar el bloqueo progresivo por intentos fallidos. */
export interface LockoutState {
  bloqueado: boolean;
  segundosRestantes: number;
  fallosConsecutivos: number;
}

export interface ILockoutPolicy {
  check(correo: string): Promise<LockoutState>;
  registrarFallo(correo: string, contexto: AttemptContext): Promise<LockoutState>;
  registrarExito(correo: string, contexto: AttemptContext): Promise<void>;
}

export interface AttemptContext {
  idUsuario: number | null;
  ip: string | null;
  userAgent: string | null;
}

export interface SesionRefresco {
  id: number;
  idUsuario: number;
  expiraAt: Date;
  revocadaAt: Date | null;
  reemplazadoPor: number | null;
}

export interface ISessionRepository {
  crear(input: {
    idUsuario: number;
    tokenHash: string;
    expiraAt: Date;
    ip: string | null;
    userAgent: string | null;
  }): Promise<number>;
  buscarPorHash(tokenHash: string): Promise<SesionRefresco | null>;
  revocar(idSesion: number, motivo: string): Promise<void>;
  /** Revoca toda la cadena de rotacion: se usa al detectar reuso de un token. */
  revocarCadena(idSesion: number, motivo: string): Promise<void>;
  marcarRotada(idSesionAnterior: number, idSesionNueva: number): Promise<void>;
  denegarAccessToken(jti: string, idUsuario: number, expiraAt: Date): Promise<void>;
}

export interface EventoAPublicar {
  eventName: EventNameValue;
  aggregateType: string;
  aggregateId: string | number;
  payload: Record<string, unknown>;
}

export interface IEventPublisher {
  /**
   * Escribe el evento en la tabla outbox DENTRO de la transaccion de negocio.
   *
   * No publica al broker: de eso se encarga un proceso aparte. Asi no puede
   * ocurrir que la escritura se confirme y el evento se pierda (SRS RNF46).
   */
  enqueue(evento: EventoAPublicar, correlationId: string): Promise<void>;
}

/** Reloj inyectable: sin el, nada que dependa del tiempo es comprobable. */
export interface IClock {
  now(): Date;
}

/** Generador de identificadores, por el mismo motivo que el reloj. */
export interface IIdGenerator {
  uuid(): string;
}
