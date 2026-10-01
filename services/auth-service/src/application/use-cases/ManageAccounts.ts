import { AppError, EventName } from '@punto-amigo/shared';
import { parseUserRole, type UserRole } from '../../domain/value-objects/UserRole';
import type {
  IClock,
  IEventPublisher,
  ISessionRepository,
  IUsuarioRepository,
} from '../../domain/ports/out';

export interface AccionSobreCuenta {
  idUsuario: number;
  ejecutadaPor: number;
  correlationId: string;
}

/**
 * Gestion administrativa de cuentas y roles.
 *
 * SRS: RF15 a RF19, RF97 a RF100, RF161.
 *
 * Quien puede invocar esto lo decide el guardia de rol de la capa HTTP; aqui se
 * comprueba lo que el rol no puede cubrir: que la operacion tenga sentido sobre
 * el estado actual de la cuenta.
 */
export class ManageAccountsUseCase {
  constructor(
    private readonly usuarios: IUsuarioRepository,
    private readonly sesiones: ISessionRepository,
    private readonly eventos: IEventPublisher,
    private readonly clock: IClock
  ) {}

  /** Anade un rol sin retirar los que ya tenia (SRS RF161). */
  async asignarRol(input: AccionSobreCuenta & { rol: string }): Promise<string[]> {
    const rol: UserRole = parseUserRole(input.rol);
    const usuario = await this.exigirUsuario(input.idUsuario);

    const previos = usuario.roles.toArray();
    usuario.concederRol(rol);
    await this.usuarios.update(usuario);

    await this.eventos.enqueue(
      {
        eventName: EventName.UserRoleAssigned,
        aggregateType: 'Usuario',
        aggregateId: usuario.id,
        payload: {
          userId: usuario.id,
          previousRoles: previos,
          newRoles: usuario.roles.toArray(),
          assignedBy: input.ejecutadaPor,
          occurredAt: this.clock.now().toISOString(),
        },
      },
      input.correlationId
    );

    return usuario.roles.toArray();
  }

  async retirarRol(input: AccionSobreCuenta & { rol: string }): Promise<string[]> {
    const rol: UserRole = parseUserRole(input.rol);
    const usuario = await this.exigirUsuario(input.idUsuario);

    const previos = usuario.roles.toArray();
    // El dominio impide dejar la cuenta sin ningun rol.
    usuario.retirarRol(rol);
    await this.usuarios.update(usuario);

    await this.eventos.enqueue(
      {
        eventName: EventName.UserRoleAssigned,
        aggregateType: 'Usuario',
        aggregateId: usuario.id,
        payload: {
          userId: usuario.id,
          previousRoles: previos,
          newRoles: usuario.roles.toArray(),
          assignedBy: input.ejecutadaPor,
          occurredAt: this.clock.now().toISOString(),
        },
      },
      input.correlationId
    );

    return usuario.roles.toArray();
  }

  /**
   * Suspende una cuenta y cierra sus sesiones.
   *
   * Sin lo segundo la suspension seria decorativa durante siete dias: el usuario
   * conservaria un refresh token valido y podria seguir renovando.
   */
  async suspender(input: AccionSobreCuenta & { motivo: string }): Promise<void> {
    const usuario = await this.exigirUsuario(input.idUsuario);

    if (usuario.id === input.ejecutadaPor) {
      throw AppError.conflict('Un administrador no puede suspender su propia cuenta.');
    }

    usuario.suspender();
    await this.usuarios.update(usuario);
    await this.sesiones.revocarTodasDe(usuario.id, 'CUENTA_SUSPENDIDA');

    await this.eventos.enqueue(
      {
        eventName: EventName.UserAccountSuspended,
        aggregateType: 'Usuario',
        aggregateId: usuario.id,
        payload: {
          userId: usuario.id,
          reason: input.motivo,
          suspendedBy: input.ejecutadaPor,
          occurredAt: this.clock.now().toISOString(),
        },
      },
      input.correlationId
    );
  }

  async reactivar(input: AccionSobreCuenta): Promise<void> {
    const usuario = await this.exigirUsuario(input.idUsuario);
    usuario.reactivar();
    await this.usuarios.update(usuario);

    await this.eventos.enqueue(
      {
        eventName: EventName.UserProfileUpdated,
        aggregateType: 'Usuario',
        aggregateId: usuario.id,
        payload: {
          userId: usuario.id,
          accion: 'CUENTA_REACTIVADA',
          ejecutadaPor: input.ejecutadaPor,
          occurredAt: this.clock.now().toISOString(),
        },
      },
      input.correlationId
    );
  }

  /** Borrado logico: la cuenta desaparece y su historial permanece (SRS RF100). */
  async eliminar(input: AccionSobreCuenta): Promise<void> {
    const usuario = await this.exigirUsuario(input.idUsuario);

    if (usuario.id === input.ejecutadaPor) {
      throw AppError.conflict('Un administrador no puede eliminar su propia cuenta.');
    }

    usuario.eliminar(this.clock.now());
    await this.usuarios.update(usuario);
    await this.sesiones.revocarTodasDe(usuario.id, 'CUENTA_ELIMINADA');

    await this.eventos.enqueue(
      {
        eventName: EventName.UserAccountSuspended,
        aggregateType: 'Usuario',
        aggregateId: usuario.id,
        payload: {
          userId: usuario.id,
          reason: 'ELIMINACION_LOGICA',
          suspendedBy: input.ejecutadaPor,
          occurredAt: this.clock.now().toISOString(),
        },
      },
      input.correlationId
    );
  }

  private async exigirUsuario(id: number) {
    const usuario = await this.usuarios.findById(id);
    if (usuario === null) throw AppError.notFound('La cuenta no existe.');
    return usuario;
  }
}
