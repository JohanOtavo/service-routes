/**
 * Errores de aplicacion.
 *
 * Existen para separar dos cosas que se confunden con facilidad: lo que el
 * sistema necesita saber para diagnosticar un fallo, y lo que puede contarle al
 * cliente sin filtrar informacion interna (SRS RNF48, y la regla de
 * 00-governance/security-rules.md sobre no exponer datos internos).
 *
 * `message` viaja al cliente. `cause` y `context` se quedan en el registro.
 */

/** Codigos estables. El cliente puede ramificar sobre ellos; el texto puede cambiar. */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  RATE_LIMITED: 'RATE_LIMITED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Error de un campo concreto, para que la interfaz lo muestre donde toca. */
export interface FieldError {
  field: string;
  message: string;
}

export interface AppErrorOptions {
  /** Contexto para el registro. Nunca se envia al cliente. */
  context?: Record<string, unknown>;
  cause?: unknown;
  details?: FieldError[];
}

export class AppError extends Error {
  readonly code: ErrorCodeValue;
  readonly httpStatus: number;
  readonly details?: FieldError[];
  readonly context?: Record<string, unknown>;

  constructor(
    code: ErrorCodeValue,
    httpStatus: number,
    message: string,
    options: AppErrorOptions = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    if (options.details !== undefined) this.details = options.details;
    if (options.context !== undefined) this.context = options.context;
    Error.captureStackTrace?.(this, AppError);
  }

  static validation(message: string, details?: FieldError[]): AppError {
    return new AppError(
      ErrorCode.VALIDATION_FAILED,
      422,
      message,
      details === undefined ? {} : { details }
    );
  }

  /**
   * Mensaje deliberadamente generico: distinguir "ese correo no existe" de
   * "la contrasena no coincide" convierte el formulario de acceso en un
   * verificador de cuentas registradas (SRS RF9).
   */
  static unauthenticated(message = 'Credenciales invalidas.'): AppError {
    return new AppError(ErrorCode.UNAUTHENTICATED, 401, message);
  }

  static forbidden(message = 'No tiene permiso para realizar esta operacion.'): AppError {
    return new AppError(ErrorCode.FORBIDDEN, 403, message);
  }

  /**
   * 404 tambien cuando el recurso existe pero es de otro usuario.
   *
   * Responder 403 confirmaria que el identificador corresponde a algo real, y
   * eso permite enumerar recursos ajenos aunque no se puedan leer.
   */
  static notFound(message = 'El recurso solicitado no existe.'): AppError {
    return new AppError(ErrorCode.NOT_FOUND, 404, message);
  }

  static conflict(message: string, context?: Record<string, unknown>): AppError {
    return new AppError(
      ErrorCode.CONFLICT,
      409,
      message,
      context === undefined ? {} : { context }
    );
  }

  /** Incluye las transiciones validas para que el cliente pueda orientar al usuario. */
  static invalidTransition(
    message: string,
    allowed: readonly string[],
    context?: Record<string, unknown>
  ): AppError {
    return new AppError(ErrorCode.INVALID_STATE_TRANSITION, 409, message, {
      details: allowed.map((estado) => ({ field: 'estado', message: estado })),
      ...(context === undefined ? {} : { context }),
    });
  }

  static rateLimited(message = 'Demasiadas peticiones. Intentelo mas tarde.'): AppError {
    return new AppError(ErrorCode.RATE_LIMITED, 429, message);
  }

  static accountLocked(retryAfterSeconds: number): AppError {
    return new AppError(
      ErrorCode.ACCOUNT_LOCKED,
      429,
      'Demasiados intentos fallidos. La cuenta esta bloqueada temporalmente.',
      { context: { retryAfterSeconds } }
    );
  }

  static upstreamUnavailable(service: string): AppError {
    return new AppError(
      ErrorCode.UPSTREAM_UNAVAILABLE,
      503,
      'Una parte del sistema no esta disponible. Intentelo de nuevo en unos minutos.',
      { context: { service } }
    );
  }

  static internal(cause: unknown, context?: Record<string, unknown>): AppError {
    return new AppError(
      ErrorCode.INTERNAL,
      500,
      'Ocurrio un error inesperado.',
      { cause, ...(context === undefined ? {} : { context }) }
    );
  }
}

/** Cuerpo de error que se envia al cliente. No lleva stack ni contexto interno. */
export interface ErrorResponseBody {
  code: ErrorCodeValue;
  message: string;
  correlationId: string;
  details?: FieldError[];
}

export function toErrorResponse(error: AppError, correlationId: string): ErrorResponseBody {
  return {
    code: error.code,
    message: error.message,
    correlationId,
    ...(error.details === undefined ? {} : { details: error.details }),
  };
}
