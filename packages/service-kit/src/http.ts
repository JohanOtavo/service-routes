import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppError, ErrorCode, toErrorResponse } from '@punto-amigo/shared';
import type { ZodTypeAny } from 'zod';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      correlationId: string;
      /** Presente solo tras pasar por `requireAuth`. */
      auth?: { userId: number; roles: string[]; jti: string };
    }
  }
}

/**
 * Identificador de correlacion.
 *
 * Se toma del que llega del gateway o se genera si no viene, y acompana a la
 * peticion, a la respuesta de error y a cada registro. Es lo que permite
 * reconstruir una operacion que atraveso varios servicios (SRS RNF78).
 */
export function correlationId(req: Request, res: Response, next: NextFunction): void {
  const entrante = req.header('x-correlation-id');
  // Se acepta solo si tiene forma de UUID: un valor arbitrario del cliente
  // acabaria en los registros de todos los servicios sin control de tamano.
  const valido =
    entrante !== undefined &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(entrante);

  req.correlationId = valido ? entrante : randomUUID();
  res.setHeader('x-correlation-id', req.correlationId);
  next();
}

/**
 * Valida el cuerpo contra un esquema y lo sustituye por el resultado tipado.
 *
 * Todo lo que no declare el esquema se descarta. Asi una peticion que incluya
 * `"estado": "ACTIVO"` o `"roles": ["ADMINISTRADOR"]` no puede asignar campos
 * que el cliente no deberia controlar.
 */
export function validateBody(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const resultado = schema.safeParse(req.body);

    if (!resultado.success) {
      next(
        AppError.validation(
          'Los datos enviados no son validos.',
          resultado.error.issues.map((issue) => ({
            field: issue.path.join('.') || 'cuerpo',
            message: issue.message,
          }))
        )
      );
      return;
    }

    req.body = resultado.data;
    next();
  };
}


/**
 * Valida la cadena de consulta y la sustituye por el resultado tipado.
 *
 * Hace falta aparte de `validateBody` porque un GET no tiene cuerpo y sus
 * filtros llegan igual desde el cliente. Sin esto, `?tamano=99999` o
 * `?pagina=-1` entran como texto hasta el repositorio.
 *
 * Express entrega siempre cadenas, asi que el esquema debe convertir
 * (`z.coerce.number()`); un `z.number()` a secas rechazaria `?pagina=2`.
 */
export function validateQuery(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const resultado = schema.safeParse(req.query);

    if (!resultado.success) {
      next(
        AppError.validation(
          'Los parametros de la consulta no son validos.',
          resultado.error.issues.map((issue) => ({
            field: issue.path.join('.') || 'consulta',
            message: issue.message,
          }))
        )
      );
      return;
    }

    req.query = resultado.data as Request['query'];
    next();
  };
}

/**
 * Identificador numerico de la ruta, o 404.
 *
 * Un `/api/v1/providers/abc` daria NaN, y una consulta por NaN devuelve vacio,
 * que el caso de uso traduciria a 404 de todas formas. Comprobarlo aqui evita
 * el viaje a la base y deja el motivo escrito en un solo sitio.
 */
export function idDeRuta(req: Request, nombre = 'id'): number {
  const bruto = req.params[nombre];
  if (bruto === undefined || !/^[1-9][0-9]{0,18}$/u.test(bruto)) {
    throw AppError.notFound();
  }
  return Number(bruto);
}

/**
 * Exige que la peticion venga del gateway (SRS RNF24, RNF25).
 *
 * Los microservicios no son alcanzables desde la red publica, pero eso lo
 * garantiza la topologia de red, y una topologia cambia con un despliegue mal
 * configurado. Esta comprobacion es la segunda barrera: si alguien alcanza el
 * servicio por otra via, sin el secreto compartido no consigue nada.
 *
 * La comparacion es en tiempo constante: `===` sobre cadenas sale antes cuando
 * los primeros caracteres difieren, y esa diferencia permite deducir el secreto
 * caracter a caracter.
 *
 * `/health` queda fuera: lo consulta el orquestador, que no conoce el secreto.
 */
export function requireInternalCaller(secreto: string) {
  const esperado = Buffer.from(secreto);

  return (req: Request, _res: Response, next: NextFunction): void => {
    if (req.path === '/health') {
      next();
      return;
    }

    const recibido = req.header('x-internal-secret');
    if (recibido === undefined) {
      next(AppError.forbidden('Esta ruta solo es accesible a traves del gateway.'));
      return;
    }

    const candidato = Buffer.from(recibido);
    if (
      candidato.length !== esperado.length ||
      !timingSafeEqual(candidato, esperado)
    ) {
      next(AppError.forbidden('Esta ruta solo es accesible a traves del gateway.'));
      return;
    }

    next();
  };
}

/**
 * Identidad que el gateway inyecta tras verificar el token.
 *
 * Los nombres coinciden con `CABECERAS_INTERNAS` del gateway. No se importan de
 * alli porque eso haria que cada servicio dependiera del gateway; el acoplamiento
 * es el contrato de cabeceras, y vive escrito en los dos lados.
 */
