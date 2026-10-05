import { AppError } from '@punto-amigo/shared';
import type { IClock } from '@punto-amigo/service-kit';
import {
  ESTADOS_CUENTA_REF,
  Notificacion,
  TAMANO_PAGINA_MAXIMO,
  exigirNotificacion,
  normalizarPaginacion,
  type DatosNotificacion,
  type DatosUsuarioRef,
  type EstadoCuentaRef,
  type EstadoNotificacion,
  type INotificacionRepository,
  type IUsuarioRefRepository,
  type NotificacionProps,
  type TipoNotificacion,
} from '../src/domain';
import { CreateFromEventUseCase } from '../src/application/use-cases/CreateFromEvent';
import { ManageInboxUseCase } from '../src/application/use-cases/ManageInbox';

/**
 * Pruebas de notification-service sin base de datos.
 *
 * La integracion comprueba que los avisos lleguen a MySQL y que el HTTP
 * responda. Esto comprueba lo que solo se ve desde dentro: que el aviso nazca
 * sin leerse, que no lleve datos de contacto, que no se pueda leer el de otro y
 * que la bandeja no se pida entera de un golpe.
 *
 * Son las primeras de este servicio porque casi toda su logica cabe en el
 * dominio: no hay motor, ni framework, ni politica que justifique esperar a la
 * infraestructura para decir que marcar dos veces el mismo aviso no es un
 * error.
 */

const FECHA = new Date('2026-10-02T15:04:05.000Z');
const OTRO_MOMENTO = new Date('2026-10-03T08:00:00.000Z');

/** Lo que aporta un manejador de eventos: sin estado y sin fechas de lectura. */
const datos = (extra: Partial<DatosNotificacion> = {}): DatosNotificacion => ({
  idUsuario: 7,
  tipo: 'BIENVENIDA' as TipoNotificacion,
  titulo: 'Bienvenido a Punto Amigo',
  mensaje: 'Tu cuenta ya esta activa.',
  fecha: FECHA,
  ...extra,
});

/**
 * Aviso ya persistido, con identificador asignado.
 *
 * `crear` deja el identificador en 0 porque lo pone la base. Para las pruebas de
 * los casos de uso hace falta uno real, asi que se rehidrata como lo haria una
 * fila recuperada.
 */
const persistida = (extra: Partial<NotificacionProps> = {}): Notificacion =>
  Notificacion.rehydrate({
    id: 500,
    idUsuario: 7,
    tipo: 'BIENVENIDA',
    titulo: 'Bienvenido a Punto Amigo',
    mensaje: 'Tu cuenta ya esta activa.',
    recursoTipo: null,
    recursoId: null,
    estado: 'NO_LEIDA',
    leidaAt: null,
    fecha: FECHA,
    ...extra,
  });

/** Reloj fijo: el dominio no debe depender de la hora real para ser correcto. */
class RelojFijo implements IClock {
  constructor(private momento: Date = FECHA) {}
  now(): Date {
    return this.momento;
  }
}

/**
 * Repositorio en memoria que registra lo que se le pide.
 *
 * Guarda la referencia y no una copia a proposito: el agregado se muta a si
 * mismo al marcar leida, y un repositorio que copiara esconderia justo el
 * defecto que se busca.
 */
class NotificacionesFalsas implements INotificacionRepository {
  readonly guardadas: Notificacion[] = [];
  readonly actualizadas: Notificacion[] = [];
  private readonly filas = new Map<number, Notificacion>();

  /** Simula lo que ya esta en la base. */
  sembrar(...avisos: Notificacion[]): void {
    for (const aviso of avisos) this.filas.set(aviso.id, aviso);
  }

  async findById(id: number): Promise<Notificacion | null> {
    return this.filas.get(id) ?? null;
  }

  async save(notificacion: Notificacion): Promise<Notificacion> {
    this.guardadas.push(notificacion);
    this.filas.set(notificacion.id, notificacion);
    return notificacion;
  }

  async update(notificacion: Notificacion): Promise<void> {
    this.actualizadas.push(notificacion);
    this.filas.set(notificacion.id, notificacion);
  }

