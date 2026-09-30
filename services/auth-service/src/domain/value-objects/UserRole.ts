import { AppError } from '@punto-amigo/shared';

/**
 * Roles del sistema.
 *
 * Un usuario tiene un CONJUNTO de roles, no uno solo: la misma persona puede
 * prestar un servicio y necesitar otro, y obligarla a dos cuentas partiria su
 * reputacion (SRS RF159, USER-INV-008).
 */
export const ROLES = ['ADMINISTRADOR', 'OFERENTE', 'SOLICITANTE'] as const;

export type UserRole = (typeof ROLES)[number];

/** Rol que recibe toda cuenta al registrarse (SRS RF160). */
export const ROL_POR_DEFECTO: UserRole = 'SOLICITANTE';

export function isUserRole(value: string): value is UserRole {
  return (ROLES as readonly string[]).includes(value);
}

export function parseUserRole(value: string): UserRole {
  if (!isUserRole(value)) {
    throw AppError.validation('Rol desconocido.', [
      { field: 'rol', message: `Debe ser uno de: ${ROLES.join(', ')}.` },
    ]);
  }
  return value;
}

/**
 * Conjunto de roles con las reglas del dominio aplicadas.
 *
 * Existe para que "tiene rol" sea una pregunta al dominio y no una busqueda en
 * un array repetida en cada sitio, que es donde acaban apareciendo las
 * comprobaciones olvidadas.
 */
export class UserRoles {
  private readonly roles: ReadonlySet<UserRole>;

  private constructor(roles: Set<UserRole>) {
    this.roles = roles;
  }

  static create(values: readonly string[]): UserRoles {
    if (values.length === 0) {
      throw AppError.validation('Una cuenta debe tener al menos un rol.');
    }
    return new UserRoles(new Set(values.map(parseUserRole)));
  }

  static initial(): UserRoles {
    return new UserRoles(new Set([ROL_POR_DEFECTO]));
  }

  has(role: UserRole): boolean {
    return this.roles.has(role);
  }

  hasAny(...candidates: readonly UserRole[]): boolean {
    return candidates.some((role) => this.roles.has(role));
  }

  /** Anadir un rol no sustituye a los demas (SRS RF161). */
  with(role: UserRole): UserRoles {
    return new UserRoles(new Set([...this.roles, role]));
  }

  without(role: UserRole): UserRoles {
    const restantes = new Set(this.roles);
    restantes.delete(role);
    if (restantes.size === 0) {
      throw AppError.conflict('No se puede retirar el ultimo rol de una cuenta.');
    }
    return new UserRoles(restantes);
  }

  toArray(): UserRole[] {
    // Orden estable: el contenido del token no debe cambiar por el orden de
    // insercion, o dos tokens equivalentes pareceran distintos.
    return [...this.roles].sort();
  }
}
