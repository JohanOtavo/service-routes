/**
 * Pruebas del inicio de sesion.
 *
 * Buena parte comprueba lo que el sistema NO debe hacer: no revelar si un correo
 * existe, no aceptar una cuenta suspendida, no dejar de contar un intento
 * fallido. Son las que impiden que una optimizacion futura reabra un agujero.
 */
import { AppError } from '@punto-amigo/shared';
import { AuthenticateUserUseCase } from '../src/application/use-cases/AuthenticateUser';
import { RegisterUserUseCase } from '../src/application/use-cases/RegisterUser';
import { Usuario } from '../src/domain/entities/Usuario';
import { Email } from '../src/domain/value-objects/Email';
import { UserRoles } from '../src/domain/value-objects/UserRole';
import type {
  AttemptContext,
  EventoAPublicar,
  IClock,
  IEventPublisher,
  ILockoutPolicy,
  IPasswordHasher,
  ISessionRepository,
  ITokenService,
  IUsuarioRepository,
  IssuedTokens,
  LockoutState,
  SesionRefresco,
  TokenClaims,
} from '../src/domain/ports/out';

const AHORA = new Date('2026-09-30T12:00:00.000Z');

class RelojFijo implements IClock {
  now(): Date {
    return AHORA;
  }
}

/** Hasher falso: prefija el valor. Suficiente para el dominio y determinista. */
class HasherFalso implements IPasswordHasher {
  public verificaciones: string[] = [];
  private rehashPendiente = false;

  async hash(plain: string): Promise<string> {
    return `hash:${plain}`;
  }
  async verify(plain: string, hash: string): Promise<boolean> {
    this.verificaciones.push(hash);
    return hash === `hash:${plain}`;
  }
  needsRehash(): boolean {
    return this.rehashPendiente;
  }
  exigirRehash(): void {
    this.rehashPendiente = true;
  }
}

class RepositorioEnMemoria implements IUsuarioRepository {
  private readonly porId = new Map<number, Usuario>();
  private siguienteId = 1;

  async findByEmail(email: Email): Promise<Usuario | null> {
    for (const u of this.porId.values()) {
      if (u.email.equals(email)) return u;
    }
    return null;
  }
  async findById(id: number): Promise<Usuario | null> {
    return this.porId.get(id) ?? null;
  }
  async existsByEmail(email: Email): Promise<boolean> {
    return (await this.findByEmail(email)) !== null;
  }
  async save(usuario: Usuario): Promise<Usuario> {
    const id = this.siguienteId++;
    const persistido = Usuario.rehydrate({
      id,
      nombre: usuario.nombre,
      email: usuario.email,
      contrasenaHash: usuario.contrasenaHash,
      telefono: usuario.telefono,
      estado: usuario.estado,
      roles: usuario.roles,
      ultimoAccesoAt: null,
      deletedAt: null,
    });
    this.porId.set(id, persistido);
    return persistido;
  }
  async update(usuario: Usuario): Promise<void> {
    this.porId.set(usuario.id, usuario);
  }
}

class TokensFalsos implements ITokenService {
  async issue(usuario: Usuario): Promise<IssuedTokens> {
    return {
      accessToken: `access:${usuario.id}`,
      refreshToken: `refresh:${usuario.id}`,
      accessExpiresAt: new Date(AHORA.getTime() + 900_000),
      refreshExpiresAt: new Date(AHORA.getTime() + 604_800_000),
      jti: `jti:${usuario.id}`,
    };
  }
  async verifyAccess(): Promise<TokenClaims> {
    return { sub: '1', roles: ['SOLICITANTE'], jti: 'jti:1' };
  }
  hashRefreshToken(token: string): string {
    return `sha:${token}`;
  }
}

class SesionesFalsas implements ISessionRepository {
  public creadas: { idUsuario: number; tokenHash: string }[] = [];
  async crear(input: { idUsuario: number; tokenHash: string }): Promise<number> {
    this.creadas.push({ idUsuario: input.idUsuario, tokenHash: input.tokenHash });
    return this.creadas.length;
  }
  async buscarPorHash(): Promise<SesionRefresco | null> {
    return null;
  }
  async revocar(): Promise<void> {}
  async revocarCadena(): Promise<void> {}
  async marcarRotada(): Promise<void> {}
  async revocarTodasDe(): Promise<void> {}
  async denegarAccessToken(): Promise<void> {}
}

class BloqueoFalso implements ILockoutPolicy {
  public fallos = 0;
  public exitos = 0;
  private bloqueado = false;