  async listarDe(
    idUsuario: number,
    filtros: { estado?: EstadoNotificacion | undefined },
    pagina: number,
    tamano: number
  ): Promise<{
    elementos: readonly Notificacion[];
    total: number;
    pagina: number;
    tamano: number;
  }> {
    // El destinatario es obligatorio en el puerto, no un filtro opcional: si
    // ListarDe pudiera listar sin el, la fuga seria question de que alguien lo
    // olvide al anadir una ruta.
    const suyas = [...this.filas.values()].filter((n) => n.idUsuario === idUsuario);
    const filtradas =
      filtros.estado === undefined ? suyas : suyas.filter((n) => n.estado === filtros.estado);
    const inicio = (pagina - 1) * tamano;
    return {
      elementos: filtradas.slice(inicio, inicio + tamano),
      total: filtradas.length,
      pagina,
      tamano,
    };
  }

  async contarNoLeidas(idUsuario: number): Promise<number> {
    return [...this.filas.values()].filter((n) => n.idUsuario === idUsuario && !n.estaLeida).length;
  }

  async marcarTodasLeidasDe(idUsuario: number, leidaAt: Date): Promise<number> {
    let cuantas = 0;
    for (const aviso of this.filas.values()) {
      if (aviso.idUsuario !== idUsuario) continue;
      if (aviso.marcarLeida(idUsuario, leidaAt)) cuantas += 1;
    }
    return cuantas;
  }
}

/** Replica de usuario en memoria. Se siembra declarando quien existe. */
class UsuariosFalsos implements IUsuarioRefRepository {
  readonly guardados: DatosUsuarioRef[] = [];
  readonly estados: { idUsuario: number; estado: EstadoCuentaRef }[] = [];
  readonly especialidades: { idUsuario: number; especialidad: string }[] = [];
  private readonly conocidos = new Set<number>();

  constructor(existentes: readonly number[] = []) {
    existentes.forEach((id) => this.conocidos.add(id));
  }

  async existe(idUsuario: number): Promise<boolean> {
    return this.conocidos.has(idUsuario);
  }

  async guardar(datos: DatosUsuarioRef): Promise<void> {
    this.guardados.push(datos);
    this.conocidos.add(datos.idUsuario);
  }

  async actualizarEstado(
    idUsuario: number,
    estado: EstadoCuentaRef,
    _syncedAt: Date
  ): Promise<number> {
    this.estados.push({ idUsuario, estado });
    return this.conocidos.has(idUsuario) ? 1 : 0;
  }

  async actualizarEspecialidad(
    idUsuario: number,
    especialidad: string,
    _syncedAt: Date
  ): Promise<number> {
    this.especialidades.push({ idUsuario, especialidad });
    return this.conocidos.has(idUsuario) ? 1 : 0;
  }
}

// ─── Nacimiento del aviso ────────────────────────────────────────────────────

describe('creacion del aviso', () => {
  it('nace NO_LEIDA siempre', () => {
    const n = Notificacion.crear(datos());
    expect(n.estado).toBe('NO_LEIDA');
    expect(n.estaLeida).toBe(false);
    expect(n.leidaAt).toBeNull();
    expect(n.tipo).toBe('BIENVENIDA');
  });

  /**
   * El estado no se recibe como parametro, y eso es la invariante: ningun
   * manejador puede insertar un aviso ya leido, porque no hay por donde pedirlo.
   * Si alguien amplia `DatosNotificacion` con un `estado`, esta prueba lo nota.
   */
  it('ignora un estado que se le intente colar', () => {
    const colado = { ...datos(), estado: 'LEIDA', leidaAt: OTRO_MOMENTO } as DatosNotificacion;
    const n = Notificacion.crear(colado);
    expect(n.estado).toBe('NO_LEIDA');
    expect(n.leidaAt).toBeNull();
  });

  it('empieza sin identificador porque lo asigna la base', () => {
    expect(Notificacion.crear(datos()).id).toBe(0);
  });

  it('recorta el titulo y el mensaje', () => {
    const n = Notificacion.crear(
      datos({ titulo: '  Bienvenido  ', mensaje: '\t Tu cuenta ya esta activa. \n' })
    );
    expect(n.vista()['titulo']).toBe('Bienvenido');
    expect(n.vista()['mensaje']).toBe('Tu cuenta ya esta activa.');
  });

  it('exige un titulo util: ni una palabra suelta ni un rollout', () => {
    expect(() => Notificacion.crear(datos({ titulo: 'ok' }))).toThrow(AppError);
    expect(() => Notificacion.crear(datos({ titulo: 'x'.repeat(151) }))).toThrow(AppError);
    expect(() => Notificacion.crear(datos({ titulo: 'x'.repeat(150) }))).not.toThrow();
  });

  it('exige un mensaje util', () => {
    expect(() => Notificacion.crear(datos({ mensaje: 'si' }))).toThrow(AppError);
    expect(() => Notificacion.crear(datos({ mensaje: 'x'.repeat(1001) }))).toThrow(AppError);
    expect(() => Notificacion.crear(datos({ mensaje: 'x'.repeat(1000) }))).not.toThrow();
  });

  it('exige un destinatario que sea un entero positivo', () => {
    for (const idUsuario of [0, -1, 1.5, Number.NaN]) {
      expect(() => Notificacion.crear(datos({ idUsuario }))).toThrow(AppError);
    }
  });

  /**
   * Todos los fallos de una vez, no solo el primero: quien compone el aviso es
   * un manejador de eventos, no una persona rellenando un formulario, y no puede
   * corregir un error por intento.
   */
  it('acumula todos los errores de validacion', () => {
    try {
      Notificacion.crear(datos({ titulo: 'a', mensaje: 'b', idUsuario: 0 }));
      throw new Error('deberia haber fallado');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const campos = ((error as AppError).details ?? []).map((d) => d.field).sort();
      expect(campos).toEqual(['idUsuario', 'mensaje', 'titulo']);
    }
  });
});

