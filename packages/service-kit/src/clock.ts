import { randomUUID } from 'node:crypto';
export interface IClock {
  now(): Date;
}

export interface IIdGenerator {
  uuid(): string;
}

/**
 * Reloj y generador de identificadores reales.
 *
 * Existen como adaptadores para que el dominio dependa de una interfaz y no de
 * Date.now(): sin eso, cualquier regla que dependa del tiempo —la expiracion de
 * un token, la ventana de gracia de una cancelacion— solo se podria probar
 * esperando.
 */
export class SystemClock implements IClock {
  now(): Date {
    return new Date();
  }
}

export class UuidGenerator implements IIdGenerator {
  uuid(): string {
    return randomUUID();
  }
}
