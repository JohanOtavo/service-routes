import { AppError } from '@punto-amigo/shared';

/**
 * Dominio de la reputacion: calificaciones bidireccionales, reputacion por
 * faceta y tasa de cancelacion.
 *
 * SRS: RF78 a RF85, RF164 a RF167, RF180 a RF183, RF192.
 *
 * Todo el dominio cabe en un archivo porque las tres piezas comparten las mismas
 * dos nociones —la direccion de una calificacion y la faceta de una persona— y
 * separarlas obligaria a importar esas nociones de un lado a otro sin ganar
 * claridad.
 */

/** Quien califica a quien. La tabla tiene UNIQUE(id_solicitud, direccion). */
export const DIRECCIONES = ['SOLICITANTE_A_OFERENTE', 'OFERENTE_A_SOLICITANTE'] as const;
export type Direccion = (typeof DIRECCIONES)[number];

/**
 * Faceta en la que se mide a una persona.
 *
 * Separadas a proposito (SRS RF165): ser buen oferente y ser buen solicitante
 * son cosas distintas, y promediarlas en un solo numero destruye informacion
 * —alguien impecable atendiendo y desastroso contratando quedaria "normal"—.
 */
export const FACETAS = ['COMO_OFERENTE', 'COMO_SOLICITANTE'] as const;
export type Faceta = (typeof FACETAS)[number];

export const PUNTUACION_MINIMA = 1;
export const PUNTUACION_MAXIMA = 5;
export const COMENTARIO_MAXIMO = 1000;

/** Tope de pagina: sin el, una peticion puede pedir todas las calificaciones. */
export const TAMANO_PAGINA_MAXIMO = 50;

/** Faceta del RECEPTOR, deducida de quien califico. */
export function facetaEvaluada(direccion: Direccion): Faceta {
  return direccion === 'SOLICITANTE_A_OFERENTE' ? 'COMO_OFERENTE' : 'COMO_SOLICITANTE';
}

/** Inversa de `facetaEvaluada`: que direccion alimenta una faceta. */
export function direccionQueEvalua(faceta: Faceta): Direccion {
  return faceta === 'COMO_OFERENTE' ? 'SOLICITANTE_A_OFERENTE' : 'OFERENTE_A_SOLICITANTE';
}

/** La direccion que falta para levantar el periodo ciego (SRS RF166). */
export function direccionContraria(direccion: Direccion): Direccion {
  return direccion === 'SOLICITANTE_A_OFERENTE'
    ? 'OFERENTE_A_SOLICITANTE'
    : 'SOLICITANTE_A_OFERENTE';
}

/**
 * Replica minima de la solicitud, alimentada por eventos de request-service.
 *
 * Es eventualmente consistente, y aqui eso es aceptable: la condicion que se
 * comprueba —"existio una solicitud COMPLETADA entre estas dos partes"— es un
 * hecho terminal (SRS RF81). Una solicitud completada no deja de estarlo, asi
 * que el unico error posible es rechazar una calificacion unos segundos antes de
 * tiempo, nunca aceptar una que no corresponde.
 *
 * `idUsuarioPrestador` es el usuario detras del perfil, no el perfil: la
 * reputacion se expresa en personas porque la misma persona puede ser calificada
 * en ambas facetas (RF165).
 */
export interface SolicitudCalificable {
  idSolicitud: number;
  idUsuario: number;
  idUsuarioPrestador: number;
  idServicio: number | null;
  estado: string;
  completadaAt: Date | null;
}

/** Parte que califica y parte calificada, ya resueltas. */
export interface ParteCalificadora {
  direccion: Direccion;
  idReceptor: number;
}

/**
 * Deduce la direccion de la calificacion a partir de quien la envia.
 *
 * Es la comprobacion de propiedad del recurso, no un guardia de rol: el borde
 * solo dice que quien llama tiene sesion, no que participara en ESTA solicitud.
 * Sin esto, cualquier usuario autenticado calificaria contrataciones ajenas.
 *
 * Quien no fue parte recibe 404 y no 403: confirmar que la solicitud existe
 * permitiria recorrer identificadores y descubrir contrataciones de otros.
 */
