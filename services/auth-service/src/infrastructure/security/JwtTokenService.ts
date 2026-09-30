import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { AppError } from '@punto-amigo/shared';
import type { Usuario } from '../../domain/entities/Usuario';
import type { IssuedTokens, ITokenService, TokenClaims } from '../../domain/ports/out';

export interface JwtConfig {
  privateKey: string;
  publicKey: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
  issuer: string;
  audience: string;
}

/**
 * Emision y verificacion de tokens.
 *
 * Dos tipos con papeles distintos:
 *
 * - **Access token**: JWT firmado con RS256, vida corta (15 min por defecto).
 *   Es autocontenido, de modo que el gateway y cada servicio pueden validarlo
 *   sin consultar a nadie. Se firma con clave asimetrica para que auth-service
 *   sea el unico capaz de emitir: los demas solo necesitan la clave publica, y
 *   comprometer a uno de ellos no permite fabricar identidades.
 *
 * - **Refresh token**: cadena aleatoria opaca, no un JWT. No lleva informacion,
 *   asi que no hay nada que leer si se intercepta, y se guarda hasheado, asi
 *   que tampoco hay nada que robar en la base de datos.
 *
 * SRS: RF7, RF8, RNF22. El TTL de 15 minutos lo fija el brief de construccion;
 * el SRS lo dejaba por definir.
 */
export class JwtTokenService implements ITokenService {
  constructor(private readonly config: JwtConfig) {}

  async issue(usuario: Usuario): Promise<IssuedTokens> {
    const ahora = Date.now();
    // El jti permite revocar un access token concreto en la lista de
    // denegacion: sin el, un JWT robado seguiria siendo valido hasta expirar
    // aunque el usuario cerrara sesion (SRS RF10).
    const jti = randomUUID();

    const accessToken = jwt.sign(
      { roles: usuario.roles.toArray() },
      this.config.privateKey,
      {
        algorithm: 'RS256',
        subject: String(usuario.id),
        jwtid: jti,
        expiresIn: this.config.accessTtlSeconds,
        issuer: this.config.issuer,
        audience: this.config.audience,
      }
    );

    // 32 bytes de aleatoriedad criptografica. No se deriva de nada del usuario:
    // un token predecible a partir del identificador seria adivinable.
    const refreshToken = randomBytes(32).toString('base64url');

    return {
      accessToken,
      refreshToken,
      accessExpiresAt: new Date(ahora + this.config.accessTtlSeconds * 1000),
      refreshExpiresAt: new Date(ahora + this.config.refreshTtlSeconds * 1000),
      jti,
    };
  }

  async verifyAccess(token: string): Promise<TokenClaims> {
    try {
      const payload = jwt.verify(token, this.config.publicKey, {
        // Se fija el algoritmo de forma explicita. Aceptar el que venga en la
        // cabecera permite el ataque de confusion de algoritmo: un atacante
        // firma con HS256 usando la clave publica como secreto compartido.
        algorithms: ['RS256'],
        issuer: this.config.issuer,
        audience: this.config.audience,
      });

      if (typeof payload === 'string' || payload.sub === undefined || payload.jti === undefined) {
        throw AppError.unauthenticated('Token invalido.');
      }

      return {
        sub: payload.sub,
        jti: payload.jti,
        roles: Array.isArray(payload['roles']) ? (payload['roles'] as string[]) : [],
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (error instanceof jwt.TokenExpiredError) {
        throw AppError.unauthenticated('La sesion expiro.');
      }
      throw AppError.unauthenticated('Token invalido.');
    }
  }

  /**
   * SHA-256 y no Argon2 para el refresh token.
   *
   * Argon2 es lento a proposito, y esa lentitud protege contra adivinar una
   * contrasena elegida por una persona. Aqui el valor son 32 bytes aleatorios:
   * no hay nada que adivinar, y un hasheo lento solo anadiria latencia a cada
   * renovacion de sesion.
   */
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