// ─── Datos de contacto ───────────────────────────────────────────────────────
//
// La bandeja es lo que el usuario ve sin pensarlo. Un aviso con un telefono o un
// correo convierte la desintermediacion en un directorio que ya no se puede
// recoger (SRS RF31, RF156, RNF84, riesgo N-01). Estas pruebas son la razon por la
// que el dominio se niega a crear el aviso en vez de avisar despues.

describe('el cuerpo no puede llevar datos de contacto', () => {
  const cuerpo = (mensaje: string): void => {
    Notificacion.crear(datos({ mensaje }));
  };

  it('rechaza un correo en el mensaje', () => {
    expect(() => cuerpo('Escribe a ana.correa@correo.com para hablar.')).toThrow(AppError);
  });

  it('rechaza un correo en el titulo', () => {
    expect(() => Notificacion.crear(datos({ titulo: 'Ana@correo.com te escribe' }))).toThrow(
      AppError
    );
  });

  it('rechaza un telefono internacional', () => {
    expect(() => cuerpo('Pedro responde al +57 300 123 4567 cuando pueda.')).toThrow(AppError);
  });

  it('rechaza siete digitos seguidos, que es la forma sin prefijo', () => {
    expect(() => cuerpo('Su numero es 1234567, en la ciudad.')).toThrow(AppError);
  });

  /**
   * El caso que hace la regla utilizable. Una fecha ISO tiene cuatro digitos,
   * dos y dos: si contaran los digitos sueltos, marcaria eso como telefono y el
   * aviso de una necesidad por vencer (RF171) no se podria escribir nunca.
   */
  it('no confunde una fecha con un telefono', () => {
    expect(() => cuerpo('La necesidad 2026-10-01 vence manana: revisala antes.')).not.toThrow();
  });

  it('permite un nombre propio sin tomarlo por un contacto', () => {
    expect(() => cuerpo('Pedro acepto tu solicitud.')).not.toThrow();
  });

  it('avisa con un 422 y un detalle por campo', () => {
    try {
      cuerpo('Pedro acepto tu solicitud. Escribe a pedrito@correo.com.');
      throw new Error('deberia haber fallado');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).httpStatus).toBe(422);
      expect((error as AppError).details?.[0]?.field).toBe('mensaje');
    }
  });
});

// ─── Pertenencia del aviso ───────────────────────────────────────────────────

describe('propiedad del aviso', () => {
  const enBandeja = (): Notificacion =>
    persistida({
      id: 55,
      tipo: 'SOLICITUD_ACEPTADA',
      titulo: 'Tu solicitud fue aceptada',
      mensaje: 'El oferente acepto tu solicitud.',
      recursoTipo: 'SOLICITUD',
      recursoId: 12,
    });

  it('el destinatario puede leer y marcar', () => {
    const n = enBandeja();
    expect(n.vistaParaDestinatario(7)['id']).toBe(55);
    expect(n.marcarLeida(7, FECHA)).toBe(true);
  });

  /**
   * 404 y no 403. Un 403 confirmaria que el identificador corresponde a un aviso
   * real, y con eso se recorre el rango para saber cuantos tiene cada quien y
   * cuando los recibio (SRS RF92, RF93).
   */
  it('marcar el de otro responde 404, no 403', () => {
    const n = enBandeja();
    try {
      n.marcarLeida(99, FECHA);
      throw new Error('deberia haber fallado');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).httpStatus).toBe(404);
    }
  });

  it('leer el de otro responde 404 tambien', () => {
    expect(() => enBandeja().vistaParaDestinatario(99)).toThrow(AppError);
  });

  it('un intento fallido no deja el aviso a medias', () => {
    const n = enBandeja();
    try {
      n.marcarLeida(99, FECHA);
    } catch {
      /* el 404 ya se comprueba arriba; aqui se mira que no quedara cambiado */
    }
    expect(n.estaLeida).toBe(false);
    expect(n.leidaAt).toBeNull();
  });
});