export function resolverParte(
  solicitud: SolicitudCalificable,
  idEmisor: number
): ParteCalificadora {
  /**
   * El autocalificarse se comprueba antes de elegir la direccion.
   *
   * Cuando solicitante y oferente son la misma persona, ambas ramas encajarian y
   * la calificacion saldria con emisor igual a receptor. La base lo rechazaria
   * por el CHECK, pero con un error de motor que no le dice nada a nadie; aqui
   * se explica el motivo.
   */
  if (solicitud.idUsuario === solicitud.idUsuarioPrestador) {
    throw AppError.conflict(
      'No puede calificarse a si mismo: usted figura como las dos partes de esta solicitud.'
    );
  }

  if (idEmisor === solicitud.idUsuario) {
    return { direccion: 'SOLICITANTE_A_OFERENTE', idReceptor: solicitud.idUsuarioPrestador };
  }
  if (idEmisor === solicitud.idUsuarioPrestador) {
    // SRS RF164: el oferente tambien califica al solicitante.
    return { direccion: 'OFERENTE_A_SOLICITANTE', idReceptor: solicitud.idUsuario };
  }

  throw AppError.notFound('La solicitud no existe.');
}

export interface CalificacionProps {
  id: number;
  idSolicitud: number;
  direccion: Direccion;
  idEmisor: number;
  idReceptor: number;
  idServicio: number | null;
  puntuacion: number;
  comentario: string | null;
  visibleAt: Date | null;
  ocultaPorModeracion: boolean;
  fecha: Date;
}

export class Calificacion {
  private constructor(private props: CalificacionProps) {}

  static rehydrate(props: CalificacionProps): Calificacion {
    return new Calificacion(props);
  }

  /**
   * Registra una calificacion (SRS RF78 a RF82, RF164).
   *
   * `yaCalificoEstaParte` llega resuelto desde el caso de uso. La garantia real
   * de "una por parte y por solicitud" es el UNIQUE(id_solicitud, direccion) de
   * la base —entre la consulta y el INSERT cabe otra peticion—, pero compararlo
   * aqui permite devolver un mensaje que explica lo ocurrido en lugar de un
   * choque de clave traducido a conflicto.
   *
   * Nace OCULTA: `visibleAt` es NULL hasta que la contraparte califique o venza
   * el plazo (RF166). El dominio no decide ese momento aqui porque depende de
   * una calificacion que esta clase no conoce; lo resuelve `PeriodoCiego`.
   */
  static registrar(input: {
    solicitud: SolicitudCalificable;
    idEmisor: number;
    puntuacion: number;
    comentario?: string | null | undefined;
    yaCalificoEstaParte: boolean;
    ahora: Date;
  }): Calificacion {
    const { direccion, idReceptor } = resolverParte(input.solicitud, input.idEmisor);

    /**
     * Solo una solicitud COMPLETADA habilita calificar (SRS RF78, RF81).
     *
     * Se exige tambien la fecha: un estado COMPLETADA sin `completada_at` es una
     * fila a medio sincronizar, y tratarla como valida dejaria pasar
     * calificaciones sobre contrataciones cuyo cierre no esta confirmado.
     */
    if (input.solicitud.estado !== 'COMPLETADA' || input.solicitud.completadaAt === null) {
      throw AppError.conflict(
        'Solo puede calificar una solicitud completada. Esta aun no lo esta.'
      );
    }

    if (input.yaCalificoEstaParte) {
      throw AppError.conflict('Ya califico esta solicitud. Cada parte califica una sola vez.');
    }

    const puntuacion = input.puntuacion;
    if (
      !Number.isInteger(puntuacion) ||
      puntuacion < PUNTUACION_MINIMA ||
      puntuacion > PUNTUACION_MAXIMA
    ) {
      throw AppError.validation('La puntuacion no es valida.', [
        {
          field: 'puntuacion',
          message: `Debe ser un numero entero entre ${PUNTUACION_MINIMA} y ${PUNTUACION_MAXIMA}.`,
        },
      ]);
    }

    // El comentario es opcional (SRS RF80). Una cadena en blanco no es un
    // comentario: se guarda NULL para que el listado no muestre huecos.
    const comentario = input.comentario?.trim() ?? '';
    if (comentario.length > COMENTARIO_MAXIMO) {
      throw AppError.validation('El comentario es demasiado largo.', [
        { field: 'comentario', message: `Maximo ${COMENTARIO_MAXIMO} caracteres.` },
      ]);
    }

    return new Calificacion({
      id: 0,
      idSolicitud: input.solicitud.idSolicitud,
      direccion,
      idEmisor: input.idEmisor,
      idReceptor,
      idServicio: input.solicitud.idServicio,
      puntuacion,
      comentario: comentario.length === 0 ? null : comentario,
      visibleAt: null,
      ocultaPorModeracion: false,
      fecha: input.ahora,
    });
  }

