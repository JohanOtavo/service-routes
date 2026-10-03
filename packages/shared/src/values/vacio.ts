/**
 * El payload de un evento es `Record<string, unknown>` porque viaja serializado
 * por el broker. Un campo de ese payload puede faltar —y entonces llega
 * `undefined`— o venir explicitamente a null, segun lo que el emisor tenia y lo
 * que la version del contrato admita. Son los dos casos "no hay valor", pero
 * `==` es el unico operador que los cubre a la vez y `eqeqeq` lo prohibe.
 *
 * Este predicado cubre los dos sin desactivar la regla, que existe por una
 * razon concreta: `==` tambien hace que `0 == '0'` y `'' == 0`, y en codigo que
 * convierte parametros de consulta y de formulario, esa equivalencia silente
 * convierte un cero en un numero.
 */
export function esVacio(valor: unknown): valor is null | undefined {
  return valor === null || valor === undefined;
}

/**
 * Convierte un valor del payload a entero, o null si no hay valor.
 *
 * Es el `x == null ? null : Number(x)` que se repetia en cada manejador de
 * evento. El patron no cambia: lo que hay que recordar es que solo trata como
 * ausencia null y undefined. Un texto vacio NO es ausencia y Number('') es 0,
 * igual que antes de existir esta funcion. Si eso llegara a ser un problema, se
 * corrige en la validacion del sobre, que es donde se sabe que la version del
 * contrato admite el campo.
 */
export function enteroONulo(valor: unknown): number | null {
  return esVacio(valor) ? null : Number(valor);
}

/**
 * Si el evento viene de una re-emision y no de un hecho que acaba de pasar.
 *
 * La re-emision (`node db/cli.js reemit`) reconstruye las replicas `*_ref`
 * volviendo a encolar los eventos de alta del estado actual, con `event_id`
 * nuevos —si reutilizara los viejos, `processed_event` los descartaria por
 * idempotencia y no se reconstruiria nada—.
 *
 * Esos identificadores nuevos tambien esquivan la proteccion contra los efectos
 * que NO son poblar una replica. El manejador de `UserRegistered` de
 * notification-service refresca `usuario_ref` y, ademas, crea un aviso de
 * BIENVENIDA: sin esta marca, reconstruir las replicas mandaria un saludo
 * duplicado a cada usuario que ya existe.
 *
 * Quien tenga un efecto de ese tipo comprueba esto y se salta esa parte, no el
 * evento entero: la replica si se tiene que refrescar.
 */
export function esReemision(payload: Record<string, unknown>): boolean {
  return payload['reemision'] === true;
}
