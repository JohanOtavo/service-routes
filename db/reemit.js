/**
 * Re-emision de eventos desde la outbox (A-4 del backlog).
 *
 * Que resuelve. `outbox_event` es de solo append: `OutboxRelay` publica lo que
 * tiene `published_at IS NULL` y marca la fila. No hay ningun comando en el
 * repositorio que vuelva a publicar una fila ya publicada, asi que si se pierde
 * `processed_event` del lado del consumidor —o la tabla replica entera— no hay
 * manera de volver a poblarla. Este modulo es esa manera.
 *
 * **Como republica: con un `event_id` nuevo, y sin tocar el destino.**
 *
 * Es la decision que se tomo, y conviene dejar escrito por que la otra tambien
 * era posible. `EventConsumer` descarta un evento cuyo `event_id` ya figure en
 * `processed_event` (`packages/messaging/src/consumer.ts:134`), asi que
 * republicar el original exigiria borrar antes la marca del servicio destino.
 * Eso conserva la trazabilidad del evento, pero borra evidencia de que ya se
 * proceso, obliga a coordinar con un servicio que puede no estar disponible, y
 * hace que el comando dependa de permisos sobre el esquema de otro. Con un
 * `event_id` nuevo el consumidor lo acepta como cualquier evento y el comando no
 * necesita tocar nada fuera de su propio esquema.
 *
 * Lo que se pierde es la equivalencia exacta: dos eventos con el mismo agregado
 * y distinto `event_id`. A cambio, todos los efectos son UPSERT, asi que
 * reproducir un evento dos veces no duplica nada —es lo que sostiene la entrega
 * «al menos una vez» del patron— y por eso el comando se puede repetir sin miedo.
 *
 * **Como se entrega: por el camino de siempre.**
 *
 * No publica al broker. Encola filas nuevas y las deja sin publicar, para que las
 * recoja el `OutboxRelay` del servicio. No hay codigo de publicacion nuevo que
 * mantener ni un segundo camino de entrega que pueda divergir del primero, y el
 * reintento ante un broker caido es el que ya existe.
 *
 * **Por que conserva `occurred_at`.**
 *
 * El relay publica en orden de `occurred_at`, y el orden importa: `servicio_ref`
 * y las calificaciones tienen clave foranea contra `prestador_ref`, que viene de
 * un evento anterior. Reemitir con la fecha de hoy reordenaria el flujo y las
 * filas que dependen de otras llegarian antes que aquellas de las que dependen.
 * La copia conserva la fecha original, y `causation_id` apunta al `event_id` del
 * evento original para que se pueda seguir el rastro de que esto es una
 * repeticion. Ningun consumidor usa `causation_id` para decidir nada —solo lo
 * transporta—, asi que no cambia el comportamiento de nadie.
 */
'use strict';

const crypto = require('node:crypto');

/**
 * Excluye las filas que no conviene copiar de nuevo.
 *
 * Son dos exclusiones y las dos hacen falta:
 *
 *  1. Las que ya son una repeticion, que se distinguen por `reemit_of`.
 *  2. Los originales que ya se copiaron, esto es, aquellos para los que existe
 *     una fila con `reemit_of` apuntando a su `event_id`.
 *
 * La segunda es la que hace el comando idempotente, y sin ella el primero solo
 * evita la duplicacion exponencial pero no la lineal: cada ejecucion volvia a
 * copiar el original, de modo que tres ejecuciones seguidas dejaban tres copias
 * del mismo alta. Ejecutar un comando de recuperacion dos veces por desconfiar
 * del resultado es el caso de uso mas probable, y tiene que devolver lo mismo
 * que la primera.
 *
 * Conviene registrar por que no se deduce del `causation_id`, porque fue el
 * primer intento y era incorrecto. Un evento de negocio tambien puede tener
 * `causation_id` apuntando a otro evento de la misma outbox —en un flujo, un
 * evento lo causa otro—, de modo que ese filtro no distingue una cosa de la otra
 * sino que las confunde. Hoy no se nota porque ningun servicio escribe esa
 * columna, con lo que el filtro funciona por casualidad y no por estar bien. En
 * cuanto un servicio la use, que es lo que la columna existe para, se llevarian
 * por delante los eventos encadenados, que son precisamente los que reconstruyen
 * `prestador_ref`.
 */
function soloOriginales(consulta, db) {
  return consulta.whereNull('reemit_of').whereNotExists(function yaCopiado() {
    this.select(db.raw('1'))
      .from({ copia: 'outbox_event' })
      .whereRaw('copia.reemit_of = outbox_event.event_id');
  });
}

/**
 * Copia las filas indicadas de la outbox como filas nuevas pendientes.
 *
 * Devuelve cuantas filas hay candidatas y cuantas se encolaron. Con
 * `ejecutar: false` no escribe nada, que es el modo por defecto del comando: ver
 * cuantos eventos van a salir es parte del trabajo, no un extra.
 */
