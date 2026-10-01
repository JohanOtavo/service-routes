import { AppError } from '@punto-amigo/shared';

/**
 * Dominio de notificaciones: el aviso que un usuario ve en su bandeja.
 *
 * SRS: RF86 a RF96 y RF168 a RF173 (SRS-NOT-01 a SRS-NOT-10).
 *
 * Todo el dominio cabe en un archivo por el mismo motivo que en
 * provider-service: una entidad, dos estados y un punado de invariantes.
 * Partirlo en siete archivos anadiria navegacion sin anadir claridad.
 *
 * Este servicio NO decide cuando ocurre algo: lo decide quien publica el
 * evento. Aqui solo se decide a quien se avisa, con que texto y quien puede
 * leerlo despues.
 */

export const ESTADOS_NOTIFICACION = ['NO_LEIDA', 'LEIDA'] as const;
export type EstadoNotificacion = (typeof ESTADOS_NOTIFICACION)[number];

/**
 * Clases de notificacion que este servicio sabe producir HOY.
 *
 * La lista es corta a proposito: solo estan los tipos cuyo evento emisor existe
 * y cuyo payload se puede comprobar leyendo el codigo que lo publica. Los demas
 * avisos del SRS —solicitud recibida (RF86), aceptada o rechazada (RF87),
 * finalizada (RF88), propuesta recibida, adjudicada o descartada (RF168 a
 * RF170), necesidad por vencer (RF171) y necesidad afin (RF172)— se anadiran
 * junto a su emisor. Declararlos antes solo crearia nombres que nadie escribe y
 * que la preferencia por tipo (RF173) no podria silenciar de verdad.
 *
 * El tipo viaja a la columna `notificacion.tipo`, que es la clave con la que el
 * usuario silencia una clase entera, asi que renombrar uno rompe las
 * preferencias ya guardadas.
 */
export const TIPOS_NOTIFICACION = [
  // Identidad y perfil
  'BIENVENIDA',
  'PERFIL_VALIDADO',
  'PERFIL_ESTADO_CAMBIADO',
  // Demanda (SRS RF168 a RF173)
  'NECESIDAD_AFIN',
  'PROPUESTA_RECIBIDA',
  'PROPUESTA_ADJUDICADA',
  'PROPUESTA_DESCARTADA',
  // Contratacion
  'SOLICITUD_RECIBIDA',
  'SOLICITUD_ACEPTADA',
  'SOLICITUD_RECHAZADA',
  'SOLICITUD_COMPLETADA',
  'SOLICITUD_CANCELADA',
  // Reputacion
  'CALIFICACION_RECIBIDA',
  'UMBRAL_CANCELACION',
] as const;
export type TipoNotificacion = (typeof TIPOS_NOTIFICACION)[number];

/**
 * Recurso al que lleva el aviso, con el vocabulario que fija la migracion de
 * `pa_notification`. Es lo que permite al cliente abrir la pantalla correcta sin
 * tener que interpretar el texto del mensaje.
 */
export const RECURSOS_NOTIFICACION = ['NECESIDAD', 'PROPUESTA', 'SOLICITUD', 'PRESTADOR'] as const;
export type RecursoNotificacion = (typeof RECURSOS_NOTIFICACION)[number];

/** Estado de la cuenta en la replica local; lo fija auth-service. */
export const ESTADOS_CUENTA_REF = ['ACTIVO', 'SUSPENDIDO', 'INACTIVO'] as const;
export type EstadoCuentaRef = (typeof ESTADOS_CUENTA_REF)[number];

/**
 * Topes de texto.
 *
 * `titulo` coincide con el VARCHAR(150) de la migracion: si no coincidiera, el
 * fallo llegaria como un error 500 del motor en lugar de decir que arreglar.
 * `mensaje` es TEXT y aceptaria 65535 caracteres, pero una notificacion es un
 * aviso breve: un texto mas largo significa que alguien volco un payload entero
 * en el cuerpo, y eso es justo lo que no debe acabar en la bandeja.
 */
const LARGO_TITULO = 150;
const LARGO_MENSAJE = 1000;

