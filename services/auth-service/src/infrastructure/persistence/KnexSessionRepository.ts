import type { Knex } from 'knex';
import type { ISessionRepository, SesionRefresco } from '../../domain/ports/out';
import { currentDb } from './transaction';

interface FilaSesion {
  id_sesion: number;
  id_usuario: number;
  expira_at: Date;
  revocado_at: Date | null;
  reemplazado_por: number | null;
}

/**
 * Sesiones de refresco y lista de denegacion de access tokens.
 *
 * SRS: RF8 (renovacion), RF10 (cierre de sesion), RF11 (expiracion).
 */
export class KnexSessionRepository implements ISessionRepository {
  constructor(private readonly knex: Knex) {}

  private get db(): Knex | Knex.Transaction {
    return currentDb(this.knex);
  }

  async crear(input: {
    idUsuario: number;
    tokenHash: string;
    expiraAt: Date;
    ip: string | null;
    userAgent: string | null;
  }): Promise<number> {
    const [id] = await this.db('refresh_session').insert({
      id_usuario: input.idUsuario,
      token_hash: input.tokenHash,
      expira_at: input.expiraAt,
      ip_origen: input.ip,
      // Se recorta en lugar de rechazar: un agente de usuario largo es un dato
      // de diagnostico, no una razon para impedir el acceso.
      user_agent: input.userAgent?.slice(0, 255) ?? null,
    });
    return Number(id);
  }

  async buscarPorHash(tokenHash: string): Promise<SesionRefresco | null> {
    const fila = await this.db<FilaSesion>('refresh_session')
      .where('token_hash', tokenHash)
      .first();

    return fila === undefined
      ? null
      : {
          id: fila.id_sesion,
          idUsuario: fila.id_usuario,
          expiraAt: fila.expira_at,
          revocadaAt: fila.revocado_at,
          reemplazadoPor: fila.reemplazado_por,
        };
  }

  async revocar(idSesion: number, motivo: string): Promise<void> {
    await this.db('refresh_session')
      .where({ id_sesion: idSesion })
      .whereNull('revocado_at')
      .update({ revocado_at: new Date(), motivo_revocacion: motivo });
  }

  /**
   * Revoca la cadena completa de rotacion a la que pertenece una sesion.
   *
   * Se invoca al detectar que se reutilizo un refresh token ya rotado. Esa
   * reutilizacion significa que dos partes tienen el mismo token: la legitima y
   * quien lo copio. Como no hay forma de saber cual de las dos esta usandolo,
   * la respuesta correcta es invalidar todas y obligar a autenticarse de nuevo.
   */
  async revocarCadena(idSesion: number, motivo: string): Promise<void> {
    const visitadas = new Set<number>();
    const pendientes = [idSesion];
    const ahora = new Date();

    // Hacia adelante por los reemplazos.
    while (pendientes.length > 0) {
      const actual = pendientes.pop();
      if (actual === undefined || visitadas.has(actual)) continue;
      visitadas.add(actual);

      const fila = await this.db<FilaSesion>('refresh_session')
        .where({ id_sesion: actual })
        .first();
      if (fila?.reemplazado_por != null) pendientes.push(fila.reemplazado_por);

      const anteriores = await this.db<FilaSesion>('refresh_session')
        .where({ reemplazado_por: actual })
        .select('id_sesion');
      for (const a of anteriores) pendientes.push(a.id_sesion);
    }

    await this.db('refresh_session')
      .whereIn('id_sesion', [...visitadas])
      .whereNull('revocado_at')
      .update({ revocado_at: ahora, motivo_revocacion: motivo });
  }

  async marcarRotada(idSesionAnterior: number, idSesionNueva: number): Promise<void> {
    await this.db('refresh_session').where({ id_sesion: idSesionAnterior }).update({
      revocado_at: new Date(),
      motivo_revocacion: 'ROTACION',
      reemplazado_por: idSesionNueva,
    });
  }

  /**
   * Anade un access token a la lista de denegacion hasta su expiracion natural.
   *
   * Solo guarda el jti, nunca el token completo: el identificador basta para
   * rechazarlo y no sirve para suplantar a nadie si esta tabla se filtra.
   */
  async denegarAccessToken(jti: string, idUsuario: number, expiraAt: Date): Promise<void> {
    await this.db('token_denylist')
      .insert({ jti, id_usuario: idUsuario, expira_at: expiraAt })
      .onConflict('jti')
      .ignore();
  }

  /** Consulta que usa el guardia HTTP en cada peticion protegida. */
  async estaDenegado(jti: string): Promise<boolean> {
    const fila = await this.db('token_denylist').where({ jti }).select('jti').first();
    return fila !== undefined;
  }
}