  get id(): number {
    return this.props.id;
  }
  get idSolicitud(): number {
    return this.props.idSolicitud;
  }
  get direccion(): Direccion {
    return this.props.direccion;
  }
  get idEmisor(): number {
    return this.props.idEmisor;
  }
  get idReceptor(): number {
    return this.props.idReceptor;
  }
  get idServicio(): number | null {
    return this.props.idServicio;
  }
  get puntuacion(): number {
    return this.props.puntuacion;
  }
  get comentario(): string | null {
    return this.props.comentario;
  }
  get visibleAt(): Date | null {
    return this.props.visibleAt;
  }
  get fecha(): Date {
    return this.props.fecha;
  }
  /** Faceta del receptor que esta calificacion alimenta (SRS RF165). */
  get facetaEvaluada(): Faceta {
    return facetaEvaluada(this.props.direccion);
  }
  /** Sigue oculta por el periodo ciego, no por moderacion (SRS RF166). */
  get enPeriodoCiego(): boolean {
    return this.props.visibleAt === null;
  }
  /** Publica: revelada y no retirada por un administrador (SRS RF85). */
  get esPublica(): boolean {
    return this.props.visibleAt !== null && !this.props.ocultaPorModeracion;
  }

  /**
   * Levanta el periodo ciego.
   *
   * Idempotente: conserva la fecha original si ya estaba revelada. El proceso
   * que vence plazos y el registro de la contraparte pueden coincidir, y mover
   * la fecha haria que una calificacion pareciera mas reciente de lo que es.
   */
  revelar(ahora: Date): void {
    if (this.props.visibleAt !== null) return;
    this.props.visibleAt = ahora;
  }

  /** Retirada por moderacion: la ejecuta un administrador, no el autor (SRS RF85). */
  ocultarPorModeracion(): void {
    this.props.ocultaPorModeracion = true;
  }

  /**
   * Vista para QUIEN LA ESCRIBIO. Incluye la puntuacion siempre, tambien en
   * periodo ciego: el autor tiene derecho a ver lo que puso, y ocultarselo no
   * protege a nadie porque ya lo sabe.
   *
   * No expone `idEmisor` ni `ocultaPorModeracion`. Lo segundo importa: decir
   * que una calificacion fue retirada confirma que existio y que alguien se
   * quejo de ella (SRS RF85).
   */
  toJSON(): Record<string, unknown> {
    return {
      id: this.props.id,
      idSolicitud: this.props.idSolicitud,
      direccion: this.props.direccion,
      idReceptor: this.props.idReceptor,
      idServicio: this.props.idServicio,
      puntuacion: this.props.puntuacion,
      comentario: this.props.comentario,
      fecha: this.props.fecha.toISOString(),
      visibleAt: this.props.visibleAt?.toISOString() ?? null,
    };
  }

  /**
   * Vista para TERCEROS. Se niega mientras la calificacion no sea publica.
   *
   * `toJSON()` no puede servir al listado publico: devuelve la puntuacion
   * aunque `visibleAt` siga en NULL, y entonces el periodo ciego dependeria de
   * que cada consulta recuerde filtrar. RF166 se sostiene sobre que nadie vea
   * la nota antes de tiempo, asi que la unica forma segura es que el camino
   * equivocado no exista: aqui falla, en lugar de publicar de mas.
   *
   * Lanza y no devuelve null a proposito. Un null se cuela en una lista como
   * hueco silencioso; una excepcion delata al llamador que no filtro.
   */
  vistaPublica(): Record<string, unknown> {
    if (!this.esPublica) {
      throw AppError.conflict('Esta calificacion no es publica todavia.', {
        idCalificacion: this.props.id,
        motivo: this.props.ocultaPorModeracion ? 'MODERACION' : 'PERIODO_CIEGO',
      });
    }
    return this.toJSON();
  }
}

export const DIAS_PERIODO_CIEGO_POR_DEFECTO = 14;

/**
 * Periodo ciego (SRS RF166).
 *
 * Las dos calificaciones de una solicitud permanecen ocultas hasta que ambas
 * existan o venza el plazo. Sin esta regla nadie califica mal: quien va primero
 * sabe que la otra parte puede responder con un 1, asi que todo el mundo pone
 * cinco estrellas y la reputacion deja de medir nada. Revelarlas juntas quita la
 * posibilidad de represalia porque, cuando una se ve, la otra ya esta escrita.
 *
 * El plazo evita el bloqueo contrario: si quien recibio un mal servicio nunca
 * califica, la calificacion de la otra parte quedaria oculta para siempre.
 */
