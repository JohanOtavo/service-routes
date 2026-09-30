import { OutboxRelay } from '../src/outbox-relay';
import type { Broker } from '../src/broker';

/**
 * Pruebas del relevo del outbox.
 *
 * Lo que importa aqui no es el camino feliz sino las garantias: que un fallo del
 * broker no pierda eventos, que un evento no se marque como publicado si no lo
 * fue, y que agotar los intentos no bloquee a los demas.
 */

interface FilaFalsa {
  id_outbox: number;
  event_id: string;
  event_name: string;
  event_version: number;
  aggregate_type: string;
  aggregate_id: string;
  correlation_id: string;
  causation_id: string | null;
  payload: unknown;
  occurred_at: Date;
  attempts: number;
  published_at: Date | null;
  last_error: string | null;
}

/**
 * Knex falso con el minimo de la interfaz fluida que usa el relevo.
 *
 * Se prefiere sobre una base real porque estas pruebas comprueban la logica de
 * decision del relevo, no el SQL; el SQL ya se verifica en las pruebas de
 * integracion.
 */
function knexFalso(filas: FilaFalsa[]) {
  const estado = { filas };

  const constructor = (_tabla: string) => {
    let filtroNulo = false;
    let maxIntentos = Number.POSITIVE_INFINITY;
    let minIntentos = -1;
    let idObjetivo: number | null = null;
    let limite = Number.POSITIVE_INFINITY;

    const api = {
      whereNull(_columna: string) {
        filtroNulo = true;
        return api;
      },
      where(a: unknown, b?: unknown, c?: unknown) {
        if (typeof a === 'object' && a !== null && 'id_outbox' in a) {
          idObjetivo = (a as { id_outbox: number }).id_outbox;
        } else if (a === 'attempts' && b === '<') {
          maxIntentos = Number(c);
        } else if (a === 'attempts' && b === '>=') {
          minIntentos = Number(c);
        }
        return api;
      },
      orderBy() {
        return api;
      },
      limit(n: number) {
        limite = n;
        return api;
      },
      update(cambios: Partial<FilaFalsa>) {
        for (const fila of estado.filas) {
          if (fila.id_outbox === idObjetivo) Object.assign(fila, cambios);
        }
        return Promise.resolve(1);
      },
      increment(columna: keyof FilaFalsa, cantidad: number) {
        for (const fila of estado.filas) {
          if (fila.id_outbox === idObjetivo) {
            (fila[columna] as number) += cantidad;
          }
        }
        return api;
      },
      count() {
        const n = estado.filas.filter(
          (f) => (!filtroNulo || f.published_at === null) && f.attempts >= minIntentos
        ).length;
        return Promise.resolve([{ n }]);
      },
      then(resolver: (filas: FilaFalsa[]) => unknown) {
        const seleccion = estado.filas
          .filter((f) => (!filtroNulo || f.published_at === null) && f.attempts < maxIntentos)
          .slice(0, limite);
        return Promise.resolve(resolver(seleccion));
      },
    };

    return api;
  };

  return { constructor: constructor as never, estado };
}

function brokerFalso(opciones: { disponible?: boolean; fallar?: boolean } = {}) {
  const publicados: { clave: string; eventId: string }[] = [];
  let disponible = opciones.disponible ?? true;
  let fallar = opciones.fallar ?? false;

  const broker = {
    get disponible() {
      return disponible;
    },
    async publicar(clave: string, _contenido: Buffer, eventId: string) {
      if (fallar) throw new Error('el broker rechazo el mensaje');
      publicados.push({ clave, eventId });
    },
  } as unknown as Broker;

  return {
    broker,
    publicados,
    caer(): void {
      disponible = false;
      fallar = true;
    },
    volver(): void {
      disponible = true;
      fallar = false;
    },
  };
}

const logger = { info: () => undefined, error: () => undefined };