/**
 * Formas que delatan datos de contacto dentro del cuerpo.
 *
 * El texto lo compone este servicio a partir de payloads de eventos, y un
 * payload puede traer un telefono o un correo sin que se note al leer la
 * plantilla. "Pedro acepto tu solicitud" es correcto; el mismo mensaje con su
 * telefono convierte la bandeja en un directorio y deshace la medida contra la
 * desintermediacion (SRS RF31, RF156, RNF84, riesgo N-01).
 *
 * El telefono exige o prefijo internacional o siete digitos SEGUIDOS: contar
 * digitos sueltos marcaria como telefono una fecha como 2026-10-01, y entonces
 * el aviso de una necesidad por vencer (RF171) no se podria escribir.
 */
const FORMA_CORREO = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/u;
const FORMA_TELEFONO = /(?:\+\d[\d\s().-]{6,})|\d{7,}/u;

export interface NotificacionProps {
  id: number;
  idUsuario: number;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  recursoTipo: RecursoNotificacion | null;
  recursoId: number | null;
  estado: EstadoNotificacion;
  leidaAt: Date | null;
  fecha: Date;
}

/** Lo que un manejador de eventos aporta para crear el aviso. */
export interface DatosNotificacion {
  idUsuario: number;
  tipo: TipoNotificacion;
  titulo: string;
  mensaje: string;
  recursoTipo?: RecursoNotificacion | null;
  recursoId?: number | null;
  fecha: Date;
}

/**
 * Raiz del agregado: la notificacion.
 *
 * No conoce la base de datos ni Express. La regla que decide aqui es la que
 * ninguna capa de arriba puede cubrir: el borde HTTP sabe quien llama, pero no
 * si ESTA notificacion es suya.
 */
export class Notificacion {
  private constructor(private props: NotificacionProps) {}

  static rehydrate(props: NotificacionProps): Notificacion {
    return new Notificacion(props);
  }

  /**
   * Crea un aviso para un usuario (SRS RF91).
   *
   * Nace NO_LEIDA siempre: el estado NO se recibe como parametro, de modo que
   * ningun manejador pueda insertar un aviso ya leido y hacerlo invisible para
   * su destinatario. El identificador lo asigna la base, asi que aqui es 0 hasta
   * que el repositorio lo sustituye.
   *
   * El destinatario llega resuelto por el caso de uso a partir del payload del
   * evento; esta clase no lo deduce para no tener que conocer los eventos.
   */
  static crear(datos: DatosNotificacion): Notificacion {
    const titulo = datos.titulo.trim();
    const mensaje = datos.mensaje.trim();
    const errores: { field: string; message: string }[] = [];

    if (titulo.length < 3 || titulo.length > LARGO_TITULO) {
      errores.push({ field: 'titulo', message: `Debe tener entre 3 y ${LARGO_TITULO} caracteres.` });
    }
    if (mensaje.length < 3 || mensaje.length > LARGO_MENSAJE) {
      errores.push({
        field: 'mensaje',
        message: `Debe tener entre 3 y ${LARGO_MENSAJE} caracteres.`,
      });
    }
    if (!Number.isInteger(datos.idUsuario) || datos.idUsuario <= 0) {
      errores.push({ field: 'idUsuario', message: 'El destinatario no es valido.' });
    }
    if (errores.length > 0) {
      throw AppError.validation('Los datos de la notificacion no son validos.', errores);
    }

    exigirCuerpoSinContacto(titulo, mensaje);

    return new Notificacion({
      id: 0,
      idUsuario: datos.idUsuario,
      tipo: datos.tipo,
      titulo,
      mensaje,
      recursoTipo: datos.recursoTipo ?? null,
      recursoId: datos.recursoId ?? null,
      estado: 'NO_LEIDA',
      leidaAt: null,
      fecha: datos.fecha,
    });
  }

  get id(): number {
    return this.props.id;
  }
  get idUsuario(): number {
    return this.props.idUsuario;
  }
  get tipo(): TipoNotificacion {
    return this.props.tipo;
  }
  get estado(): EstadoNotificacion {
    return this.props.estado;
  }
  get leidaAt(): Date | null {
    return this.props.leidaAt;
  }

  get estaLeida(): boolean {
    return this.props.estado === 'LEIDA';
  }

