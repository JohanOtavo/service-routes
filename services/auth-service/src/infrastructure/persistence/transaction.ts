import { AsyncLocalStorage } from 'node:async_hooks';
import type { Knex } from 'knex';

/**
 * Transaccion en curso, ligada al contexto asincrono de la peticion.
 *
 * El patron outbox solo funciona si el evento se escribe en la MISMA
 * transaccion que el cambio de negocio (SRS RNF46). Eso obliga a que el
 * repositorio de usuarios y el de eventos compartan conexion.
 *
 * Se resuelve con AsyncLocalStorage y no pasando la transaccion como parametro
 * porque lo segundo obligaria a que cada caso de uso la reciba y la reenvie a
 * cada puerto, ensuciando la capa de aplicacion con un detalle de persistencia
 * —justo lo que la arquitectura hexagonal existe para evitar—.
 *
 * El riesgo de un contexto implicito es olvidarse de abrirlo: por eso
 * `requireTransaction` falla de forma explicita en lugar de escribir por fuera
 * de la transaccion sin avisar.
 */
const almacen = new AsyncLocalStorage<Knex.Transaction>();

/**
 * Ejecuta el callback dentro de una transaccion.
 *
 * Confirma si termina y revierte si lanza. Anidar llamadas reutiliza la
 * transaccion externa en lugar de abrir una segunda, que en MySQL no seria
 * independiente de todos modos.
 */
export async function runInTransaction<T>(knex: Knex, fn: () => Promise<T>): Promise<T> {
  const existente = almacen.getStore();
  if (existente !== undefined) return fn();

  return knex.transaction((trx) => almacen.run(trx, fn));
}

/** Conexion a usar: la transaccion en curso o, si no hay, la conexion normal. */
export function currentDb(knex: Knex): Knex | Knex.Transaction {
  return almacen.getStore() ?? knex;
}

/**
 * Exige que haya una transaccion abierta.
 *
 * La usa el outbox: escribir un evento fuera de una transaccion rompe la
 * garantia que el patron promete, y es preferible fallar ruidosamente ahora que
 * perder eventos en silencio despues.
 */
export function requireTransaction(): Knex.Transaction {
  const trx = almacen.getStore();
  if (trx === undefined) {
    throw new Error(
      'Se intento escribir en el outbox fuera de una transaccion. ' +
        'Envuelva la operacion en runInTransaction().'
    );
  }
  return trx;
}