// ─── Marcar como leida ───────────────────────────────────────────────────────

describe('marcado como leida', () => {
  it('la primera vez cambia y devuelve true', () => {
    const n = persistida({ estado: 'NO_LEIDA', leidaAt: null });
    expect(n.marcarLeida(7, FECHA)).toBe(true);
    expect(n.estaLeida).toBe(true);
    expect(n.leidaAt).toEqual(FECHA);
  });

  /**
   * Pulsar dos veces, o que la aplicacion reintente, no es un error del usuario.
   * Por eso devuelve false en vez de lanzar, y quien lo llama evita escribir.
   */
  it('la segunda vez no cambia y devuelve false', () => {
    const n = persistida({ estado: 'LEIDA', leidaAt: FECHA });
    expect(n.marcarLeida(7, OTRO_MOMENTO)).toBe(false);
    expect(n.leidaAt).toEqual(FECHA);
  });

  /**
   * `leida_at` guarda la PRIMERA lectura, no la ultima. Si guardara la ultima, un
   * cliente con el reloj desfasado podria mover hacia atras la fecha en que el
   * usuario leyo su aviso.
   */
  it('conserva la primera lectura y no la ultima', () => {
    const n = persistida({ estado: 'NO_LEIDA', leidaAt: null });
    n.marcarLeida(7, FECHA);
    n.marcarLeida(7, OTRO_MOMENTO);
    expect(n.leidaAt).toEqual(FECHA);
  });
});

// ─── Forma de salida ─────────────────────────────────────────────────────────

describe('forma del aviso', () => {
  const aviso = (): Notificacion =>
    persistida({
      id: 9,
      tipo: 'PROPUESTA_ADJUDICADA',
      titulo: 'Ganaste la propuesta',
      mensaje: 'La propuesta fue adjudicada a tu nombre.',
      recursoTipo: 'PROPUESTA',
      recursoId: 33,
      estado: 'LEIDA',
      leidaAt: FECHA,
    });

  it('la vista no lleva el identificador de usuario', () => {
    // Quien lee sus avisos ya sabe quien es; repetirlo solo daria algo que
    // correlacionar a quien capture la respuesta.
    expect(aviso().vista()).not.toHaveProperty('idUsuario');
  });

  it('la vista expone las fechas en ISO', () => {
    const v = aviso().vista();
    expect(v['fecha']).toBe('2026-10-02T15:04:05.000Z');
    expect(v['leidaAt']).toBe('2026-10-02T15:04:05.000Z');
  });

  it('un aviso sin leer expone leidaAt en null, no undefined', () => {
    // `undefined` desapareceria al serializar, y el cliente no podria distinguir
    // "sin leer" de "este campo no vino".
    expect(persistida({ estado: 'NO_LEIDA', leidaAt: null }).vista()['leidaAt']).toBeNull();
  });

  it('la fila va en el vocabulario de la base', () => {
    expect(aviso().aFila()).toMatchObject({
      id_usuario: 7,
      recurso_tipo: 'PROPUESTA',
      recurso_id: 33,
      estado: 'LEIDA',
      leida_at: FECHA,
    });
  });

  it('la fila no lleva el identificador, que lo pone la base', () => {
    expect(aviso().aFila()).not.toHaveProperty('id');
  });
});

// ─── Paginacion ──────────────────────────────────────────────────────────────

describe('normalizacion de la paginacion', () => {
  it('sin entrada, primera pagina y tamano de veinte', () => {
    expect(normalizarPaginacion({})).toEqual({ pagina: 1, tamano: 20 });
  });

  it('acota el tamano para que nadie pida la bandeja entera', () => {
    expect(normalizarPaginacion({ tamano: 10_000 }).tamano).toBe(TAMANO_PAGINA_MAXIMO);
  });

  it('sube desde cero y baja de las fracciones', () => {
    expect(normalizarPaginacion({ pagina: 0, tamano: 0 })).toEqual({ pagina: 1, tamano: 1 });
    expect(normalizarPaginacion({ pagina: 2.9, tamano: 10.9 })).toEqual({
      pagina: 2,
      tamano: 10,
    });
    expect(normalizarPaginacion({ pagina: -4, tamano: -4 })).toEqual({ pagina: 1, tamano: 1 });
  });
});

