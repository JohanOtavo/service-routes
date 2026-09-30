import jwt from 'jsonwebtoken';
import { AppError } from '@punto-amigo/shared';

export interface IdentidadVerificada {
  userId: string;
  roles: string[];
  jti: string;
}

/** Copia caliente de la lista de denegacion; la duradera vive en pa_auth. */
export interface DenylistCache {
  estaDenegado(jti: string): Promise<boolean>;
}

export interface TokenVerifierConfig {
  publicKey: string;
  issuer: string;
  audience: string;
}

/**
 * Verificacion del access token en el borde.
 *
 * El gateway solo tiene la clave PUBLICA. Es lo que hace que auth-service sea el
 * unico capaz de emitir identidades: si el gateway se viera comprometido, quien
 * lo controle podria leer y dejar pasar tokens, pero no fabricar uno nuevo.
 *
 * SRS: SRS-GW-03, RNF23.
 */
export class TokenVerifier {
  constructor(
    private readonly config: TokenVerifierConfig,
    private readonly denylist: DenylistCache
  ) {}

  async verificar(cabeceraAutorizacion: string | undefined): Promise<IdentidadVerificada> {
    if (cabeceraAutorizacion === undefined || !cabeceraAutorizacion.startsWith('Bearer ')) {
      throw AppError.unauthenticated('Falta el token de acceso.');
    }

    const token = cabeceraAutorizacion.slice('Bearer '.length).trim();

    let payload: jwt.JwtPayload;
    try {
      const verificado = jwt.verify(token, this.config.publicKey, {
        /**
         * El algoritmo se fija aqui y no se lee de la cabecera del token.
         *
         * Aceptar el que venga permite el ataque de confusion de algoritmo: el
         * atacante firma con HS256 usando como secreto compartido la clave
         * publica, que por definicion es conocida, y la libreria lo valida.
         */
        algorithms: ['RS256'],
        issuer: this.config.issuer,
        audience: this.config.audience,
      });

      if (typeof verificado === 'string') throw new Error('payload no estructurado');
      payload = verificado;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw AppError.unauthenticated('La sesion expiro.');
      }
      throw AppError.unauthenticated('Token invalido.');
    }

    if (payload.sub === undefined || payload.jti === undefined) {
      throw AppError.unauthenticated('Token invalido.');
    }

    /**
     * La firma valida no basta: un JWT es autocontenido y seguiria sirviendo
     * hasta expirar aunque el usuario hubiera cerrado sesion (SRS RF10).
     *
     * Si la cache no esta disponible se DENIEGA. Es la decision incomoda:
     * dejar pasar ante la duda convertiria una caida de Redis en una ventana
     * durante la cual todos los tokens revocados vuelven a funcionar.
     */
    if (await this.denylist.estaDenegado(payload.jti)) {
      throw AppError.unauthenticated('La sesion fue cerrada.');
    }

    return {
      userId: payload.sub,
      jti: payload.jti,
      roles: Array.isArray(payload['roles']) ? (payload['roles'] as string[]) : [],
    };
  }
}

/** Implementacion sobre Redis. Falla cerrado si Redis no responde. */
export class RedisDenylist implements DenylistCache {
  constructor(
    private readonly redis: { get(clave: string): Promise<string | null> },
    private readonly prefijo = 'denylist:'
  ) {}

  async estaDenegado(jti: string): Promise<boolean> {
    try {
      return (await this.redis.get(`${this.prefijo}${jti}`)) !== null;
    } catch {
      // Denegar ante el fallo. Un rechazo temporal obliga a volver a
      // autenticarse; lo contrario reabriria todas las sesiones cerradas.
      return true;
    }
  }
}
