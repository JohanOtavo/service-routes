import type { Request, Response } from 'express';
import { AppError } from '@punto-amigo/shared';
import type { CircuitBreaker } from './CircuitBreaker';
import type { IdentidadVerificada } from '../security/TokenVerifier';

/**
 * Cabeceras internas con las que el gateway comunica la identidad ya verificada
 * al servicio de destino (SRS-GW-04).
 */
export const CABECERAS_INTERNAS = {
  userId: 'x-internal-user-id',
  roles: 'x-internal-roles',
  jti: 'x-internal-jti',
  secreto: 'x-internal-secret',
} as const;

/**
 * Cabeceras que el cliente NUNCA puede enviar.
 *
 * Es el control de seguridad mas importante del gateway. Los servicios confian
 * en `x-internal-user-id` porque asumen que solo el gateway la escribe: si una
 * peticion externa pudiera traerla, cualquiera se haria pasar por el
 * administrador con una sola cabecera. Se eliminan de la entrada SIEMPRE, antes
 * de mirar el token y con independencia de si la ruta es publica o protegida.
 */
const CABECERAS_PROHIBIDAS = new Set<string>(Object.values(CABECERAS_INTERNAS));

/** Cabeceras que no deben reenviarse: las gestiona la conexion, no la aplicacion. */
const CABECERAS_DE_SALTO = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

export function limpiarCabecerasDeCliente(req: Request): void {
  for (const nombre of CABECERAS_PROHIBIDAS) {
    delete req.headers[nombre];
  }
}

export interface ForwardDeps {
  breaker: CircuitBreaker;
  secretoInterno: string;
  timeoutMs: number;
}

export interface ForwardTarget {
  servicio: string;
  baseUrl: string;
}

/**
 * Reenvia la peticion al servicio de destino y copia su respuesta.
 *
 * El cuerpo viaja como Buffer sin interpretar: el gateway no necesita entender
 * el JSON, y volver a serializarlo solo anadiria una forma de alterarlo sin
 * querer.
 */
export async function reenviar(
  req: Request,
  res: Response,
  destino: ForwardTarget,
  identidad: IdentidadVerificada | null,
  deps: ForwardDeps
): Promise<void> {
  if (!deps.breaker.permite(destino.servicio)) {
    throw AppError.upstreamUnavailable(destino.servicio);
  }

  const url = `${destino.baseUrl}${req.originalUrl}`;
  const cabeceras = new Headers();

  for (const [nombre, valor] of Object.entries(req.headers)) {
    if (valor === undefined) continue;
    if (CABECERAS_DE_SALTO.has(nombre)) continue;
    cabeceras.set(nombre, Array.isArray(valor) ? valor.join(', ') : valor);
  }

  cabeceras.set('x-correlation-id', req.correlationId);
  // Autentica al gateway ante el servicio: una llamada que no la traiga no
  // viene del gateway y debe rechazarse (SRS RNF24).
  cabeceras.set(CABECERAS_INTERNAS.secreto, deps.secretoInterno);

  if (identidad !== null) {
    cabeceras.set(CABECERAS_INTERNAS.userId, identidad.userId);
    cabeceras.set(CABECERAS_INTERNAS.roles, identidad.roles.join(','));
    cabeceras.set(CABECERAS_INTERNAS.jti, identidad.jti);
  }

  // Tiempo maximo de espera (SRS-NFR-P07): sin el, un servicio que no responde
  // retiene la conexion del cliente indefinidamente.
  const abort = new AbortController();
  const temporizador = setTimeout(() => abort.abort(), deps.timeoutMs);

  try {
    const cuerpo =
      req.method === 'GET' || req.method === 'HEAD'
        ? undefined
        : (req.body as Buffer | undefined);

    const respuesta = await fetch(url, {
      method: req.method,
      headers: cabeceras,
      ...(cuerpo === undefined || cuerpo.length === 0 ? {} : { body: cuerpo }),
      signal: abort.signal,
      redirect: 'manual',
    });

    /**
     * Un 5xx del destino cuenta como fallo para el cortacircuitos; un 4xx no.
     *
     * Un 422 significa que el servicio funciona y rechaza la peticion: contarlo
     * abriria el circuito por culpa de clientes que envian datos invalidos.
     */
    if (respuesta.status >= 500) {
      deps.breaker.registrarFallo(destino.servicio);
    } else {
      deps.breaker.registrarExito(destino.servicio);
    }

    res.status(respuesta.status);

    respuesta.headers.forEach((valor, nombre) => {
      if (CABECERAS_DE_SALTO.has(nombre)) return;
      // set-cookie puede venir repetida y Headers la concatena; se usa append
      // para no perder ninguna.
      if (nombre === 'set-cookie') res.append('set-cookie', valor);
      else res.setHeader(nombre, valor);
    });

    const datos = Buffer.from(await respuesta.arrayBuffer());
    res.send(datos);
  } catch (error) {
    deps.breaker.registrarFallo(destino.servicio);

    // El mensaje al cliente no distingue "no responde" de "no existe": revelar
    // la topologia interna solo ayuda a quien la esta explorando.
    throw AppError.upstreamUnavailable(destino.servicio);
  } finally {
    clearTimeout(temporizador);
  }
}