export class PeriodoCiego {
  constructor(private readonly dias: number = DIAS_PERIODO_CIEGO_POR_DEFECTO) {
    if (!Number.isInteger(dias) || dias < 1) {
      throw new Error('El periodo ciego debe ser de al menos un dia completo.');
    }
  }

  /**
   * Resuelve la visibilidad al registrar una calificacion.
   *
   * Devuelve las que cambiaron de estado, para que el caso de uso sepa
   * exactamente que persistir y de quien recalcular la reputacion. Una lista
   * vacia significa "sigue en periodo ciego", que es el caso normal de la
   * primera de las dos.
   */
  resolverAlRegistrar(
    nueva: Calificacion,
    contraria: Calificacion | null,
    ahora: Date
  ): readonly Calificacion[] {
    if (contraria === null) return [];

    nueva.revelar(ahora);
    contraria.revelar(ahora);
    return [nueva, contraria];
  }

  /** Instante en que el plazo vence para una calificacion aun oculta. */
  venceAt(calificacion: Calificacion): Date {
    return new Date(calificacion.fecha.getTime() + this.dias * 86_400_000);
  }

  vencio(calificacion: Calificacion, ahora: Date): boolean {
    return calificacion.enPeriodoCiego && ahora.getTime() >= this.venceAt(calificacion).getTime();
  }

  /** Fecha limite que busca el proceso de vencimiento: todo lo anterior vencio. */
  limiteDeVencimiento(ahora: Date): Date {
    return new Date(ahora.getTime() - this.dias * 86_400_000);
  }
}

/** Suma y cantidad de puntuaciones ya visibles. Lo calcula la persistencia. */
export interface AgregadoPuntuaciones {
  suma: number;
  total: number;
}

/**
 * Media con dos decimales, que es la precision de la columna.
 *
 * Se calcula a partir de SUMA y CONTEO en lugar de arrastrar la media anterior:
 * sumar cada nueva puntuacion sobre una media ya redondeada acumula error, y
 * ademas una calificacion puede volverse visible mucho despues de registrarse
 * —al vencer el periodo ciego—, de modo que no hay un orden fiable que
 * incorporar.
 */
export function calcularMedia(agregado: AgregadoPuntuaciones): number {
  if (agregado.total <= 0) return 0;
  return Math.round((agregado.suma / agregado.total) * 100) / 100;
}

export interface ReputacionProps {
  idUsuario: number;
  faceta: Faceta;
  puntuacionMedia: number;
  totalCalificaciones: number;
  actualizadoAt: Date;
}

/** Reputacion de una persona en una faceta (SRS RF165, RF167). */
export class Reputacion {
  private constructor(private props: ReputacionProps) {}

  static rehydrate(props: ReputacionProps): Reputacion {
    return new Reputacion(props);
  }

  /**
   * Recalcula desde las calificaciones VISIBLES de esa faceta (SRS RF84).
   *
   * Solo cuentan las visibles: incluir las del periodo ciego revelaria por la
   * puerta de atras lo que RF166 oculta por la de delante —un promedio que baja
   * de 5 a 3 dice que la calificacion pendiente fue mala—.
   */
  static recalcular(input: {
    idUsuario: number;
    faceta: Faceta;
    agregado: AgregadoPuntuaciones;
    ahora: Date;
  }): Reputacion {
    return new Reputacion({
      idUsuario: input.idUsuario,
      faceta: input.faceta,
      puntuacionMedia: calcularMedia(input.agregado),
      totalCalificaciones: Math.max(0, Math.trunc(input.agregado.total)),
      actualizadoAt: input.ahora,
    });
  }

  get idUsuario(): number {
    return this.props.idUsuario;
  }
  get faceta(): Faceta {
    return this.props.faceta;
  }
  get puntuacionMedia(): number {
    return this.props.puntuacionMedia;
  }
  get totalCalificaciones(): number {
    return this.props.totalCalificaciones;
  }
  get actualizadoAt(): Date {
    return this.props.actualizadoAt;
  }

  toJSON(): Record<string, unknown> {
    return {
      faceta: this.props.faceta,
      puntuacionMedia: this.props.puntuacionMedia,
      totalCalificaciones: this.props.totalCalificaciones,
      actualizadoAt: this.props.actualizadoAt.toISOString(),
    };
  }
}

