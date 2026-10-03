import { AppError } from '@punto-amigo/shared';

/**
 * Dominio de oferentes: el perfil de prestador y su validacion administrativa.
 *
 * SRS: RF22 a RF32 (SRS-PRV-01 a SRS-PRV-10).
 *
 * Todo el dominio cabe en un archivo por el mismo motivo que en
 * catalog-service: una entidad, cuatro estados, una tabla de transiciones y un
 * punado de invariantes. Partirlo en siete archivos anadiria navegacion sin
 * anadir claridad.
 */

export const ESTADOS_PRESTADOR = ['PENDING_VALIDATION', 'ACTIVE', 'SUSPENDED', 'INACTIVE'] as const;
export type EstadoPrestador = (typeof ESTADOS_PRESTADOR)[number];

/**
 * Modelo de estados, explicito y en un solo sitio (SRS RF29, RF30).
 *
 * Es una tabla y no una cadena de `if` porque RF30 exige rechazar lo que no
 * este contemplado: con una tabla, lo no declarado se rechaza por defecto, y
 * anadir un camino obliga a escribirlo aqui, donde se ve junto a los demas.
 *
 * Dos ausencias son deliberadas, no olvidos:
 *
 * - PENDING_VALIDATION -> SUSPENDED no existe. Un perfil sin validar ya es
 *   invisible (RF25), asi que suspenderlo no cambia nada, y si luego alguien lo
 *   reactivara pasaria a ACTIVE sin que ningun administrador lo hubiera
 *   revisado: justo el agujero que RF25 existe para cerrar.
 * - INACTIVE -> ACTIVE no existe. Un perfil rechazado o retirado vuelve a la
 *   cola de validacion (PENDING_VALIDATION) y se revisa otra vez; reactivarlo
 *   de golpe saltaria la revision por la puerta de atras.
 */
export const TRANSICIONES: Readonly<Record<EstadoPrestador, readonly EstadoPrestador[]>> = {
  PENDING_VALIDATION: ['ACTIVE', 'INACTIVE'],
  ACTIVE: ['SUSPENDED', 'INACTIVE'],
  SUSPENDED: ['ACTIVE', 'INACTIVE'],
  INACTIVE: ['PENDING_VALIDATION'],
};

/** Motivo del cambio de estado. Va a la bitacora, nunca al cliente. */
export const MOTIVOS_SISTEMA = {
  cuentaSuspendida: 'CUENTA_SUSPENDIDA',
} as const;

export interface PrestadorProps {
  id: number;
  idUsuario: number;
  nombre: string;
  especialidad: string;
  experiencia: string | null;
  telefono: string | null;
  correo: string | null;
  disponibilidad: string | null;
  estado: EstadoPrestador;
  deletedAt: Date | null;
}

/** Datos que el oferente envia al crear o editar su perfil (SRS RF22). */
export interface DatosPerfil {
  nombre: string;
  especialidad: string;
  experiencia?: string | null;
  telefono?: string | null;
  correo?: string | null;
  disponibilidad?: string | null;
}

/**
 * Forma minima del correo.
 *
 * No pretende decidir si la direccion existe —eso solo lo demuestra enviar un
 * mensaje—, solo descartar lo que no puede ser una direccion. La comprobacion
 * vive en el dominio y no solo en el esquema Zod del borde porque el consumidor
 * de eventos tambien escribe perfiles y no pasa por ese esquema.
 */
const FORMA_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u;

/** Solo digitos, espacios y los separadores habituales de un telefono. */
const FORMA_TELEFONO = /^[+\d][\d\s()-]{5,19}$/u;

/**
 * Raiz del agregado: el perfil de prestador.
 *
 * No conoce la base de datos ni Express. Las reglas que decide aqui son las que
 * ninguna capa de arriba puede cubrir: el borde HTTP sabe que quien llama tiene
 * el rol OFERENTE, pero no sabe si es el dueno de ESTE perfil.
 */
export class Prestador {
  private constructor(private props: PrestadorProps) {}

  static rehydrate(props: PrestadorProps): Prestador {
    return new Prestador(props);
  }

