import type { Knex } from 'knex';
import type { ConfirmChannel, ConsumeMessage } from 'amqplib';
import { eventEnvelopeSchema, type EventEnvelope } from '@punto-amigo/shared';
import type { Broker, Logger } from './broker';

/**
 * Manejador de un evento.
 *
 * Recibe la transaccion para que su efecto y el registro de "ya procesado" se
 * confirmen juntos. Si se confirmaran por separado, un fallo entre ambos
 * dejaria el efecto aplicado sin marca —y se repetiria— o la marca sin efecto
 * —y se perderia—.
 */
export type ManejadorEvento = (sobre: EventEnvelope, trx: Knex.Transaction) => Promise<void>;

export interface ConsumerConfig {
  /** Nombre de la cola de este servicio. */
  cola: string;
  /** Patrones de enrutado a los que se suscribe. */
  patrones: readonly string[];
  /** Identificador del manejador, para la clave de idempotencia. */
  consumidor: string;
  /** Mensajes en vuelo a la vez. */
  prefetch: number;
}

/**
 * Consumidor de eventos con idempotencia y derivacion a la cola de fallidos.
 *
 * El broker entrega "al menos una vez", asi que el mismo evento puede llegar dos
 * veces: un reinicio del consumidor entre el efecto y la confirmacion basta. Sin
 * la tabla `processed_event`, la segunda entrega enviaria la notificacion
 * duplicada e incrementaria el contador dos veces (SRS RF95, RNF89).
 */
/** Codigo de MySQL para violacion de clave unica. */
const ER_DUP_ENTRY = 1062;

function esClaveDuplicada(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { errno?: number }).errno === ER_DUP_ENTRY
  );
}

export class EventConsumer {
  private readonly manejadores = new Map<string, ManejadorEvento>();
  /** El canal en el que esta puesta la suscripcion actual, si la hay. */
  private canalSuscrito: ConfirmChannel | null = null;

  constructor(
    private readonly knex: Knex,
    private readonly broker: Broker,
    private readonly config: ConsumerConfig,
    private readonly logger: Logger
  ) {
    /**
     * La suscripcion se rehace en cada conexion, no solo al arrancar.
     *
     * Se engancha en el constructor y no en `iniciar()` a proposito: cuando el
     * broker todavia no esta arriba, `main` falla en `broker.conectar()` y no
     * llega a llamar a `iniciar()`. Enganchandolo aqui, la suscripcion ocurre
     * sola en cuanto hay broker, sin que nadie tenga que reintentar.
     */
    this.broker.onConectado(() => this.suscribir());
  }

  /** Registra el manejador de un tipo de evento. */
  on(eventName: string, manejador: ManejadorEvento): this {
    this.manejadores.set(eventName, manejador);
    return this;
  }

  /**
   * Pone la suscripcion en marcha.
   *
   * Sigue lanzando si el broker no esta disponible: quien llama en el arranque
   * lo registra, y el enganche del constructor se encarga de que la suscripcion
   * llegue cuando el broker vuelva.
   */
  async iniciar(): Promise<void> {
    await this.suscribir();
  }

  private async suscribir(): Promise<void> {
    const canalActual = this.broker.canalActivo;
    if (canalActual === null) throw new Error('El broker no esta disponible.');

    // Ya suscrito en ESTE canal. Pasa en el arranque normal, donde el enganche
    // corre dentro de `conectar()` y `main` llama a `iniciar()` justo despues;
    // suscribirse dos veces en el mismo canal duplicaria cada entrega.
    if (this.canalSuscrito === canalActual) return;

    await this.broker.declararCola(this.config.cola, this.config.patrones);

    const canal = this.broker.canalActivo;
    if (canal === null) throw new Error('El broker no esta disponible.');

    // Sin prefetch, RabbitMQ envia toda la cola de golpe y el consumidor la
    // acumula en memoria sin poder repartir la carga con otra instancia.
    await canal.prefetch(this.config.prefetch);

    await canal.consume(this.config.cola, (mensaje) => {
      void this.procesar(mensaje);
    });

    this.canalSuscrito = canal;

    this.logger.info('consumidor iniciado', {
      cola: this.config.cola,
      eventos: [...this.manejadores.keys()],
    });
  }

