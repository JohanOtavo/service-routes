/**
 * Re-emision de eventos para reconstruir las replicas (A-2, B-2).
 *
 * Las tablas `*_ref` de los otros esquemas se alimentan solo de eventos. Si se
 * pierde `outbox_event` o `processed_event`, no habia forma de volver a
 * poblarlas: el catalogo se quedaba sin prestadores y una recuperacion ante
 * desastres era irrecuperable. Esto toma el estado ACTUAL de la tabla que cada
 * servicio posee y vuelve a escribir su evento de alta en su propio outbox. El
 * relevo lo publica por el camino de siempre y los consumidores hacen upsert.
 *
 * Tres cosas que hay que entender antes de tocar este archivo.
 *
 * **Los `event_id` son nuevos, no los de antes.** `processed_event` tiene clave
 * primaria `(consumer, event_id)`, asi que reutilizar el identificador haria
 * que todo consumidor descartara el evento por idempotencia y la
 * reconstruccion no haria nada. Con uno nuevo, el evento se procesa de verdad.
 *
 * **Y por eso cada payload lleva `reemision: true`.** Esa misma idempotencia
 * es la que protege de los efectos que NO son poblar una replica. El
 * consumidor de `UserRegistered` de notification-service hace dos cosas:
 * refresca `usuario_ref` —que es lo que se quiere— y crea un aviso de
 * BIENVENIDA —que no—. Sin la marca, reconstruir las replicas inundaria la
 * bandeja de cada usuario con un saludo duplicado. Los manejadores con efectos
 * de ese tipo comprueban la marca y se saltan esa parte.
 *
 * **No se re-emite `ServiceRequestCancelled`.** Su consumidor de rating-service
 * no solo replica: imputa la cancelacion a la tasa de un usuario. Volver a
 * emitirlo contaria dos veces cancelaciones reales y podria cruzar el umbral
 * que suspende a un prestador. El payload original, ademas, enmascara `peso` y
 * `computa` segun el estado de la revision y recalcula `faceta`, asi que no se
 * puede reconstruir fielmente desde la tabla. `cancelacion_ref` se queda sin
 * reconstruir, y eso esta anotado en el backlog en lugar de resuelto a medias.
 */
'use strict';

const { randomUUID } = require('node:crypto');

/**
 * Qué se re-emite por servicio.
 *
 * `cargar(db)` devuelve las filas del estado actual; `evento(fila)` las
 * traduce al contrato que el consumidor espera. Los nombres de las claves son
 * los que lee el consumidor, no los que parezcan razonables: una clave mal
 * escrita no falla, deja la columna vacia.
 */