/** Promedio publico de un servicio (SRS RF83, RF84). */
export interface PromedioServicio {
  idServicio: number;
  promedio: number;
  total: number;
}

export function promedioDeServicio(
  idServicio: number,
  agregado: AgregadoPuntuaciones
): PromedioServicio {
  return {
    idServicio,
    promedio: calcularMedia(agregado),
    total: Math.max(0, Math.trunc(agregado.total)),
  };
}

/** Paginacion acotada para la consulta publica (SRS RF83). */
export function normalizarPaginacion(entrada: {
  pagina?: number | undefined;
  tamano?: number | undefined;
}): { pagina: number; tamano: number } {
  return {
    pagina: Math.max(1, Math.floor(entrada.pagina ?? 1)),
    tamano: Math.min(TAMANO_PAGINA_MAXIMO, Math.max(1, Math.floor(entrada.tamano ?? 20))),
  };
}

/**
 * Umbrales de la tasa de cancelacion (SRS RF181 a RF183, seccion 10.2.6).
 *
 * Son parametros del sistema (RF105) y no constantes de negocio medidas: estan
 * tomados por analogia con el transporte y deben recalibrarse con datos reales.
 */
export const UMBRALES_CANCELACION = [
  { nivel: 1, tasa: 0.15 },
  { nivel: 2, tasa: 0.3 },
  { nivel: 3, tasa: 0.5 },
] as const;

/**
 * Minimo de contrataciones para que la tasa signifique algo.
 *
 * Con dos contrataciones y una cancelacion la tasa es del 50 % y dispararia el
 * tercer umbral, que abre revision administrativa. Una muestra asi no distingue
 * a quien cancela por costumbre de quien tuvo un mal dia (SRS seccion 10.2.6).
 */
export const CONTRATACIONES_MINIMAS_EVALUABLES = 5;

export const DIAS_VENTANA_CANCELACION_POR_DEFECTO = 90;

/** Nivel de umbral que corresponde a una tasa; 0 si no alcanza ninguno. */
export function nivelDeUmbral(tasa: number, evaluable: boolean): number {
  if (!evaluable) return 0;

  for (let i = UMBRALES_CANCELACION.length - 1; i >= 0; i -= 1) {
    const umbral = UMBRALES_CANCELACION[i];
    if (umbral !== undefined && tasa >= umbral.tasa) return umbral.nivel;
  }
  return 0;
}

/**
 * Una cancelacion imputada a una persona, tal como llega del evento.
 *
 * Se guarda fila a fila en `cancelacion_ref` y no solo agregada: la ventana es
 * movil, asi que lo que sale de ella hay que RESTARLO, y para eso hace falta
 * saber que cancelacion fue y cuanto pesaba. Con solo el agregado la tasa no
 * podria bajar nunca, y una mala racha marcaria a alguien de forma permanente
 * —justo lo que una ventana movil existe para evitar—.
 *
 * `peso` y `computa` los decide request-service, que es dueno del hecho
 * (SRS RF178, RF179); aqui solo se validan y se conservan.
 */
export interface CancelacionImputada {
  idCancelacion: number;
  idSolicitud: number;
  idUsuarioImputado: number;
  faceta: Faceta;
  peso: number;
  computa: boolean;
  canceladaAt: Date;
}

/** Peso maximo admisible: la columna es DECIMAL(3,2). */
const PESO_MAXIMO = 9.99;

export function validarCancelacion(entrada: CancelacionImputada): CancelacionImputada {
  if (!Number.isFinite(entrada.peso) || entrada.peso < 0 || entrada.peso > PESO_MAXIMO) {
    throw AppError.validation('El peso de la cancelacion no es valido.', [
      { field: 'peso', message: `Debe estar entre 0 y ${PESO_MAXIMO}.` },
    ]);
  }
  if (!FACETAS.includes(entrada.faceta)) {
    throw AppError.validation('La faceta de la cancelacion no es valida.', [
      { field: 'faceta', message: FACETAS.join(' o ') },
    ]);
  }
  return entrada;
}

/** Lo que la persistencia resume de la ventana movil. */
export interface VentanaCancelacion {
  /** Denominador: contrataciones cerradas dentro de la ventana. */
  contrataciones: number;
  /** Numerador: suma de PESOS de las que computan, no su conteo. */
  ponderadas: number;
  ventanaDesde: Date;
}

export interface TasaCancelacionProps {
  idUsuario: number;
  faceta: Faceta;
  contratacionesEnVentana: number;
  cancelacionesPonderadas: number;
  tasa: number;
  umbralAlcanzado: number;
  evaluable: boolean;
  ventanaDesde: Date;
  calculadaAt: Date;
}