  /**
   * Exige ser el destinatario (SRS RF92, RF93).
   *
   * El guardia de rol del borde dice que quien llama tiene cuenta; no dice que
   * ESTE aviso sea suyo. Sin esto, cualquiera marcaria como leidas las
   * notificaciones de otro y, peor, las leeria.
   *
   * Responde 404 y no 403: un 403 confirmaria que el identificador corresponde a
   * una notificacion real, y con eso se recorre el rango para saber cuantos
   * avisos tiene cada quien y cuando los recibio.
   */
  private exigirDestinatario(idUsuario: number): void {
    if (this.props.idUsuario !== idUsuario) {
      throw AppError.notFound('La notificacion no existe.');
    }
  }

  /**
   * Marca el aviso como leido (SRS RF91, RF92).
   *
   * Devuelve si hubo cambio en lugar de lanzar cuando ya estaba leido: pulsar
   * dos veces, o que la aplicacion reintente, no es un error del usuario. Quien
   * llama lo usa para no escribir en la base ni mover `leida_at`, que debe
   * conservar la PRIMERA lectura y no la ultima.
   */
  marcarLeida(idUsuario: number, ahora: Date): boolean {
    this.exigirDestinatario(idUsuario);

    if (this.props.estado === 'LEIDA') return false;

    this.props.estado = 'LEIDA';
    this.props.leidaAt = ahora;
    return true;
  }

  /**
   * Vista para su destinatario.
   *
   * La comprobacion de propiedad vive en el dominio tambien para LEER: pedir el
   * aviso de otro por su identificador devuelve 404, igual que al marcarlo.
   */
  vistaParaDestinatario(idUsuario: number): Record<string, unknown> {
    this.exigirDestinatario(idUsuario);
    return this.vista();
  }

  /**
   * Forma con la que el aviso sale del servicio.
   *
   * No incluye `idUsuario`: quien lee sus notificaciones ya sabe quien es, y
   * repetirlo solo daria algo que correlacionar a quien capture la respuesta.
   */
  vista(): Record<string, unknown> {
    return {
      id: this.props.id,
      tipo: this.props.tipo,
      titulo: this.props.titulo,
      mensaje: this.props.mensaje,
      recursoTipo: this.props.recursoTipo,
      recursoId: this.props.recursoId,
      estado: this.props.estado,
      leidaAt: this.props.leidaAt === null ? null : this.props.leidaAt.toISOString(),
      fecha: this.props.fecha.toISOString(),
    };
  }

  /** Fila a escribir. Vive aqui para que `props` siga siendo privado. */
  aFila(): Record<string, unknown> {
    return {
      id_usuario: this.props.idUsuario,
      tipo: this.props.tipo,
      titulo: this.props.titulo,
      mensaje: this.props.mensaje,
      recurso_tipo: this.props.recursoTipo,
      recurso_id: this.props.recursoId,
      estado: this.props.estado,
      leida_at: this.props.leidaAt,
      fecha: this.props.fecha,
    };
  }
}

/**
 * Rechaza un cuerpo que lleve datos de contacto.
 *
 * Es una red de seguridad contra el error facil: interpolar en la plantilla un
 * campo del evento que resulta ser un correo o un telefono. Prefiere fallar
 * ruidosamente —el evento acaba en la cola de fallidos y alguien lo ve— a dejar
 * pasar en silencio un dato que ya no se puede recoger de las bandejas donde se
 * escribio.
 *
 * Contrasenas y tokens no se buscan por forma porque no la tienen; no estan en
 * ningun payload de los eventos que este servicio consume, y esa es la unica
 * garantia real (SRS-MSG-06).
 */
function exigirCuerpoSinContacto(titulo: string, mensaje: string): void {
  const cuerpo = `${titulo}\n${mensaje}`;

  if (FORMA_CORREO.test(cuerpo) || FORMA_TELEFONO.test(cuerpo)) {
    throw AppError.validation('El cuerpo de la notificacion no puede incluir datos de contacto.', [
      { field: 'mensaje', message: 'Quite el correo o el telefono del texto.' },
    ]);
  }
}