  private async procesar(mensaje: ConsumeMessage | null): Promise<void> {
    if (mensaje === null) return;
    const canal = this.broker.canalActivo;
    if (canal === null) return;

    let sobre: EventEnvelope;
    try {
      sobre = eventEnvelopeSchema.parse(JSON.parse(mensaje.content.toString('utf8')));
    } catch (error) {
      // Un mensaje que no se puede interpretar no mejora con reintentos: se
      // deriva de inmediato en lugar de rebotar en la cola para siempre.
      this.logger.error('mensaje con formato invalido, derivado a la cola de fallidos', {
        mensaje: error instanceof Error ? error.message : String(error),
      });
      canal.nack(mensaje, false, false);
      return;
    }

    const manejador = this.manejadores.get(sobre.eventName);
    if (manejador === undefined) {
      // Suscrito por patron a un evento sin manejador: no es un error, solo no
      // interesa. Se confirma para que no se acumule.
      canal.ack(mensaje);
      return;
    }

    try {
      const aplicado = await this.knex.transaction(async (trx) => {
        /**
         * La marca se inserta ANTES de ejecutar el efecto.
         *
         * Si un segundo mensaje del mismo evento llega mientras el primero se
         * procesa, choca con la clave primaria y se descarta. Hacerlo despues
         * dejaria una ventana en la que ambos pasarian la comprobacion.
         *
         * El choque se detecta por la EXCEPCION y no por el numero de filas.
         * `onConflict().ignore()` seria mas limpio de leer, pero en MySQL se
         * compila a `INSERT IGNORE` y Knex devuelve `[insertId]`, no las filas
         * afectadas. Como esta tabla tiene clave primaria compuesta y ningun
         * autoincremento, ese valor es 0 SIEMPRE: tanto en el alta buena como
         * en la repetida. Leerlo como "0 filas, ya estaba" hacia que ningun
         * manejador llegara a ejecutarse nunca, mientras la marca quedaba
         * escrita y el mensaje se confirmaba. Un sistema de eventos que no
         * aplica ninguno y no se queja.
         */
        try {
          await trx('processed_event').insert({
            consumer: this.config.consumidor,
            event_id: sobre.eventId,
            event_name: sobre.eventName,
          });
        } catch (error) {
          if (esClaveDuplicada(error)) return false;
          throw error;
        }

        await manejador(sobre, trx);
        return true;
      });

      if (!aplicado) {
        this.logger.info('evento ya procesado, descartado', {
          eventId: sobre.eventId,
          eventName: sobre.eventName,
        });
      }

      canal.ack(mensaje);
    } catch (error) {
      const intentos = contarEntregas(mensaje);
      const mensajeError = error instanceof Error ? error.message : String(error);

      this.logger.error('fallo al procesar un evento', {
        eventId: sobre.eventId,
        eventName: sobre.eventName,
        correlationId: sobre.correlationId,
        intentos,
        mensaje: mensajeError,
      });

      // requeue=false deriva a la cola de fallidos. Reencolar sin limite
      // convierte un evento defectuoso en un bucle que bloquea la cola entera.
      canal.nack(mensaje, false, false);
    }
  }
}

/** Entregas previas segun la cabecera que anade RabbitMQ al derivar. */
function contarEntregas(mensaje: ConsumeMessage): number {
  const muertes = mensaje.properties.headers?.['x-death'];
  if (!Array.isArray(muertes) || muertes.length === 0) return 1;
  const primera = muertes[0] as { count?: number };
  return Number(primera.count ?? 0) + 1;
}
