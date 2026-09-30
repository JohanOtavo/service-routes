import { AppError } from '@punto-amigo/shared';

/**
 * Correo electronico validado y normalizado.
 *
 * Es un objeto de valor y no un `string` porque la unicidad del correo es una
 * regla de negocio (USER-INV-002) y depende de como se normalice: si un usuario
 * se registra con `Ana@Correo.com` y otro con `ana@correo.com`, la base de datos
 * los considera distintos y la regla se incumple sin que nadie lo note.
 *
 * SRS: RF1, RF4, USER-INV-002, USER-INV-003.
 */
export class Email {
  private constructor(readonly value: string) {}

  /**
   * Comprobacion deliberadamente permisiva.
   *
   * Validar direcciones con una expresion regular estricta rechaza correos
   * legitimos —dominios nuevos, etiquetas con `+`, caracteres no ascii— sin
   * llegar a garantizar que la direccion exista. Quien decide eso es el envio
   * de verificacion, no el patron.
   */
  private static readonly FORMATO = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/u;

  static readonly LONGITUD_MAXIMA = 150;

  static create(raw: string): Email {
    const normalizado = raw.trim().toLowerCase();

    if (normalizado.length === 0) {
      throw AppError.validation('El correo es obligatorio.', [
        { field: 'correo', message: 'Debe indicar un correo electronico.' },
      ]);
    }

    if (normalizado.length > Email.LONGITUD_MAXIMA) {
      throw AppError.validation('El correo es demasiado largo.', [
        { field: 'correo', message: `Maximo ${Email.LONGITUD_MAXIMA} caracteres.` },
      ]);
    }

    if (!Email.FORMATO.test(normalizado)) {
      throw AppError.validation('El correo no tiene un formato valido.', [
        { field: 'correo', message: 'Escriba una direccion como nombre@dominio.com.' },
      ]);
    }

    return new Email(normalizado);
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
