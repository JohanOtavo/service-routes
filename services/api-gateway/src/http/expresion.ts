import type { IdentidadVerificada } from '../security/TokenVerifier';

/**
 * Ampliacion de los tipos de Express que usa el gateway.
 *
 * Vive en su propio archivo, y no dentro de `http/app.ts`, porque una ampliacion
 * global solo existe para los archivos que forman parte del mismo programa. Con
 * `tsc --build` el servicio es un unico proyecto y da igual donde se declare,
 * pero `forward.ts` se compila tambien aislado en las pruebas unitarias, que lo
 * importan sin pasar por la aplicacion: ahi la ampliacion no llegaba y el
 *_property_ `req.correlationId` no existia.
 *
 * Un archivo que use estos campos lo referencia con `import type {} from
 * '../http/expresion'`. El import no emite nada a ejecucion; solo pone el
 * archivo en el programa para que la ampliacion aplique.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Identificador de correlacion; lo asigna el middleware del gateway. */
      correlationId: string;
      /** Presente solo cuando la peticion supero la verificacion del token. */
      identidad?: IdentidadVerificada;
    }
  }
}

export {};