/**
 * Tasa de cancelacion de una persona en una faceta (SRS RF180 a RF183).
 *
 * El numerador suma pesos y no cancelaciones: cancelar el mismo dia pesa 1,5 y
 * cancelar con 48 horas de margen pesa 0,5 (seccion 10.2.3). Por eso la tasa
 * puede pasar de 1 y el CHECK de la columna admite hasta 3.
 */
export class TasaCancelacion {
  private constructor(private props: TasaCancelacionProps) {}

  static rehydrate(props: TasaCancelacionProps): TasaCancelacion {
    return new TasaCancelacion(props);
  }

  static inicial(idUsuario: number, faceta: Faceta, ventanaDesde: Date, ahora: Date): TasaCancelacion {
    return new TasaCancelacion({
      idUsuario,
      faceta,
      contratacionesEnVentana: 0,
      cancelacionesPonderadas: 0,
      tasa: 0,
      umbralAlcanzado: 0,
      evaluable: false,
      ventanaDesde,
      calculadaAt: ahora,
    });
  }

  /**
   * Recalcula desde el detalle de la ventana y devuelve el umbral CRUZADO.
   *
   * Devuelve null cuando el nivel no sube, incluso si sigue por encima de un
   * umbral: el evento anuncia un cruce, y reemitirlo en cada recalculo
   * convertiria la bandeja administrativa y los avisos al usuario en ruido
   * (SRS RF181, RF183).
   */
  recalcular(ventana: VentanaCancelacion, ahora: Date): number | null {
    const contrataciones = Math.max(0, Math.trunc(ventana.contrataciones));
    const ponderadas = Math.max(0, ventana.ponderadas);

    const evaluable = contrataciones >= CONTRATACIONES_MINIMAS_EVALUABLES;
    // Division solo si hay denominador. Y la tasa se publica como 0 mientras no
    // sea evaluable, para que nada aguas abajo muestre un porcentaje calculado
    // sobre dos contrataciones.
    const tasa =
      evaluable && contrataciones > 0 ? Math.round((ponderadas / contrataciones) * 10_000) / 10_000 : 0;

    const nivelAnterior = this.props.umbralAlcanzado;
    const nivel = nivelDeUmbral(tasa, evaluable);

    this.props = {
      ...this.props,
      contratacionesEnVentana: contrataciones,
      cancelacionesPonderadas: ponderadas,
      tasa,
      umbralAlcanzado: nivel,
      evaluable,
      ventanaDesde: ventana.ventanaDesde,
      calculadaAt: ahora,
    };

    return nivel > nivelAnterior ? nivel : null;
  }

  get idUsuario(): number {
    return this.props.idUsuario;
  }
  get faceta(): Faceta {
    return this.props.faceta;
  }
  get tasa(): number {
    return this.props.tasa;
  }
  get evaluable(): boolean {
    return this.props.evaluable;
  }
  get umbralAlcanzado(): number {
    return this.props.umbralAlcanzado;
  }
  get contratacionesEnVentana(): number {
    return this.props.contratacionesEnVentana;
  }
  get cancelacionesPonderadas(): number {
    return this.props.cancelacionesPonderadas;
  }
  get ventanaDesde(): Date {
    return this.props.ventanaDesde;
  }
  get calculadaAt(): Date {
    return this.props.calculadaAt;
  }

  /**
   * Visible en el perfil publico solo por encima del primer umbral (SRS RF192).
   *
   * Al no haber cobro, la visibilidad es el unico instrumento disuasorio; pero
   * publicar un 0 % de todo el mundo no disuade a nadie y si expone a quien
   * cancelo una vez de forma justificada.
   */
  get esPublica(): boolean {
    return this.props.evaluable && this.props.umbralAlcanzado >= 1;
  }

  toJSON(): Record<string, unknown> {
    return {
      faceta: this.props.faceta,
      tasa: this.props.tasa,
      umbralAlcanzado: this.props.umbralAlcanzado,
      contratacionesEnVentana: this.props.contratacionesEnVentana,
      ventanaDesde: this.props.ventanaDesde.toISOString(),
    };
  }
}

/** Inicio de la ventana movil a partir de su duracion en dias (SRS RF180). */
export function inicioDeVentana(ahora: Date, dias: number): Date {
  return new Date(ahora.getTime() - dias * 86_400_000);
}