// ─── Exigir que exista ───────────────────────────────────────────────────────

describe('exigirNotificacion', () => {
  it('devuelve el aviso cuando existe', async () => {
    const repo = new NotificacionesFalsas();
    const aviso = persistida({ id: 77 });
    repo.sembrar(aviso);
    expect(await exigirNotificacion(repo, 77)).toBe(aviso);
  });

  /**
   * Vive en el dominio para que un null no llegue a un caso de uso como 500: "no
   * existe" es un 404, y cada quien no deberia tener que acordarse.
   */
  it('responde 404 cuando no existe', async () => {
    const repo = new NotificacionesFalsas();
    await expect(exigirNotificacion(repo, 404)).rejects.toMatchObject({ httpStatus: 404 });
  });
});

// ─── Crear a partir de eventos ───────────────────────────────────────────────

describe('crear avisos a partir de eventos', () => {
  it('crea el aviso cuando el destinatario esta replicado', async () => {
    const notificaciones = new NotificacionesFalsas();
    const caso = new CreateFromEventUseCase(notificaciones, new UsuariosFalsos([7]));

    expect(await caso.crear(datos())).toBe(true);
    expect(notificaciones.guardadas).toHaveLength(1);
    expect(notificaciones.guardadas[0]?.idUsuario).toBe(7);
  });

  /**
   * Que el destinatario no este replicado NO es un error: puede ser una cuenta
   * anterior al servicio, o un evento que llego antes que el alta. Lanzar
   * mandaria a la cola de fallidos algo que no tiene arreglo por reintento.
   */
  it('descarta en silencio cuando no hay a quien avisar', async () => {
    const notificaciones = new NotificacionesFalsas();
    const caso = new CreateFromEventUseCase(notificaciones, new UsuariosFalsos([]));

    expect(await caso.crear(datos())).toBe(false);
    expect(notificaciones.guardadas).toHaveLength(0);
  });

  it('no guarda un aviso que el dominio rechazo', async () => {
    const notificaciones = new NotificacionesFalsas();
    const caso = new CreateFromEventUseCase(notificaciones, new UsuariosFalsos([7]));

    await expect(caso.crear(datos({ mensaje: 'Llama al 1234567' }))).rejects.toThrow(AppError);
    expect(notificaciones.guardadas).toHaveLength(0);
  });

  it('replica el alta del usuario y lo hace avisable', async () => {
    const usuarios = new UsuariosFalsos();
    const caso = new CreateFromEventUseCase(new NotificacionesFalsas(), usuarios);

    await caso.registrarUsuario({
      idUsuario: 7,
      nombre: 'Ana Ruiz',
      estado: 'ACTIVO',
      syncedAt: FECHA,
    });

    expect(usuarios.guardados).toHaveLength(1);
    expect(await usuarios.existe(7)).toBe(true);
  });

  it('propaga el cambio de estado y la especialidad', async () => {
    const usuarios = new UsuariosFalsos([7]);
    const caso = new CreateFromEventUseCase(new NotificacionesFalsas(), usuarios);

    await caso.cambiarEstadoUsuario({ idUsuario: 7, estado: 'SUSPENDIDO', syncedAt: FECHA });
    await caso.registrarEspecialidad({
      idUsuario: 7,
      especialidad: 'Fontaneria',
      syncedAt: FECHA,
    });

    expect(usuarios.estados[0]?.estado).toBe('SUSPENDIDO');
    expect(usuarios.especialidades[0]?.especialidad).toBe('Fontaneria');
  });

  it('los tres estados de cuenta son los del SRS y ninguno mas', () => {
    // La columna es un ENUM: un estado de mas no lo grabaria el motor, y el aviso
    // se perderia sin error visible.
    expect([...ESTADOS_CUENTA_REF]).toEqual(['ACTIVO', 'SUSPENDIDO', 'INACTIVO']);
  });
});

// ─── La bandeja ──────────────────────────────────────────────────────────────