const CABECERA_USUARIO = 'x-internal-user-id';
const CABECERA_ROLES = 'x-internal-roles';
const CABECERA_JTI = 'x-internal-jti';

/**
 * Toma la identidad de las cabeceras internas (SRS RNF24, RNF25).
 *
 * Los servicios de dentro NO vuelven a verificar el JWT. El gateway ya lo hizo:
 * comprobo la firma con la clave publica, el algoritmo fijado y la lista de
 * denegacion. Repetirlo aqui obligaria a cada servicio a tener la clave publica
 * y una conexion a Redis, y a que una caida de Redis tumbara los ocho servicios
 * en vez de uno.
 *
 * Lo que sostiene esta confianza es que el gateway BORRA estas cabeceras de toda
 * peticion entrante antes de mirar nada, y que `requireInternalCaller` exige el
 * secreto compartido. Sin esas dos cosas, cualquiera se haria administrador con
 * una cabecera; con ellas, hace falta alcanzar el servicio por dentro de la red
 * y conocer el secreto.
 *
 * Deniega por defecto: si la cabecera falta o no es un numero, no hay identidad
 * y la peticion no pasa.
 */
export function requireGatewayIdentity() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const bruto = req.header(CABECERA_USUARIO);

    if (bruto === undefined || !/^[1-9][0-9]{0,18}$/u.test(bruto)) {
      next(AppError.unauthenticated('Falta la identidad de la peticion.'));
      return;
    }

    const roles = (req.header(CABECERA_ROLES) ?? '')
      .split(',')
      .map((rol) => rol.trim())
      .filter((rol) => rol.length > 0);

    req.auth = { userId: Number(bruto), roles, jti: req.header(CABECERA_JTI) ?? '' };
    next();
  };
}

export interface TokenVerifier {
  verifyAccess(token: string): Promise<{ sub: string; roles: string[]; jti: string }>;
}

export interface DenylistChecker {
  estaDenegado(jti: string): Promise<boolean>;
}

/**
 * Exige un access token valido y no revocado.
 *
 * La lista de denegacion se consulta ademas de verificar la firma: un JWT es
 * autocontenido y seguiria siendo valido hasta expirar aunque el usuario hubiera
 * cerrado sesion (SRS RF10).
 */
export function requireAuth(tokens: TokenVerifier, denylist: DenylistChecker) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const cabecera = req.header('authorization');
      if (cabecera === undefined || !cabecera.startsWith('Bearer ')) {
        throw AppError.unauthenticated('Falta el token de acceso.');
      }

      const claims = await tokens.verifyAccess(cabecera.slice('Bearer '.length).trim());

      if (await denylist.estaDenegado(claims.jti)) {
        throw AppError.unauthenticated('La sesion fue cerrada.');
      }

      req.auth = { userId: Number(claims.sub), roles: claims.roles, jti: claims.jti };
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Exige al menos uno de los roles indicados.
 *
 * Se aplica en el servidor aunque la interfaz ya oculte la opcion: la interfaz
 * es una comodidad, no un control de acceso (SRS RNF23). La denegacion es por
 * defecto: sin `requireAuth` previo, no hay roles y siempre deniega.
 */
export function requireRole(...permitidos: readonly string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const roles = req.auth?.roles ?? [];
    if (!permitidos.some((rol) => roles.includes(rol))) {
      next(AppError.forbidden());
      return;
    }
    next();
  };
}

export interface Logger {
  error(mensaje: string, contexto: Record<string, unknown>): void;
}

/**
 * Manejador de errores central.
 *
 * Traduce cualquier fallo a la misma forma de respuesta. Un error no previsto se
 * convierte en 500 con un mensaje generico: la traza y el contexto van al
 * registro, nunca al cliente (SRS RNF48 y security-rules.md).
 */
export function errorHandler(logger: Logger, exponerDetalle: boolean) {
  return (error: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const appError =
      error instanceof AppError ? error : AppError.internal(error, { path: req.path });

    if (appError.code === ErrorCode.INTERNAL) {
      logger.error('error no controlado', {
        correlationId: req.correlationId,
        path: req.path,
        method: req.method,
        // El stack va al registro y no a la respuesta.
        stack: error instanceof Error ? error.stack : String(error),
        ...appError.context,
      });
    }

    const cuerpo = toErrorResponse(appError, req.correlationId);

    // En desarrollo ayuda ver el mensaje real; en produccion seria una fuga.
    if (exponerDetalle && appError.code === ErrorCode.INTERNAL && error instanceof Error) {
      (cuerpo as unknown as Record<string, unknown>)['debug'] = error.message;
    }

    res.status(appError.httpStatus).json(cuerpo);
  };
}

/** Ruta inexistente: 404 con la misma forma que el resto de errores. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json(toErrorResponse(AppError.notFound(), req.correlationId));
}