  async check(): Promise<LockoutState> {
    return {
      bloqueado: this.bloqueado,
      segundosRestantes: this.bloqueado ? 30 : 0,
      fallosConsecutivos: this.fallos,
    };
  }
  async registrarFallo(_correo: string, _ctx: AttemptContext): Promise<LockoutState> {
    this.fallos += 1;
    this.bloqueado = this.fallos >= 5;
    return {
      bloqueado: this.bloqueado,
      segundosRestantes: this.bloqueado ? 30 : 0,
      fallosConsecutivos: this.fallos,
    };
  }
  async registrarExito(): Promise<void> {
    this.exitos += 1;
    this.fallos = 0;
    this.bloqueado = false;
  }
  forzarBloqueo(): void {
    this.bloqueado = true;
  }
}

class EventosFalsos implements IEventPublisher {
  public publicados: EventoAPublicar[] = [];
  async enqueue(evento: EventoAPublicar): Promise<void> {
    this.publicados.push(evento);
  }
}

interface Montaje {
  usuarios: RepositorioEnMemoria;
  hasher: HasherFalso;
  tokens: TokensFalsos;
  sesiones: SesionesFalsas;
  bloqueo: BloqueoFalso;
  eventos: EventosFalsos;
  registrar: RegisterUserUseCase;
  autenticar: AuthenticateUserUseCase;
}

function montar(): Montaje {
  const usuarios = new RepositorioEnMemoria();
  const hasher = new HasherFalso();
  const tokens = new TokensFalsos();
  const sesiones = new SesionesFalsas();
  const bloqueo = new BloqueoFalso();
  const eventos = new EventosFalsos();
  const reloj = new RelojFijo();

  return {
    usuarios,
    hasher,
    tokens,
    sesiones,
    bloqueo,
    eventos,
    registrar: new RegisterUserUseCase(usuarios, hasher, eventos, reloj),
    autenticar: new AuthenticateUserUseCase(
      usuarios,
      hasher,
      tokens,
      sesiones,
      bloqueo,
      eventos,
      reloj
    ),
  };
}

const ALTA = {
  nombre: 'Marta Solicitante',
  correo: 'marta@puntoamigo.local',
  contrasena: 'ContrasenaLarga2026',
  confirmacionContrasena: 'ContrasenaLarga2026',
  correlationId: '11111111-1111-4111-8111-111111111111',
};

const CREDENCIALES = {
  correo: 'marta@puntoamigo.local',
  contrasena: 'ContrasenaLarga2026',
  correlationId: '22222222-2222-4222-8222-222222222222',
  ip: '203.0.113.5',
  userAgent: 'jest',
};

