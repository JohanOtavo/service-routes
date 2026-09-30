import { hash, verify, Algorithm } from '@node-rs/argon2';
import type { IPasswordHasher } from '../../domain/ports/out';

export interface Argon2Params {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

/**
 * Hasheo de contrasenas con Argon2id.
 *
 * SRS RNF21 admite bcrypt con coste >= 12 o Argon2id; se elige Argon2id porque
 * resiste el descifrado con hardware dedicado, que es el ataque real contra una
 * base de contrasenas filtrada: bcrypt usa poca memoria y una GPU puede probar
 * muchas combinaciones en paralelo, mientras que Argon2id obliga a reservar
 * memoria por cada intento.
 *
 * Los parametros por defecto son los que recomienda OWASP: 19 MiB, 2
 * iteraciones, 1 hilo.
 */
export class Argon2PasswordHasher implements IPasswordHasher {
  constructor(private readonly params: Argon2Params) {}

  async hash(plain: string): Promise<string> {
    return hash(plain, {
      algorithm: Algorithm.Argon2id,
      memoryCost: this.params.memoryCost,
      timeCost: this.params.timeCost,
      parallelism: this.params.parallelism,
    });
  }

  /**
   * Devuelve false ante un hash con formato invalido en lugar de propagar.
   *
   * El caso llega desde el hash senuelo que se verifica cuando el correo no
   * existe: si eso lanzara una excepcion, el manejador de errores responderia
   * 500 justo para los correos inexistentes y devolveria por la puerta de atras
   * la distincion que el senuelo existe para ocultar.
   */
  async verify(plain: string, hashed: string): Promise<boolean> {
    try {
      return await verify(hashed, plain);
    } catch {
      return false;
    }
  }

  /**
   * Indica si el hash se produjo con parametros por debajo de los actuales.
   *
   * Los parametros se endurecen con el tiempo. Sin esta comprobacion, quien se
   * registro hace anos conserva para siempre un hash mas facil de romper que el
   * de quien se registro ayer. El recalculo ocurre en el inicio de sesion, que
   * es el unico momento en que la contrasena en claro esta disponible.
   */
  needsRehash(hashed: string): boolean {
    const encontrado = /\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/u.exec(hashed);
    if (encontrado === null) return true; // formato desconocido o algoritmo antiguo

    const [, memoria, tiempo, paralelismo] = encontrado;
    return (
      Number(memoria) < this.params.memoryCost ||
      Number(tiempo) < this.params.timeCost ||
      Number(paralelismo) < this.params.parallelism
    );
  }
}