  /**
   * Crea el perfil de un oferente.
   *
   * Nace en PENDING_VALIDATION siempre (SRS RF24): el estado NO se recibe como
   * parametro, de modo que ninguna peticion pueda darse por validada a si
   * misma. El identificador lo asigna la base, asi que aqui es 0 hasta que el
   * repositorio lo sustituye.
   *
   * La unicidad por usuario (RF23) no se comprueba aqui: un agregado no puede
   * saber nada de los demas. La garantiza el UNIQUE de `prestador.id_usuario`,
   * y el repositorio traduce el choque a un conflicto.
   */
  static crear(input: { idUsuario: number } & DatosPerfil): Prestador {
    const campos = normalizarDatos(input, { exigirObligatorios: true });

    return new Prestador({
      id: 0,
      idUsuario: input.idUsuario,
      nombre: campos.nombre,
      especialidad: campos.especialidad,
      experiencia: campos.experiencia ?? null,
      telefono: campos.telefono ?? null,
      correo: campos.correo ?? null,
      disponibilidad: campos.disponibilidad ?? null,
      estado: 'PENDING_VALIDATION',
      deletedAt: null,
    });
  }

  get id(): number {
    return this.props.id;
  }
  get idUsuario(): number {
    return this.props.idUsuario;
  }
  get nombre(): string {
    return this.props.nombre;
  }
  get especialidad(): string {
    return this.props.especialidad;
  }
  get estado(): EstadoPrestador {
    return this.props.estado;
  }

  /** Validado = revisado por un administrador y en servicio (SRS RF26). */
  get estaValidado(): boolean {
    return this.props.estado === 'ACTIVE';
  }

  /**
   * Visibilidad publica (SRS RF25).
   *
   * Solo un perfil validado y no borrado aparece ante quien no ha iniciado
   * sesion. El borrado logico cuenta como invisible aunque el estado dijera
   * ACTIVE: son dos columnas distintas y la consulta publica no debe depender
   * de que esten siempre de acuerdo.
   */
  get esVisiblePublicamente(): boolean {
    return this.props.estado === 'ACTIVE' && this.props.deletedAt === null;
  }

  /**
   * Exige ser el dueno antes de dejar modificar (SRS RF28).
   *
   * El guardia de rol del borde dice que quien llama es OFERENTE; no dice que
   * sea el dueno de ESTE perfil. Sin esto, cualquier oferente editaria el
   * perfil de otro.
   *
   * Responde 404 y no 403: confirmar que el perfil existe permitiria enumerar
   * los identificadores ajenos aunque no se pudieran modificar.
   */
  private exigirPropiedad(idUsuario: number): void {
    if (this.props.idUsuario !== idUsuario) {
      throw AppError.notFound('El perfil de prestador no existe.');
    }
  }

  /**
   * Edicion por su dueno (SRS RF28).
   *
   * Editar NO devuelve el perfil a la cola de validacion. Un oferente que
   * corrige su telefono no deberia desaparecer del catalogo mientras un
   * administrador vuelve a mirarlo; la revalidacion es una decision
   * administrativa y se pide por su propio camino (PATCH .../status).
   */
  editar(idUsuario: number, cambios: Partial<DatosPerfil>): void {
    this.exigirPropiedad(idUsuario);

    const campos = normalizarDatos(cambios, { exigirObligatorios: false });

    // Solo se escribe lo que venia en la peticion: un campo ausente conserva su
    // valor, y uno enviado como null lo borra de forma explicita.
    if (campos.nombre !== undefined) this.props.nombre = campos.nombre;
    if (campos.especialidad !== undefined) this.props.especialidad = campos.especialidad;
    if ('experiencia' in cambios) this.props.experiencia = campos.experiencia ?? null;
    if ('telefono' in cambios) this.props.telefono = campos.telefono ?? null;
    if ('correo' in cambios) this.props.correo = campos.correo ?? null;
    if ('disponibilidad' in cambios) this.props.disponibilidad = campos.disponibilidad ?? null;
  }

  /**
   * Cambia de estado respetando el modelo (SRS RF29, RF30).
   *
   * Unico camino para tocar `estado`: no hay setter ni metodos sueltos por
   * estado, para que ninguna transicion pueda colarse sin pasar por la tabla.
   */
  private transicionar(destino: EstadoPrestador): void {
    const permitidos = TRANSICIONES[this.props.estado];

    if (!permitidos.includes(destino)) {
      throw AppError.invalidTransition(
        `Un perfil en estado ${this.props.estado} no puede pasar a ${destino}.`,
        permitidos,
        { idPrestador: this.props.id, estadoActual: this.props.estado }
      );
    }

    this.props.estado = destino;
  }

