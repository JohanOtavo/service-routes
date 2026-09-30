import { AppError } from '@punto-amigo/shared';
import { Email } from '../value-objects/Email';
import { UserRoles, type UserRole } from '../value-objects/UserRole';

/**
 * Estados de una cuenta.
 *
 * INACTIVO es el borrado logico: la cuenta desaparece de la plataforma pero su
 * historial de contrataciones sobrevive, porque la contraparte tiene derecho a
 * conservar la traza de un servicio que si ocurrio.
 */
export const ESTADOS_CUENTA = ['ACTIVO', 'SUSPENDIDO', 'INACTIVO'] as const;
export type EstadoCuenta = (typeof ESTADOS_CUENTA)[number];

export interface UsuarioProps {
  id: number;
  nombre: string;
  email: Email;
  contrasenaHash: string;
  telefono: string | null;
  estado: EstadoCuenta;
  roles: UserRoles;
  ultimoAccesoAt: Date | null;
  deletedAt: Date | null;
}

/**
 * Raiz del agregado de identidad.
 *
 * No conoce la base de datos, ni Express, ni Argon2: recibe el hash ya
 * calculado. Quien decide si una contrasena coincide es un adaptador, porque el
 * algoritmo es una decision de infraestructura que va a cambiar antes que estas
 * reglas.
 *
 * SRS: USER-INV-001 a USER-INV-008.
 */
export class Usuario {
  private constructor(private props: UsuarioProps) {}

  static rehydrate(props: UsuarioProps): Usuario {
    return new Usuario(props);
  }

  /**
   * Alta de una cuenta nueva.
   *
   * Nace ACTIVA y con el rol SOLICITANTE (SRS RF160). El identificador lo asigna
   * la base de datos, asi que aqui es 0 hasta que el repositorio lo sustituye.
   */
  static register(input: {
    nombre: string;
    email: Email;
    contrasenaHash: string;
    telefono: string | null;
  }): Usuario {
    const nombre = input.nombre.trim();

    if (nombre.length < 2) {
      throw AppError.validation('El nombre es obligatorio.', [
        { field: 'nombre', message: 'Debe tener al menos 2 caracteres.' },
      ]);
    }
    if (nombre.length > 100) {
      throw AppError.validation('El nombre es demasiado largo.', [
        { field: 'nombre', message: 'Maximo 100 caracteres.' },
      ]);
    }

    return new Usuario({
      id: 0,
      nombre,
      email: input.email,
      contrasenaHash: input.contrasenaHash,
      telefono: input.telefono,
      estado: 'ACTIVO',
      roles: UserRoles.initial(),
      ultimoAccesoAt: null,
      deletedAt: null,
    });
  }

  get id(): number {
    return this.props.id;
  }
  get nombre(): string {
    return this.props.nombre;
  }
  get email(): Email {
    return this.props.email;
  }
  get contrasenaHash(): string {
    return this.props.contrasenaHash;
  }
  get telefono(): string | null {
    return this.props.telefono;
  }
  get estado(): EstadoCuenta {
    return this.props.estado;
  }
  get roles(): UserRoles {
    return this.props.roles;
  }
  get ultimoAccesoAt(): Date | null {
    return this.props.ultimoAccesoAt;
  }

  /**
   * Una cuenta borrada o suspendida no puede autenticarse.
   *
   * Se comprueba DESPUES de verificar la contrasena, no antes: responder
   * "cuenta suspendida" a quien no ha demostrado ser su dueno confirma que ese
   * correo existe en la plataforma.
   */
  get puedeAutenticarse(): boolean {
    return this.props.estado === 'ACTIVO' && this.props.deletedAt === null;
  }

  tieneRol(role: UserRole): boolean {
    return this.props.roles.has(role);
  }

  /** Anade un rol conservando los que ya tenia (SRS RF161). */
  concederRol(role: UserRole): void {
    if (this.props.estado !== 'ACTIVO') {
      throw AppError.conflict('No se pueden asignar roles a una cuenta que no esta activa.');
    }
    this.props.roles = this.props.roles.with(role);
  }

  retirarRol(role: UserRole): void {
    this.props.roles = this.props.roles.without(role);
  }

  registrarAcceso(momento: Date): void {
    this.props.ultimoAccesoAt = momento;
  }

  suspender(): void {
    if (this.props.deletedAt !== null) {
      throw AppError.conflict('La cuenta ya fue eliminada.');
    }
    this.props.estado = 'SUSPENDIDO';
  }

  reactivar(): void {
    if (this.props.deletedAt !== null) {
      throw AppError.conflict('No se puede reactivar una cuenta eliminada.');
    }
    this.props.estado = 'ACTIVO';
  }

  /** Borrado logico: conserva el historial (SRS RF100). */
  eliminar(momento: Date): void {
    this.props.estado = 'INACTIVO';
    this.props.deletedAt = momento;
  }

  cambiarContrasena(nuevoHash: string): void {
    this.props.contrasenaHash = nuevoHash;
  }

  /** Vista publica. No incluye el hash ni el estado de borrado. */
  toPublicJSON(): Record<string, unknown> {
    return {
      id: this.props.id,
      nombre: this.props.nombre,
      correo: this.props.email.value,
      telefono: this.props.telefono,
      estado: this.props.estado,
      roles: this.props.roles.toArray(),
    };
  }
}