describe('bandeja del usuario', () => {
  const bandeja = (): { repo: NotificacionesFalsas; caso: ManageInboxUseCase } => {
    const repo = new NotificacionesFalsas();
    return { repo, caso: new ManageInboxUseCase(repo, new RelojFijo()) };
  };

  it('lista y acompana el numero de no leidas', async () => {
    const { repo, caso } = bandeja();
    repo.sembrar(persistida({ id: 1 }), persistida({ id: 2, titulo: 'Segundo aviso' }));

    const salida = await caso.listar({ idUsuario: 7 });

    expect(salida['total']).toBe(2);
    expect(salida['noLeidas']).toBe(2);
    expect((salida['elementos'] as unknown[]).length).toBe(2);
  });

  /**
   * El filtro por usuario es obligatorio en el puerto, no una comprobacion
   * posterior. Por eso una bandeja ajena no aparece ni por error de consulta.
   */
  it('nunca lista avisos de otro usuario', async () => {
    const { repo, caso } = bandeja();
    repo.sembrar(
      persistida({ id: 1, idUsuario: 7 }),
      persistida({ id: 2, idUsuario: 8, titulo: 'Aviso ajeno' })
    );

    const salida = await caso.listar({ idUsuario: 7 });

    expect(salida['total']).toBe(1);
    expect(salida['noLeidas']).toBe(1);
  });

  it('filtra por estado cuando se le pide', async () => {
    const { repo, caso } = bandeja();
    const leida = persistida({ id: 1 });
    repo.sembrar(leida, persistida({ id: 2, titulo: 'Otro aviso' }));
    leida.marcarLeida(7, FECHA);

    expect((await caso.listar({ idUsuario: 7, estado: 'LEIDA' }))['total']).toBe(1);
    expect((await caso.listar({ idUsuario: 7, estado: 'NO_LEIDA' }))['total']).toBe(1);
  });

  it('normaliza la paginacion que le llega del borde', async () => {
    const { caso } = bandeja();
    const salida = await caso.listar({ idUsuario: 7, pagina: 0, tamano: 999 });
    expect(salida['pagina']).toBe(1);
    expect(salida['tamano']).toBe(TAMANO_PAGINA_MAXIMO);
  });

  it('marcar una como leida escribe una sola vez', async () => {
    const { repo, caso } = bandeja();
    const aviso = persistida({ id: 1 });
    repo.sembrar(aviso);

    await caso.marcarLeida({ idNotificacion: 1, idUsuario: 7 });

    expect(repo.actualizadas).toHaveLength(1);
    expect(aviso.leidaAt).toEqual(FECHA);
  });

  it('volver a marcar la misma no vuelve a escribir', async () => {
    const { repo, caso } = bandeja();
    repo.sembrar(persistida({ id: 1 }));

    await caso.marcarLeida({ idNotificacion: 1, idUsuario: 7 });
    await caso.marcarLeida({ idNotificacion: 1, idUsuario: 7 });

    expect(repo.actualizadas).toHaveLength(1);
  });

  it('marcar el aviso de otro responde 404 y no escribe nada', async () => {
    const { repo, caso } = bandeja();
    repo.sembrar(persistida({ id: 1, idUsuario: 7 }));

    await expect(caso.marcarLeida({ idNotificacion: 1, idUsuario: 99 })).rejects.toMatchObject({
      httpStatus: 404,
    });
    expect(repo.actualizadas).toHaveLength(0);
  });

  it('marcar un aviso inexistente responde 404', async () => {
    const { caso } = bandeja();
    await expect(caso.marcarLeida({ idNotificacion: 1234, idUsuario: 7 })).rejects.toThrow(
      AppError
    );
  });

  it('marcar toda la bandeja devuelve cuantas cambiaron', async () => {
    const { repo, caso } = bandeja();
    repo.sembrar(persistida({ id: 1 }), persistida({ id: 2, titulo: 'Segundo aviso' }));

    expect(await caso.marcarTodasLeidas(7)).toEqual({ marcadas: 2 });
    expect(await caso.contarNoLeidas(7)).toEqual({ noLeidas: 0 });
    // La segunda pasada ya no tiene nada que cambiar.
    expect(await caso.marcarTodasLeidas(7)).toEqual({ marcadas: 0 });
  });

  it('marcar toda la bandeja no toca los avisos de otro', async () => {
    const { repo, caso } = bandeja();
    const ajena = persistida({ id: 2, idUsuario: 8, titulo: 'Aviso ajeno' });
    repo.sembrar(persistida({ id: 1 }), ajena);

    expect(await caso.marcarTodasLeidas(7)).toEqual({ marcadas: 1 });
    expect(ajena.estaLeida).toBe(false);
  });
});
