import amqp, { type Channel, type ConfirmChannel, type Connection } from 'amqplib';

export interface BrokerConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  /** Intercambio de tipo topic donde se publican todos los eventos. */
  exchange: string;
  /** Reintentos antes de derivar a la cola de mensajes fallidos (SRS RF96). */
  maxRetries: number;
}

export interface Logger {
  info(mensaje: string, contexto?: Record<string, unknown>): void;
  error(mensaje: string, contexto?: Record<string, unknown>): void;
}

/**
 * Conexion al broker con reconexion automatica.
 *
 * La reconexion no es un adorno: el relevo del outbox y los consumidores son
 * procesos de larga vida, y el broker se reinicia. Sin ella, un reinicio de
 * RabbitMQ dejaria a los servicios publicando contra una conexion muerta hasta
 * que alguien los reiniciara a mano.
 *
 * Que el broker no este disponible NO es un error fatal: los eventos se quedan
 * en el outbox y salen cuando vuelva (SRS RNF37).
 */
export class Broker {
  private conexion: Connection | null = null;
  private canal: ConfirmChannel | null = null;
  private cerrando = false;
  private reconectando = false;

  constructor(
    private readonly config: BrokerConfig,
    private readonly logger: Logger
  ) {}

  private get url(): string {
    const usuario = encodeURIComponent(this.config.user);
    const clave = encodeURIComponent(this.config.password);
    return `amqp://${usuario}:${clave}@${this.config.host}:${this.config.port}`;
  }

  async conectar(): Promise<void> {
    if (this.canal !== null || this.cerrando) return;

    const conexion = await amqp.connect(this.url);
    this.conexion = conexion;
    this.canal = await conexion.createConfirmChannel();

    // Intercambio duradero: sobrevive al reinicio del broker. Un intercambio
    // efimero se perderia y los publicadores escribirian al vacio.
    await this.canal.assertExchange(this.config.exchange, 'topic', { durable: true });

    conexion.on('error', (error: Error) => {
      this.logger.error('conexion con el broker con error', { mensaje: error.message });
    });
    conexion.on('close', () => {
      this.canal = null;
      this.conexion = null;
      if (!this.cerrando) void this.reconectar();
    });
  }

  private async reconectar(): Promise<void> {
    if (this.reconectando || this.cerrando) return;
    this.reconectando = true;

    // Retroceso exponencial acotado: reintentar cada milisegundo contra un
    // broker caido solo anade carga al sistema que intenta recuperarse.
    for (let intento = 0; intento < 60 && !this.cerrando; intento += 1) {
      const espera = Math.min(1000 * 2 ** Math.min(intento, 5), 30_000);
      await new Promise((r) => setTimeout(r, espera));
      try {
        await this.conectar();
        this.logger.info('reconectado al broker', { intento: intento + 1 });
        this.reconectando = false;
        return;
      } catch {
        // Se sigue intentando; el detalle ya se registro en el evento 'error'.
      }
    }

    this.reconectando = false;
  }

  get disponible(): boolean {
    return this.canal !== null;
  }

  /**
   * Publica y espera la confirmacion del broker.
   *
   * Sin confirmacion, `publish` solo escribe en el socket: devolveria exito
   * aunque el broker no llegara a persistir el mensaje, y el relevo marcaria el
   * evento como publicado sin que lo estuviera.
   */
  async publicar(routingKey: string, contenido: Buffer, eventId: string): Promise<void> {
    if (this.canal === null) throw new Error('El broker no esta disponible.');
    const canal = this.canal;

    await new Promise<void>((resolve, reject) => {
      canal.publish(
        this.config.exchange,
        routingKey,
        contenido,
        {
          persistent: true, // el mensaje sobrevive al reinicio del broker
          contentType: 'application/json',
          messageId: eventId,
        },
        (error: Error | null) => (error === null ? resolve() : reject(error))
      );
    });
  }

  /**
   * Declara la cola de un consumidor con su cola de mensajes fallidos.
   *
   * Un mensaje que falla repetidamente se deriva en lugar de reintentarse sin
   * fin: bloquear la cola por un solo evento defectuoso detiene todo lo demas
   * (SRS RF96, RNF82).
   */
  async declararCola(cola: string, patrones: readonly string[]): Promise<void> {
    if (this.canal === null) throw new Error('El broker no esta disponible.');

    const colaFallidos = `${cola}.dlq`;
    await this.canal.assertQueue(colaFallidos, { durable: true });

    await this.canal.assertQueue(cola, {
      durable: true,
      deadLetterExchange: '',
      deadLetterRoutingKey: colaFallidos,
    });

    for (const patron of patrones) {
      await this.canal.bindQueue(cola, this.config.exchange, patron);
    }
  }

  get canalActivo(): ConfirmChannel | null {
    return this.canal;
  }

  async cerrar(): Promise<void> {
    this.cerrando = true;
    try {
      await this.canal?.close();
      await this.conexion?.close();
    } catch {
      // Cerrar una conexion ya rota no es un problema que deba propagarse.
    }
    this.canal = null;
    this.conexion = null;
  }
}
