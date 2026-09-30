import { AppError } from '@punto-amigo/shared';

/**
 * Contrasena en claro, antes de ser hasheada.
 *
 * Su unico proposito es aplicar la politica y desaparecer: nunca se persiste,
 * nunca se registra y nunca sale de la capa de aplicacion.
 *
 * SRS: RF3, RF5, RNF21.
 */
export class PlainPassword {
  private constructor(private readonly value: string) {}

  static readonly LONGITUD_MINIMA = 12;
  /**
   * Argon2 no tiene el limite de 72 bytes de bcrypt, pero un tope evita que
   * alguien envie megabytes y convierta el hasheo en una denegacion de servicio.
   */
  static readonly LONGITUD_MAXIMA = 128;

  /**
   * Politica: longitud primero, composicion despues.
   *
   * Se exige longitud antes que variedad de caracteres porque una frase larga
   * resiste mas que ocho caracteres con un simbolo obligatorio, que es lo que
   * produce contrasenas como "Passw0rd!" repetidas en todas partes.
   */
  static create(raw: string): PlainPassword {
    const errores: { field: string; message: string }[] = [];

    if (raw.length < PlainPassword.LONGITUD_MINIMA) {
      errores.push({
        field: 'contrasena',
        message: `Debe tener al menos ${PlainPassword.LONGITUD_MINIMA} caracteres.`,
      });
    }

    if (raw.length > PlainPassword.LONGITUD_MAXIMA) {
      errores.push({
        field: 'contrasena',
        message: `No puede superar los ${PlainPassword.LONGITUD_MAXIMA} caracteres.`,
      });
    }

    if (/^\s|\s$/u.test(raw)) {
      errores.push({
        field: 'contrasena',
        message: 'No puede empezar ni terminar con un espacio.',
      });
    }

    // Una contrasena de un solo caracter repetido pasa cualquier medida de
    // longitud y no resiste nada.
    if (raw.length > 0 && new Set(raw).size < 5) {
      errores.push({
        field: 'contrasena',
        message: 'Use al menos cinco caracteres distintos.',
      });
    }

    if (errores.length > 0) {
      throw AppError.validation('La contrasena no cumple la politica.', errores);
    }

    return new PlainPassword(raw);
  }

  /** Confirmacion obligatoria en el registro (SRS RF3). */
  static createWithConfirmation(raw: string, confirmation: string): PlainPassword {
    if (raw !== confirmation) {
      throw AppError.validation('Las contrasenas no coinciden.', [
        { field: 'confirmacionContrasena', message: 'Debe coincidir con la contrasena.' },
      ]);
    }
    return PlainPassword.create(raw);
  }

  /** Lectura explicita: hace visible en el codigo donde se maneja el valor. */
  reveal(): string {
    return this.value;
  }

  /**
   * Protege contra el registro accidental.
   *
   * Un `console.log(objeto)`, un `JSON.stringify` o una plantilla de texto que
   * incluyan esta instancia imprimen la mascara y no la contrasena.
   */
  toString(): string {
    return '[PlainPassword]';
  }

  toJSON(): string {
    return '[PlainPassword]';
  }
}