  /** Validacion administrativa: el perfil entra en servicio (SRS RF26). */
  validar(): EstadoPrestador {
    const anterior = this.props.estado;
    this.transicionar('ACTIVE');
    return anterior;
  }

  /**
   * Rechazo administrativo (SRS RF27).
   *
   * El motivo es obligatorio y lo exige el dominio, no solo el esquema del
   * borde: la bitacora de RF27 sin motivo no sirve para nada, y este metodo
   * tambien se invoca desde pruebas y desde casos de uso que no pasan por HTTP.
   */
  rechazar(motivo: string): EstadoPrestador {
    const limpio = motivo.trim();
    if (limpio.length < 10 || limpio.length > 500) {
      throw AppError.validation('El motivo del rechazo no es valido.', [
        { field: 'motivo', message: 'Explique el rechazo en entre 10 y 500 caracteres.' },
      ]);
    }

    const anterior = this.props.estado;
    this.transicionar('INACTIVE');
    return anterior;
  }

  /** Cambio de estado pedido por un administrador (SRS RF29, RF30). */
  cambiarEstado(destino: EstadoPrestador): EstadoPrestador {
    const anterior = this.props.estado;
    this.transicionar(destino);
    return anterior;
  }

  /**
   * Suspension arrastrada por la suspension de la cuenta (SRS RF32).
   *
   * Devuelve si hubo cambio en lugar de lanzar cuando no lo hay, y esto NO es
   * tragarse un error: que la cuenta de un perfil ya suspendido, ya retirado o
   * aun sin validar se suspenda es un caso normal del flujo, no un fallo. El
   * consumidor necesita distinguirlo para publicar ProviderStatusChanged solo
   * cuando el estado cambio de verdad; un evento por cada entrega repetida
   * llenaria la bandeja del oferente de avisos identicos.
   *
   * Un perfil en PENDING_VALIDATION se deja como esta a proposito: ya es
   * invisible, y llevarlo a SUSPENDED abriria el camino
   * SUSPENDED -> ACTIVE sin que nadie lo hubiera revisado.
   */
  suspenderPorCuentaSuspendida(): boolean {
    if (!TRANSICIONES[this.props.estado].includes('SUSPENDED')) return false;

    this.props.estado = 'SUSPENDED';
    return true;
  }

  /**
   * Vista publica (SRS RF31).
   *
   * NUNCA incluye telefono ni correo, ni siquiera con el perfil validado.
   * Estar validado significa que un administrador reviso el perfil, no que
   * cualquiera pueda llamar por telefono a esa persona. El contacto se revela
   * cuando existe un ACUERDO -solicitud aceptada o propuesta adjudicada- y de
   * eso es dueno request-service (SRS RF31, RF156, RNF84).
   *
   * Exponerlo aqui convertiria el catalogo en un directorio de telefonos que
   * se extrae con un bucle, y dejaria sin efecto la medida que desincentiva
   * saltarse la plataforma (riesgo N-01, desintermediacion).
   *
   * La regla vive aqui y no en el controlador porque es una regla sobre el
   * dato, no sobre la ruta: cualquier camino nuevo que sirva perfiles la
   * hereda sin tener que recordarla.
   *
   * No incluye `idUsuario`: correlacionar el perfil con la cuenta es asunto
   * interno y filtrarlo permitiria cruzar datos entre modulos.
   */
  vistaPublica(): Record<string, unknown> {
    return {
      id: this.props.id,
      nombre: this.props.nombre,
      especialidad: this.props.especialidad,
      experiencia: this.props.experiencia,
      disponibilidad: this.props.disponibilidad,
      estado: this.props.estado,
      validado: this.estaValidado,
    };
  }

  /**
   * Vista completa para su dueno.
   *
   * La comprobacion de propiedad vive en el dominio tambien para LEER: un
   * oferente que pide el perfil de otro por su identificador recibe un 404
   * igual que al intentar editarlo, y no una copia con telefono y correo.
   */
  vistaParaDueno(idUsuario: number): Record<string, unknown> {
    this.exigirPropiedad(idUsuario);
    return this.vistaPrivada();
  }