// ─── Puertos de salida ──────────────────────────────────────────────────────
//
// Las interfaces viven junto al dominio que las necesita y las
// implementaciones en infrastructure/. Asi la dependencia apunta hacia
// adentro: cambiar MySQL por otro motor no toca una linea de dominio.
//
// El reloj NO se declara aqui: lo aporta @punto-amigo/service-kit (IClock) y
// duplicar su interfaz solo crearia dos contratos que divergen. Tampoco hay
// publicador de eventos: `pa_notification` no tiene tabla `outbox_event`
// porque este servicio no publica nada (ver la cabecera de su migracion).

/** Pagina de resultados. El tope lo impone el dominio, no el llamador. */
export interface Pagina<T> {
  elementos: readonly T[];
  total: number;
  pagina: number;
  tamano: number;
}

/** Tope de pagina: sin el, una peticion puede pedir la bandeja entera. */
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

export interface INotificacionRepository {
  findById(id: number): Promise<Notificacion | null>;
  /** Persiste y devuelve el aviso con el identificador ya asignado. */
  save(notificacion: Notificacion): Promise<Notificacion>;
  /** Escribe el estado de lectura de un aviso ya existente. */
  update(notificacion: Notificacion): Promise<void>;
  /**
   * Bandeja de un usuario (SRS RF93). El destinatario NUNCA es opcional: un
   * repositorio que pudiera listar sin filtrar por usuario seria una fuga
   * esperando a que alguien olvide el filtro en una ruta nueva.
   */
  listarDe(
    idUsuario: number,
    filtros: { estado?: EstadoNotificacion | undefined },
    pagina: number,
    tamano: number
  ): Promise<Pagina<Notificacion>>;
  contarNoLeidas(idUsuario: number): Promise<number>;
  /** Marca de una vez toda la bandeja. Devuelve cuantas cambiaron. */
  marcarTodasLeidasDe(idUsuario: number, leidaAt: Date): Promise<number>;
}

/**
 * Replica local del usuario (`usuario_ref`), alimentada por eventos.
 *
 * Existe por dos motivos y ninguno es mostrar datos personales: la clave
 * foranea de `notificacion` exige que el destinatario este aqui, y RF172
 * necesita la especialidad para dirigir el aviso de necesidades afines.
 *
 * NO guarda correo ni telefono aunque las columnas existan en el helper comun:
 * la entrega por correo y por push esta fuera del MVP (nota de alcance de
 * SRS-NOT), asi que serian datos de contacto replicados que este servicio no
 * puede usar para nada. La matriz de propiedad del dato (seccion 3.4 de
 * srs-microservices) tambien dice que de `Usuario` aqui solo vive su
 * identificador.
 */
export interface DatosUsuarioRef {
  idUsuario: number;
  nombre: string;
  estado: EstadoCuentaRef;
  syncedAt: Date;
}

export interface IUsuarioRefRepository {
  /** Si hay a quien avisar. Sin fila, la clave foranea rechazaria el aviso. */
  existe(idUsuario: number): Promise<boolean>;
  /**
   * Alta o refresco de la replica.
   *
   * Es un upsert y no un insert porque el evento puede reentregarse: la segunda
   * entrega no debe fallar por clave duplicada, que es un fallo del transporte
   * y no del dato.
   */
  guardar(datos: DatosUsuarioRef): Promise<void>;
  /** Devuelve cuantas filas cambiaron: cero significa que no se conoce al usuario. */
  actualizarEstado(idUsuario: number, estado: EstadoCuentaRef, syncedAt: Date): Promise<number>;
  actualizarEspecialidad(idUsuario: number, especialidad: string, syncedAt: Date): Promise<number>;
}

/**
 * Carga una notificacion o falla con 404.
 *
 * Vive aqui y no repetida en cada caso de uso porque "un aviso que no existe es
 * un 404, no un null que cada quien interprete" es una regla del dominio.
 * Devolver null obligaria a cada caso de uso a recordar comprobarlo, y al
 * primero que lo olvidara el fallo saldria como un error 500.
 */
export async function exigirNotificacion(
  notificaciones: INotificacionRepository,
  id: number
): Promise<Notificacion> {
  const notificacion = await notificaciones.findById(id);
  if (notificacion === null) {
    throw AppError.notFound('La notificacion no existe.');
  }
  return notificacion;
}
