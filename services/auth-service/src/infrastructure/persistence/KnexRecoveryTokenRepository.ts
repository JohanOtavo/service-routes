import { createHash, randomBytes } from 'node:crypto';
import type { Knex } from 'knex';
import type { IRecoveryTokenRepository, TokenRecuperacion } from '../../domain/ports/out';
import { currentDb } from './transaction';

/**
 * Tokens de recuperacion de contrasena.
 *
 * Se guarda el hash, igual que con los refresh tokens: quien lea esta tabla no
 * debe poder tomar el control de ninguna cuenta. El valor en claro existe una
 * sola vez, cuando se crea, y viaja al correo del usuario.
 */
export class KnexRecoveryTokenRepository implements IRecoveryTokenRepository {
  constructor(private readonly knex: Knex) {}

  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  private static hash(token: string): string {
    // SHA-256 y no Argon2: el valor son 32 bytes aleatorios, no hay nada que
    // adivinar, y un hasheo lento solo anadiria latencia.
    return createHash('sha256').update(token).digest('hex');
  }

  async crear(input: { idUsuario: number; expiraAt: Date }): Promise<string> {
    const token = randomBytes(32).toString('base64url');

    await this.db('password_recovery_token').insert({
      id_usuario: input.idUsuario,
      token_hash: KnexRecoveryTokenRepository.hash(token),
      expira_at: input.expiraAt,
    });

    return token;
  }

  async buscarVigente(token: string, ahora: Date): Promise<TokenRecuperacion | null> {
    const fila = await this.db('password_recovery_token')
      .where('token_hash', KnexRecoveryTokenRepository.hash(token))
      // Sin usar y sin vencer: las dos condiciones que lo hacen valido.
      .whereNull('usado_at')
      .where('expira_at', '>', ahora)
      .first<{ id_token: number; id_usuario: number } | undefined>(
        'id_token',
        'id_usuario'
      );

    return fila === undefined ? null : { id: fila.id_token, idUsuario: fila.id_usuario };
  }

  async marcarUsado(id: number, ahora: Date): Promise<void> {
    await this.db('password_recovery_token')
      .where({ id_token: id })
      .whereNull('usado_at')
      .update({ usado_at: ahora });
  }

  async invalidarPendientes(idUsuario: number): Promise<void> {
    await this.db('password_recovery_token')
      .where({ id_usuario: idUsuario })
      .whereNull('usado_at')
      .update({ usado_at: new Date() });
  }
}