async function reemitir(db, opciones) {
  const {
    event = [],
    desde = null,
    hasta = null,
    limite = 1000,
    agregado = null,
    incluirRepeticiones = false,
    ejecutar = false,
  } = opciones;

  const común = (consulta) => {
    let q = consulta;
    if (event.length > 0) q = q.whereIn('event_name', event);
    if (desde !== null) q = q.where('occurred_at', '>=', desde);
    if (hasta !== null) q = q.where('occurred_at', '<=', hasta);
    // `--agregado` acota a una entidad concreta. Sin el, "reemitir el alta de
    // este usuario" no se puede expresar: el unico recorte seria un `--limite`,
    // que depende del orden de la tabla y por lo tanto no significa nada.
    if (agregado !== null) q = q.where('aggregate_id', String(agregado));
    return q;
  };

  let consulta = común(db('outbox_event'));
  if (!incluirRepeticiones) consulta = soloOriginales(consulta, db);

  const candidatas = await consulta
    .clone()
    .orderBy('occurred_at', 'asc')
    .orderBy('id_outbox', 'asc')
    .limit(limite)
    .select(
      'event_id',
      'event_name',
      'event_version',
      'aggregate_type',
      'aggregate_id',
      'correlation_id',
      'payload',
      'occurred_at'
    );

  if (!ejecutar || candidatas.length === 0) {
    return { candidatas: candidatas.length, encoladas: 0, truncado: candidatas.length === limite };
  }

  const copias = candidatas.map((fila) => ({
    // Identidad nueva: es lo que permite al consumidor aceptarlo sin que haya que
    // borrar su marca de "ya procesado".
    event_id: crypto.randomUUID(),
    event_name: fila.event_name,
    event_version: fila.event_version,
    aggregate_type: fila.aggregate_type,
    aggregate_id: fila.aggregate_id,
    correlation_id: fila.correlation_id,
    // El evento original es la causa de esta repeticion. Ningun consumidor lo
    // lee; se conserva por trazabilidad.
    causation_id: fila.event_id,
    // Y esta es la columna que hace que la fila sea reconocible como
    // repeticion, sin depender de `causation_id`.
    reemit_of: fila.event_id,
    payload: typeof fila.payload === 'string' ? JSON.parse(fila.payload) : fila.payload,
    // Se conserva la fecha original a proposito: es la que fija el orden de
    // publicacion del relay, y ese orden es el que respeta las claves foraneas
    // entre esquemas.
    occurred_at: fila.occurred_at,
    published_at: null,
    attempts: 0,
    last_error: null,
  }));

  await db('outbox_event').insert(copias);

  return { candidatas: candidatas.length, encoladas: copias.length, truncado: false };
}

/**
 * Resumen legible de lo que hay en la outbox, para decidir antes de reemitir.
 *
 * El detalle que importa es el de `publicadas`: un evento que nunca llego al
 * broker no es un evento perdido, es un evento que el relay deberia haber
 * publicado. Reemitirlo no arregla un relay parado, solo duplica el problema.
 */
async function resumen(db, opciones) {
  const { event = [], desde = null, hasta = null, agregado = null } = opciones;

  const común = (consulta) => {
    let q = consulta;
    if (event.length > 0) q = q.whereIn('event_name', event);
    if (desde !== null) q = q.where('occurred_at', '>=', desde);
    if (hasta !== null) q = q.where('occurred_at', '<=', hasta);
    if (agregado !== null) q = q.where('aggregate_id', String(agregado));
    return q;
  };

  const porNombre = await común(db('outbox_event'))
    .select('event_name')
    .count({ total: '*' })
    .count({ publicadas: 'published_at' })
    .groupBy('event_name')
    .orderBy('event_name');

  // Las dos cifras que explican por que el comando propone menos cosas de las que
  // hay, y conviene no mezclarlas: una repeticion es una fila que puso este
  // comando, y un original ya copiado es un evento legitimo que no hay que volver
  // a copiar. Sumarlas en un solo numero daria "2 filas que se saltan" sin poder
  // decir que una de ellas es un alta de verdad.
  const [repetidas] = await común(db('outbox_event')).whereNotNull('reemit_of').count({ n: '*' });
  const [originales] = await soloOriginales(común(db('outbox_event')), db).count({ n: '*' });
  const [todas] = await común(db('outbox_event')).count({ n: '*' });

  const total = Number(todas?.n ?? 0);
  const sinRepetir = Number(originales?.n ?? 0);

  return {
    porNombre,
    repetidas: Number(repetidas?.n ?? 0),
    yaReemitidos: total - sinRepetir - Number(repetidas?.n ?? 0),
  };
}

module.exports = { reemitir, resumen };