const FUENTES = {
  auth: [
    {
      descripcion:
        'usuarios -> UserRegistered (usuario_ref en provider, request, rating, notification)',
      async cargar(db) {
        const usuarios = await db('usuario')
          .select('id_usuario', 'nombre', 'correo', 'created_at')
          .whereNull('deleted_at')
          .orderBy('id_usuario');

        // Los roles viajan en el payload y no estan en `usuario`. Una sola
        // consulta para todos y se agrupan aqui: una por usuario convertiria
        // la re-emision en N+1 consultas contra la tabla mas consultada.
        const roles = await db('usuario_rol as ur')
          .join('rol as r', 'r.id_rol', 'ur.id_rol')
          .select('ur.id_usuario', 'r.nombre_rol');

        const porUsuario = new Map();
        for (const fila of roles) {
          const clave = String(fila.id_usuario);
          const lista = porUsuario.get(clave);
          if (lista === undefined) porUsuario.set(clave, [fila.nombre_rol]);
          else lista.push(fila.nombre_rol);
        }

        return usuarios.map((u) => ({ ...u, roles: porUsuario.get(String(u.id_usuario)) ?? [] }));
      },
      evento(fila) {
        return {
          event_name: 'UserRegistered',
          aggregate_type: 'Usuario',
          aggregate_id: String(fila.id_usuario),
          payload: {
            userId: Number(fila.id_usuario),
            nombre: fila.nombre,
            correo: fila.correo,
            roles: fila.roles,
            // La fecha del alta original, no la de ahora: es el unico dato del
            // payload que describe cuando paso el hecho.
            occurredAt: new Date(fila.created_at).toISOString(),
          },
        };
      },
    },
  ],

  provider: [
    {
      descripcion:
        'prestadores -> ServiceProviderProfileCreated (prestador_ref en catalog y request)',
      async cargar(db) {
        return db('prestador')
          .select('id_prestador', 'id_usuario', 'nombre', 'especialidad', 'estado', 'telefono')
          .whereNull('deleted_at')
          .orderBy('id_prestador');
      },
      evento(fila) {
        return {
          event_name: 'ServiceProviderProfileCreated',
          aggregate_type: 'Prestador',
          aggregate_id: String(fila.id_prestador),
          payload: {
            idPrestador: Number(fila.id_prestador),
            idUsuario: Number(fila.id_usuario),
            nombre: fila.nombre,
            especialidad: fila.especialidad,
            // El estado de HOY, que puede no ser el PENDING_VALIDATION del
            // alta. Reconstruir el estado inicial dejaria el catalogo
            // ocultando prestadores que llevan meses activos.
            estado: fila.estado,
            /**
             * El telefono tambien (B-1).
             *
             * Sin el, reconstruir `prestador_ref` dejaria a cada contratacion
             * acordada sin el numero de su contraparte, y el sintoma seria un
             * hueco en la pantalla en lugar de un error.
             */
            telefono: fila.telefono,
          },
        };
      },
    },
  ],

  catalog: [
    {
      descripcion: 'categorias -> CategoryCreated (categoria_ref en request)',
      async cargar(db) {
        return db('categoria_servicio')
          .select('id_categoria', 'nombre_categoria', 'activa')
          .whereNull('deleted_at')
          .orderBy('id_categoria');
      },
      evento(fila) {
        return {
          event_name: 'CategoryCreated',
          aggregate_type: 'Categoria',
          aggregate_id: String(fila.id_categoria),
          payload: {
            idCategoria: Number(fila.id_categoria),
            nombre: fila.nombre_categoria,
            activa: Boolean(fila.activa),
          },
        };
      },
    },
    {
      descripcion: 'servicios -> ServicePublished (servicio_ref en request)',
      async cargar(db) {
        return db('servicio')
          .select('id_servicio', 'id_prestador', 'id_categoria', 'nombre_servicio', 'estado')
          .whereNull('deleted_at')
          .orderBy('id_servicio');
      },
      evento(fila) {
        return {
          event_name: 'ServicePublished',
          aggregate_type: 'Servicio',
          aggregate_id: String(fila.id_servicio),
          payload: {
            idServicio: Number(fila.id_servicio),
            idPrestador: Number(fila.id_prestador),
            idCategoria: Number(fila.id_categoria),
            nombreServicio: fila.nombre_servicio,
            estado: fila.estado,
          },
        };
      },
    },
  ],

  request: [
    {
      descripcion: 'solicitudes -> ServiceRequestCreated (solicitud_ref en rating)',
      async cargar(db) {
        /**
         * `idUsuarioPrestador` no es columna de `solicitud_servicio`.
         *
         * Sale de la replica local de prestadores. El consumidor de rating lo
         * convierte con `Number(...)` sin comprobar si viene vacio, y la
         * columna de destino es NOT NULL: una solicitud cuyo prestador no este
         * replicado aqui produciria `NaN`. Se excluye con el INNER JOIN en vez
         * de emitir un evento que el consumidor derivaria a la cola de
         * fallidos.
         */
        return db('solicitud_servicio as s')
          .join('prestador_ref as p', 'p.id_prestador', 's.id_prestador')
          .select(
            's.id_solicitud',
            's.origen',
            's.id_usuario',
            's.id_prestador',
            's.id_servicio',
            's.estado',
            'p.id_usuario as id_usuario_prestador'
          )
          .whereNull('s.deleted_at')
          .orderBy('s.id_solicitud');
      },
      evento(fila) {
        return {
          event_name: 'ServiceRequestCreated',
          aggregate_type: 'Solicitud',
          aggregate_id: String(fila.id_solicitud),
          payload: {
            idSolicitud: Number(fila.id_solicitud),
            origen: fila.origen,
            idUsuario: Number(fila.id_usuario),
            idPrestador: Number(fila.id_prestador),
            idUsuarioPrestador: Number(fila.id_usuario_prestador),
            idServicio: fila.id_servicio === null ? null : Number(fila.id_servicio),
            estado: fila.estado,
          },
        };
      },
    },
  ],
};

/** Servicios con algo que re-emitir. Los demas no poseen ninguna replica. */
const SERVICIOS_CON_FUENTE = Object.keys(FUENTES);

/**
 * Escribe en el outbox del servicio los eventos de su estado actual.
 *
 * No publica: eso es del relevo, que ya sabe reintentar y marcar. Escribir aqui
 * y publicar alli es lo que hace que la re-emision use exactamente el mismo
 * camino que un alta real en lugar de uno paralelo que se desincroniza.
 */
async function reemitir(db, servicio) {
  const fuentes = FUENTES[servicio];
  if (fuentes === undefined)
    return { servicio, escritos: 0, detalle: ['sin replicas que re-emitir'] };

  const correlationId = randomUUID();
  const detalle = [];
  let escritos = 0;

  for (const fuente of fuentes) {
    const filas = await fuente.cargar(db);
    if (filas.length === 0) {
      detalle.push(`${fuente.descripcion}: 0`);
      continue;
    }

    const ahora = new Date();
    const eventos = filas.map((fila) => {
      const base = fuente.evento(fila);
      return {
        event_id: randomUUID(),
        event_name: base.event_name,
        event_version: 1,
        aggregate_type: base.aggregate_type,
        aggregate_id: base.aggregate_id,
        // Un solo correlation_id para toda la tanda: permite encontrar en la
        // auditoria de cualquier servicio exactamente que re-emision produjo
        // un cambio.
        correlation_id: correlationId,
        causation_id: null,
        payload: JSON.stringify({ ...base.payload, reemision: true }),
        occurred_at: ahora,
      };
    });

    // Por lotes y no de una: una re-emision completa de usuarios puede ser
    // decenas de miles de filas, y un INSERT unico de ese tamano choca con
    // max_allowed_packet.
    for (let i = 0; i < eventos.length; i += 500) {
      await db('outbox_event').insert(eventos.slice(i, i + 500));
    }

    escritos += eventos.length;
    detalle.push(`${fuente.descripcion}: ${eventos.length}`);
  }

  return { servicio, escritos, correlationId, detalle };
}

module.exports = { reemitir, SERVICIOS_CON_FUENTE };