describe('registro', () => {
  it('crea la cuenta con el rol SOLICITANTE y publica UserRegistered', async () => {
    const s = montar();
    const salida = await s.registrar.execute(ALTA);

    expect(salida.roles).toEqual(['SOLICITANTE']);
    expect(s.eventos.publicados).toHaveLength(1);
    expect(s.eventos.publicados[0]?.eventName).toBe('UserRegistered');
  });

  it('el evento no lleva la contrasena ni su hash', async () => {
    const s = montar();
    await s.registrar.execute(ALTA);

    const serializado = JSON.stringify(s.eventos.publicados[0]);
    expect(serializado).not.toContain('ContrasenaLarga2026');
    expect(serializado).not.toContain('hash:');
  });

  it('normaliza el correo, de modo que dos grafias son la misma cuenta', async () => {
    const s = montar();
    await s.registrar.execute(ALTA);

    await expect(
      s.registrar.execute({ ...ALTA, correo: '  MARTA@PuntoAmigo.LOCAL ' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('rechaza cuando la confirmacion no coincide', async () => {
    const s = montar();
    await expect(
      s.registrar.execute({ ...ALTA, confirmacionContrasena: 'otra-distinta-2026' })
    ).rejects.toBeInstanceOf(AppError);
  });

  it('rechaza una contrasena por debajo de la longitud minima', async () => {
    const s = montar();
    await expect(
      s.registrar.execute({ ...ALTA, contrasena: 'corta12', confirmacionContrasena: 'corta12' })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('autenticacion', () => {
  it('emite tokens y guarda el HASH del refresh, nunca el token', async () => {
    const s = montar();
    await s.registrar.execute(ALTA);

    const salida = await s.autenticar.execute(CREDENCIALES);

    expect(salida.accessToken).toBe('access:1');
    expect(s.sesiones.creadas[0]?.tokenHash).toBe('sha:refresh:1');
    expect(s.sesiones.creadas[0]?.tokenHash).not.toBe(salida.refreshToken);
  });

  it('responde lo mismo con correo inexistente que con contrasena incorrecta', async () => {
    const s = montar();
    await s.registrar.execute(ALTA);

    const inexistente = await s.autenticar
      .execute({ ...CREDENCIALES, correo: 'nadie@puntoamigo.local' })
      .catch((e: AppError) => e);
    const incorrecta = await s.autenticar
      .execute({ ...CREDENCIALES, contrasena: 'ContrasenaIncorrecta2026' })
      .catch((e: AppError) => e);

    expect((inexistente as AppError).message).toBe((incorrecta as AppError).message);
    expect((inexistente as AppError).httpStatus).toBe((incorrecta as AppError).httpStatus);
  });

  it('verifica un hash senuelo cuando el correo no existe, para no filtrar por tiempo', async () => {
    const s = montar();
    await s.autenticar.execute({ ...CREDENCIALES, correo: 'nadie@x.local' }).catch(() => undefined);

    expect(s.hasher.verificaciones).toHaveLength(1);
    expect(s.hasher.verificaciones[0]).toContain('$argon2id$');
  });

  it('cuenta el intento fallido tambien cuando el correo no existe', async () => {
    const s = montar();
    await s.autenticar.execute({ ...CREDENCIALES, correo: 'nadie@x.local' }).catch(() => undefined);

    expect(s.bloqueo.fallos).toBe(1);
  });

  it('rechaza antes de consultar nada cuando la cuenta esta bloqueada', async () => {
    const s = montar();
    await s.registrar.execute(ALTA);
    s.bloqueo.forzarBloqueo();

    await expect(s.autenticar.execute(CREDENCIALES)).rejects.toMatchObject({
      code: 'ACCOUNT_LOCKED',
      httpStatus: 429,
    });
    expect(s.hasher.verificaciones).toHaveLength(0);
  });

  it('una cuenta suspendida falla igual que una credencial incorrecta', async () => {
    const s = montar();
    const { id } = await s.registrar.execute(ALTA);
    const usuario = await s.usuarios.findById(id);
    usuario?.suspender();
    await s.usuarios.update(usuario!);

    await expect(s.autenticar.execute(CREDENCIALES)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('reinicia el contador de fallos tras un acceso correcto', async () => {
    const s = montar();
    await s.registrar.execute(ALTA);
    await s.autenticar
      .execute({ ...CREDENCIALES, contrasena: 'MalaContrasena2026' })
      .catch(() => undefined);
    expect(s.bloqueo.fallos).toBe(1);

    await s.autenticar.execute(CREDENCIALES);
    expect(s.bloqueo.fallos).toBe(0);
  });

  it('recalcula el hash cuando sus parametros quedaron obsoletos', async () => {
    const s = montar();
    await s.registrar.execute(ALTA);
    s.hasher.exigirRehash();

    await s.autenticar.execute(CREDENCIALES);

    const usuario = await s.usuarios.findById(1);
    expect(usuario?.contrasenaHash).toBe('hash:ContrasenaLarga2026');
  });
});

describe('roles simultaneos', () => {
  it('anadir OFERENTE conserva SOLICITANTE en la misma cuenta', () => {
    const usuario = Usuario.rehydrate({
      id: 1,
      nombre: 'Lucia',
      email: Email.create('lucia@puntoamigo.local'),
      contrasenaHash: 'hash:x',
      telefono: null,
      estado: 'ACTIVO',
      roles: UserRoles.initial(),
      ultimoAccesoAt: null,
      deletedAt: null,
    });

    usuario.concederRol('OFERENTE');

    expect(usuario.roles.toArray()).toEqual(['OFERENTE', 'SOLICITANTE']);
  });

  it('no se puede dejar una cuenta sin ningun rol', () => {
    const usuario = Usuario.rehydrate({
      id: 1,
      nombre: 'Lucia',
      email: Email.create('lucia@puntoamigo.local'),
      contrasenaHash: 'hash:x',
      telefono: null,
      estado: 'ACTIVO',
      roles: UserRoles.initial(),
      ultimoAccesoAt: null,
      deletedAt: null,
    });

    expect(() => usuario.retirarRol('SOLICITANTE')).toThrow(AppError);
  });
});

describe('proteccion de la contrasena en claro', () => {
  it('no aparece al serializar ni al interpolar el objeto de valor', async () => {
    const { PlainPassword } = await import('../src/domain/value-objects/PlainPassword');
    const p = PlainPassword.create('ContrasenaLarga2026');

    expect(`${p}`).toBe('[PlainPassword]');
    expect(JSON.stringify({ p })).not.toContain('ContrasenaLarga2026');
    expect(p.reveal()).toBe('ContrasenaLarga2026');
  });
});