  /** Vista completa: solo para el dueno y para un administrador. */
  vistaPrivada(): Record<string, unknown> {
    return {
      id: this.props.id,
      idUsuario: this.props.idUsuario,
      nombre: this.props.nombre,
      especialidad: this.props.especialidad,
      experiencia: this.props.experiencia,
      telefono: this.props.telefono,
      correo: this.props.correo,
      disponibilidad: this.props.disponibilidad,
      estado: this.props.estado,
      validado: this.estaValidado,
    };
  }
}

interface CamposNormalizados {
  nombre?: string;
  especialidad?: string;
  experiencia?: string | null;
  telefono?: string | null;
  correo?: string | null;
  disponibilidad?: string | null;
}

/** Al crear, el nombre y la especialidad estan garantizados: faltar lanza. */
interface CamposCompletos extends CamposNormalizados {
  nombre: string;
  especialidad: string;
}

/**
 * Recorta y valida los campos del perfil, acumulando TODOS los errores.
 *
 * Se acumulan en lugar de salir al primero para que el formulario pueda marcar
 * de una vez todo lo que esta mal; devolverlos de a uno obliga al usuario a
 * reenviar tantas veces como campos haya equivocado.
 *
 * Los topes coinciden con los de la migracion de `pa_provider`. Si no
 * coincidieran, el fallo llegaria como un error 500 del motor en lugar de un
 * 422 que diga que campo arreglar.
 *
 * Las sobrecargas estan para que `crear` reciba el nombre y la especialidad ya
 * como `string`: sin ellas haria falta un cast, que es pedirle al compilador
 * que confie en una invariante que no puede ver.
 */
function normalizarDatos(
  entrada: Partial<DatosPerfil>,
  opciones: { exigirObligatorios: true }
): CamposCompletos;
function normalizarDatos(
  entrada: Partial<DatosPerfil>,
  opciones: { exigirObligatorios: false }
): CamposNormalizados;
function normalizarDatos(
  entrada: Partial<DatosPerfil>,
  opciones: { exigirObligatorios: boolean }
): CamposNormalizados {
  const errores: { field: string; message: string }[] = [];
  const salida: CamposNormalizados = {};

  if (entrada.nombre !== undefined) {
    const nombre = entrada.nombre.trim();
    if (nombre.length < 2 || nombre.length > 100) {
      errores.push({ field: 'nombre', message: 'Debe tener entre 2 y 100 caracteres.' });
    } else {
      salida.nombre = nombre;
    }
  } else if (opciones.exigirObligatorios) {
    errores.push({ field: 'nombre', message: 'El nombre es obligatorio.' });
  }

  if (entrada.especialidad !== undefined) {
    const especialidad = entrada.especialidad.trim();
    if (especialidad.length < 3 || especialidad.length > 150) {
      errores.push({ field: 'especialidad', message: 'Debe tener entre 3 y 150 caracteres.' });
    } else {
      salida.especialidad = especialidad;
    }
  } else if (opciones.exigirObligatorios) {
    errores.push({ field: 'especialidad', message: 'La especialidad es obligatoria.' });
  }

  const experiencia = recortarOpcional(entrada.experiencia);
  if (experiencia !== undefined) {
    if (experiencia !== null && experiencia.length > 500) {
      errores.push({ field: 'experiencia', message: 'Maximo 500 caracteres.' });
    } else {
      salida.experiencia = experiencia;
    }
  }

  const telefono = recortarOpcional(entrada.telefono);
  if (telefono !== undefined) {
    if (telefono !== null && !FORMA_TELEFONO.test(telefono)) {
      errores.push({ field: 'telefono', message: 'El telefono no tiene un formato valido.' });
    } else {
      salida.telefono = telefono;
    }
  }

  const correo = recortarOpcional(entrada.correo);
  if (correo !== undefined) {
    const minuscula = correo === null ? null : correo.toLowerCase();
    if (minuscula !== null && (minuscula.length > 150 || !FORMA_CORREO.test(minuscula))) {
      errores.push({ field: 'correo', message: 'El correo no tiene un formato valido.' });
    } else {
      salida.correo = minuscula;
    }
  }

  const disponibilidad = recortarOpcional(entrada.disponibilidad);
  if (disponibilidad !== undefined) {
    if (disponibilidad !== null && disponibilidad.length > 255) {
      errores.push({ field: 'disponibilidad', message: 'Maximo 255 caracteres.' });
    } else {
      salida.disponibilidad = disponibilidad;
    }
  }

  if (errores.length > 0) {
    throw AppError.validation('Los datos del perfil de prestador no son validos.', errores);
  }

  return salida;
}