function fila(id: number, extra: Partial<FilaFalsa> = {}): FilaFalsa {
  return {
    id_outbox: id,
    event_id: `evento-${id}`,
    event_name: 'UserRegistered',
    event_version: 1,
    aggregate_type: 'Usuario',
    aggregate_id: String(id),
    correlation_id: '11111111-1111-4111-8111-111111111111',
    causation_id: null,
    payload: { userId: id },
    occurred_at: new Date('2026-09-30T12:00:00.000Z'),
    attempts: 0,
    published_at: null,
    last_error: null,
    ...extra,
  };
}

const config = { intervaloMs: 1000, lote: 10, maxIntentos: 3, contexto: 'iam' };

describe('relevo del outbox', () => {
  it('publica lo pendiente y lo marca como publicado', async () => {
    const db = knexFalso([fila(1), fila(2)]);
    const b = brokerFalso();
    const relevo = new OutboxRelay(db.constructor, b.broker, config, logger);

    const publicados = await relevo.ciclo();

    expect(publicados).toBe(2);
    expect(b.publicados).toHaveLength(2);
    expect(db.estado.filas.every((f) => f.published_at !== null)).toBe(true);
  });

  it('construye la clave de enrutado desde el contexto y el agregado', async () => {
    const db = knexFalso([fila(1)]);
    const b = brokerFalso();
    const relevo = new OutboxRelay(db.constructor, b.broker, config, logger);

    await relevo.ciclo();

    expect(b.publicados[0]?.clave).toBe('iam.usuario.user_registered');
  });

  /**
   * La garantia central del patron: un fallo al publicar NO puede marcar el
   * evento como publicado. Si lo hiciera, el evento se perderia para siempre y
   * el sistema quedaria inconsistente sin que nadie lo notara.
   */
  it('no marca como publicado lo que el broker rechazo', async () => {
    const db = knexFalso([fila(1)]);
    const b = brokerFalso({ fallar: true });
    const relevo = new OutboxRelay(db.constructor, b.broker, config, logger);

    await relevo.ciclo();

    expect(db.estado.filas[0]?.published_at).toBeNull();
    expect(db.estado.filas[0]?.attempts).toBe(1);
    expect(db.estado.filas[0]?.last_error).toContain('rechazo');
  });

  it('no hace nada si el broker no esta disponible', async () => {
    const db = knexFalso([fila(1)]);
    const b = brokerFalso({ disponible: false });
    const relevo = new OutboxRelay(db.constructor, b.broker, config, logger);

    expect(await relevo.ciclo()).toBe(0);
    expect(db.estado.filas[0]?.published_at).toBeNull();
  });

  it('reanuda la entrega cuando el broker vuelve', async () => {
    const db = knexFalso([fila(1)]);
    const b = brokerFalso({ disponible: false });
    const relevo = new OutboxRelay(db.constructor, b.broker, config, logger);

    await relevo.ciclo();
    expect(db.estado.filas[0]?.published_at).toBeNull();

    b.volver();
    await relevo.ciclo();

    expect(db.estado.filas[0]?.published_at).not.toBeNull();
  });

  it('deja de reintentar el evento que agoto sus intentos', async () => {
    const db = knexFalso([fila(1, { attempts: 3 }), fila(2)]);
    const b = brokerFalso();
    const relevo = new OutboxRelay(db.constructor, b.broker, config, logger);

    await relevo.ciclo();

    // El agotado se salta; el sano sigue saliendo. Un evento defectuoso no
    // puede bloquear a los demas.
    expect(b.publicados.map((p) => p.eventId)).toEqual(['evento-2']);
  });

  it('cuenta los atascados para que se puedan vigilar', async () => {
    const db = knexFalso([fila(1, { attempts: 3 }), fila(2, { attempts: 5 }), fila(3)]);
    const b = brokerFalso();
    const relevo = new OutboxRelay(db.constructor, b.broker, config, logger);

    expect(await relevo.atascados()).toBe(2);
  });

  it('no solapa ciclos, para no publicar dos veces las mismas filas', async () => {
    const db = knexFalso([fila(1)]);
    const b = brokerFalso();
    const relevo = new OutboxRelay(db.constructor, b.broker, config, logger);

    const [primero, segundo] = await Promise.all([relevo.ciclo(), relevo.ciclo()]);

    expect(primero + segundo).toBe(1);
    expect(b.publicados).toHaveLength(1);
  });
});
