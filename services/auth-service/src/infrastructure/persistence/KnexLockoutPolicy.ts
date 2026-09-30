import type { Knex } from 'knex';
import type { AttemptContext, ILockoutPolicy, LockoutState } from '../../domain/ports/out';

export interface LockoutConfig {
  maxAttempts: number;
  baseSeconds: number;
  maxSeconds: number;
  windowSeconds: number;
}

/**
 * Bloqueo progresivo por intentos fallidos.
 *
 * No estaba en el SRS: lo exige el brief de construccion y queda documentado
 * como requisito propuesto, no colado en silencio.
 *
 * El retardo crece de forma exponencial en lugar de bloquear de golpe. Un
 * bloqueo fijo y largo convierte el mecanismo en una via de denegacion de
 * servicio contra un tercero: basta con fallar cinco veces con el correo de otra
 * persona para dejarla fuera. Un retardo creciente hace inviable la fuerza bruta
 * —cada intento cuesta el doble que el anterior— y a la vez deja recuperar la
 * cuenta en segundos tras un puñado de errores honestos.
 */
export class KnexLockoutPolicy implements ILockoutPolicy {
  constructor(
    private readonly knex: Knex,
    private readonly config: LockoutConfig
  ) {}

  /**
   * Conexion propia, DELIBERADAMENTE fuera de la transaccion de la peticion.
   *
   * Un intento fallido termina lanzando una excepcion, y esa excepcion revierte
   * la transaccion del inicio de sesion. Si el registro del fallo viviera dentro
   * de ella, se revertiria con todo lo demas: el contador volveria a cero en
   * cada intento y el bloqueo no llegaria a activarse nunca, dejando la fuerza
   * bruta sin ningun freno.
   *
   * Es justo lo contrario del outbox: alli el evento DEBE compartir la suerte de
   * la transaccion, y aqui el registro debe sobrevivir a su fracaso.
   */
  private get db(): Knex {
    return this.knex;
  }

  async check(correo: string): Promise<LockoutState> {
    const fila = await this.db('login_lockout')
      .where({ correo })
      .select<{ fallos_consecutivos: number; bloqueado_hasta: Date | null }[]>(
        'fallos_consecutivos',
        'bloqueado_hasta'
      )
      .first();

    if (fila === undefined) {
      return { bloqueado: false, segundosRestantes: 0, fallosConsecutivos: 0 };
    }

    const restanteMs =
      fila.bloqueado_hasta === null ? 0 : fila.bloqueado_hasta.getTime() - Date.now();

    return {
      bloqueado: restanteMs > 0,
      segundosRestantes: restanteMs > 0 ? Math.ceil(restanteMs / 1000) : 0,
      fallosConsecutivos: fila.fallos_consecutivos,
    };
  }

  async registrarFallo(correo: string, contexto: AttemptContext): Promise<LockoutState> {
    await this.registrarIntento(correo, contexto, false);

    const previo = await this.db('login_lockout')
      .where({ correo })
      .select<{ fallos_consecutivos: number }[]>('fallos_consecutivos')
      .first();

    const fallos = (previo?.fallos_consecutivos ?? 0) + 1;
    const bloqueadoHasta = this.calcularBloqueo(fallos);

    await this.db('login_lockout')
      .insert({
        correo,
        fallos_consecutivos: fallos,
        bloqueado_hasta: bloqueadoHasta,
        ultimo_fallo_at: new Date(),
      })
      .onConflict('correo')
      .merge(['fallos_consecutivos', 'bloqueado_hasta', 'ultimo_fallo_at']);

    const restanteMs = bloqueadoHasta === null ? 0 : bloqueadoHasta.getTime() - Date.now();

    return {
      bloqueado: restanteMs > 0,
      segundosRestantes: restanteMs > 0 ? Math.ceil(restanteMs / 1000) : 0,
      fallosConsecutivos: fallos,
    };
  }

  async registrarExito(correo: string, contexto: AttemptContext): Promise<void> {
    await this.registrarIntento(correo, contexto, true);

    // Un acceso correcto limpia el contador: quien demostro ser el dueno no
    // debe arrastrar los errores que cometio antes de acertar.
    await this.db('login_lockout')
      .insert({ correo, fallos_consecutivos: 0, bloqueado_hasta: null })
      .onConflict('correo')
      .merge(['fallos_consecutivos', 'bloqueado_hasta']);
  }

  /**
   * Retardo exponencial: base * 2^(fallos - umbral), acotado por el maximo.
   *
   * Con base 30 s y umbral 5: el quinto fallo espera 30 s, el sexto 60, el
   * septimo 120. Probar mil contrasenas pasa a llevar dias.
   */
  private calcularBloqueo(fallos: number): Date | null {
    if (fallos < this.config.maxAttempts) return null;

    const exceso = fallos - this.config.maxAttempts;
    const segundos = Math.min(
      this.config.baseSeconds * 2 ** exceso,
      this.config.maxSeconds
    );

    return new Date(Date.now() + segundos * 1000);
  }

  /**
   * Deja constancia del intento para la auditoria (SRS RF20).
   *
   * Guarda el correo tecleado aunque no corresponda a ninguna cuenta: un barrido
   * de correos inexistentes es precisamente la senal que interesa detectar.
   * Nunca guarda la contrasena probada, ni siquiera hasheada.
   */
  private async registrarIntento(
    correo: string,
    contexto: AttemptContext,
    exitoso: boolean
  ): Promise<void> {
    await this.db('login_attempt').insert({
      correo_intentado: correo,
      id_usuario: contexto.idUsuario,
      exitoso,
      ip_origen: contexto.ip,
      user_agent: contexto.userAgent?.slice(0, 255) ?? null,
    });
  }
}