/**
 * Normaliza un campo opcional a tres resultados distinguibles.
 *
 * `undefined` = no venia en la peticion y no se toca. `null` = se envio vacio y
 * se borra. Una cadena = valor nuevo. Confundir los tres primeros es como un
 * PATCH acaba borrando campos que nadie pidio borrar.
 */
function recortarOpcional(valor: string | null | undefined): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  const limpio = valor.trim();
  return limpio.length === 0 ? null : limpio;
}

// ─── Puertos de salida ──────────────────────────────────────────────────────
//
// Las interfaces viven junto al dominio que las necesita y las
// implementaciones en infrastructure/. Asi la dependencia apunta hacia
// adentro: cambiar MySQL por otro motor no toca una linea de dominio.
//
// El reloj y el publicador de eventos NO se declaran aqui: los aporta
// @punto-amigo/service-kit (IClock, IEventPublisher) y duplicar su interfaz
// solo crearia dos contratos que divergen.

/** Pagina de resultados. El tope lo impone el dominio, no el llamador. */
export interface Pagina<T> {
  elementos: readonly T[];
  total: number;
  pagina: number;
  tamano: number;
}

/** Tope de pagina: sin el, una peticion puede pedir el directorio completo. */
export const TAMANO_PAGINA_MAXIMO = 50;

export function normalizarPaginacion(entrada: {
  pagina?: number | undefined;
  tamano?: number | undefined;
}): { pagina: number; tamano: number } {
  return {
    pagina: Math.max(1, Math.floor(entrada.pagina ?? 1)),
    tamano: Math.min(TAMANO_PAGINA_MAXIMO, Math.max(1, Math.floor(entrada.tamano ?? 20))),
  };
}

export interface IPrestadorRepository {
  findById(id: number): Promise<Prestador | null>;
  findByUsuario(idUsuario: number): Promise<Prestador | null>;
  /** Persiste y devuelve el perfil con el identificador ya asignado. */
  save(prestador: Prestador, creadoPor: number): Promise<Prestador>;
  update(prestador: Prestador): Promise<void>;
  /**
   * Cola de revision administrativa (SRS RF26). Los mas antiguos primero: una
   * cola que ordenara por lo mas reciente dejaria al final a quien lleva mas
   * tiempo esperando.
   */
  listarPendientes(pagina: number, tamano: number): Promise<Pagina<Prestador>>;
  /** Directorio publico: solo validados y no borrados (SRS RF25). */
  listarVisibles(
    filtros: { especialidad?: string | undefined },
    pagina: number,
    tamano: number
  ): Promise<Pagina<Prestador>>;
}

/** Entrada de la bitacora de validaciones: append-only (SRS RF26, RF27). */
export interface AsientoValidacion {
  idPrestador: number;
  estadoAnterior: EstadoPrestador | null;
  estadoNuevo: EstadoPrestador;
  /** Administrador responsable, o el propio usuario cuando lo arrastra un evento. */
  validadoPor: number;
  motivo: string | null;
  registradoAt: Date;
}

export interface IValidationLogRepository {
  registrar(asiento: AsientoValidacion): Promise<void>;
}

/**
 * Carga un perfil o falla con 404.
 *
 * Vive aqui y no repetida en cada caso de uso porque "un perfil que no existe
 * es un 404, no un null que cada quien interprete" es una regla del dominio.
 * Devolver null obligaria a cuatro casos de uso a recordar comprobarlo, y al
 * primero que lo olvidara el fallo saldria como un error 500.
 */
export async function exigirPerfil(
  prestadores: IPrestadorRepository,
  idPrestador: number
): Promise<Prestador> {
  const prestador = await prestadores.findById(idPrestador);
  if (prestador === null) {
    throw AppError.notFound('El perfil de prestador no existe.');
  }
  return prestador;
}
