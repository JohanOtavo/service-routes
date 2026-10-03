import { AppError, esVacio } from '@punto-amigo/shared';

/**
 * Dominio del servicio nucleo: necesidades, propuestas y contrataciones.
 *
 * SRS: RF54 a RF77, RF117 a RF158, RF174 a RF193.
 *
 * Aqui conviven los dos caminos de intermediacion y convergen en una sola
 * solicitud. Necesidad y Propuesta forman UN agregado: adjudicar cambia la
 * necesidad, la propuesta ganadora y las descartadas a la vez, y esas
 * escrituras no pueden separarse (NEED-AGGR-INV-007).
 */

// ─── Estados ────────────────────────────────────────────────────────────────

export const ESTADOS_NECESIDAD = [
  'ABIERTA',
  'ADJUDICADA',
  'VENCIDA',
  'CERRADA',
  'CANCELADA',
] as const;
export type EstadoNecesidad = (typeof ESTADOS_NECESIDAD)[number];

export const ESTADOS_PROPUESTA = [
  'ENVIADA',
  'ACEPTADA',
  'RECHAZADA',
  'RETIRADA',
  'DESCARTADA',
] as const;
export type EstadoPropuesta = (typeof ESTADOS_PROPUESTA)[number];

export const ESTADOS_SOLICITUD = [
  'PENDIENTE',
  'ACEPTADA',
  'RECHAZADA',
  'COMPLETADA',
  'CANCELADA',
] as const;
export type EstadoSolicitud = (typeof ESTADOS_SOLICITUD)[number];

export const ORIGENES = ['DIRECTA', 'ADJUDICACION'] as const;
export type OrigenSolicitud = (typeof ORIGENES)[number];

export type Actor = 'SOLICITANTE' | 'OFERENTE';

/**
 * Transiciones permitidas, con quien puede provocarlas.
 *
 * Es una tabla y no una cadena de `if` porque es la regla que mas se consulta y
 * la que mas facil se rompe al anadir un estado: con el mapa, olvidarse de un
 * caso produce un rechazo, no un paso en falso.
 */
const TRANSICIONES: Record<EstadoSolicitud, { a: EstadoSolicitud; por: Actor }[]> = {
  PENDIENTE: [
    { a: 'ACEPTADA', por: 'OFERENTE' },
    { a: 'RECHAZADA', por: 'OFERENTE' },
    { a: 'CANCELADA', por: 'SOLICITANTE' },
  ],
  ACEPTADA: [
    { a: 'COMPLETADA', por: 'OFERENTE' },
    { a: 'CANCELADA', por: 'SOLICITANTE' },
    // El oferente tambien puede retractarse: lo define la politica de
    // cancelacion (SRS 10.2) y le cuesta caro en su tasa.
    { a: 'CANCELADA', por: 'OFERENTE' },
  ],
  RECHAZADA: [],
  COMPLETADA: [],
  CANCELADA: [],
};

export function transicionesDesde(estado: EstadoSolicitud): EstadoSolicitud[] {
  return [...new Set(TRANSICIONES[estado].map((t) => t.a))];
}

// ─── Necesidad ──────────────────────────────────────────────────────────────

export interface NecesidadProps {
  id: number;
  titulo: string;
  descripcion: string;
  idUsuario: number;
  idCategoria: number;
  presupuestoEstimado: string | null;
  fechaDeseada: Date | null;
  ubicacionAproximada: string | null;
  estado: EstadoNecesidad;
  fechaPublicacion: Date;
  fechaVigencia: Date;
}

export class Necesidad {
  private constructor(private props: NecesidadProps) {}

  static rehydrate(props: NecesidadProps): Necesidad {
    return new Necesidad(props);
  }

  static publicar(input: {
    titulo: string;
    descripcion: string;
    idUsuario: number;
    idCategoria: number;
    categoriaActiva: boolean;
    presupuestoEstimado?: string | null;
    fechaDeseada?: Date | null;
    ubicacionAproximada?: string | null;
    abiertasDelUsuario: number;
    maximoAbiertas: number;
    diasVigencia: number;
    ahora: Date;
  }): Necesidad {
    if (!input.categoriaActiva) {
      throw AppError.conflict('La categoria seleccionada no esta disponible.');
    }

    // Limite anti-abuso (SRS RF125, RNF86). Sin el, una cuenta inunda el
    // listado y vacia de sentido la bandeja de los oferentes.
    if (input.abiertasDelUsuario >= input.maximoAbiertas) {
      throw AppError.conflict(
        `Ya tiene ${input.maximoAbiertas} necesidades abiertas. Cierre alguna antes de publicar otra.`
      );
    }

    const titulo = input.titulo.trim();
    const descripcion = input.descripcion.trim();
    const errores: { field: string; message: string }[] = [];

    if (titulo.length < 5 || titulo.length > 150) {
      errores.push({ field: 'titulo', message: 'Debe tener entre 5 y 150 caracteres.' });
    }
    if (descripcion.length < 20) {
      errores.push({
        field: 'descripcion',
        message: 'Describa el trabajo con al menos 20 caracteres.',
      });
    }
    if (!esVacio(input.presupuestoEstimado) && Number(input.presupuestoEstimado) <= 0) {
      errores.push({ field: 'presupuestoEstimado', message: 'Debe ser mayor que cero.' });
    }
    if (!esVacio(input.fechaDeseada) && input.fechaDeseada.getTime() < input.ahora.getTime()) {
      errores.push({ field: 'fechaDeseada', message: 'No puede estar en el pasado.' });
    }
    if (errores.length > 0) {
      throw AppError.validation('Los datos de la necesidad no son validos.', errores);
    }

    return new Necesidad({
      id: 0,
      titulo,
      descripcion,
      idUsuario: input.idUsuario,
      idCategoria: input.idCategoria,
      presupuestoEstimado: input.presupuestoEstimado ?? null,
      fechaDeseada: input.fechaDeseada ?? null,
      // Zona, no direccion: el SRS 10.5 lo exige y aqui es donde se impone.
      ubicacionAproximada: input.ubicacionAproximada?.trim().slice(0, 150) ?? null,
      estado: 'ABIERTA',
      fechaPublicacion: input.ahora,
      fechaVigencia: new Date(input.ahora.getTime() + input.diasVigencia * 86_400_000),
    });
  }

  get id(): number {
    return this.props.id;
  }
  get idUsuario(): number {
    return this.props.idUsuario;
  }
  get idCategoria(): number {
    return this.props.idCategoria;
  }
  get descripcion(): string {
    return this.props.descripcion;
  }
  get estado(): EstadoNecesidad {
    return this.props.estado;
  }
  get fechaVigencia(): Date {
    return this.props.fechaVigencia;
  }

  /** Abierta Y dentro de vigencia. Lo segundo se olvida con facilidad. */
  estaAbierta(ahora: Date): boolean {
    return this.props.estado === 'ABIERTA' && this.props.fechaVigencia.getTime() > ahora.getTime();
  }

  // 404 y no 403: un 403 confirmaria que la necesidad existe.
  private exigirAutor(idUsuario: number): void {
    if (this.props.idUsuario !== idUsuario) {
      throw AppError.notFound('La necesidad no existe.');
    }
  }

  editar(
    idUsuario: number,
    ahora: Date,
    cambios: { titulo?: string; descripcion?: string; presupuestoEstimado?: string | null }
  ): void {
    this.exigirAutor(idUsuario);
    if (!this.estaAbierta(ahora)) {
      throw AppError.invalidTransition('Solo se puede modificar una necesidad abierta y vigente.', [
        'ABIERTA',
      ]);
    }

    if (cambios.titulo !== undefined) {
      const titulo = cambios.titulo.trim();
      if (titulo.length < 5 || titulo.length > 150) {
        throw AppError.validation('El titulo no es valido.');
      }
      this.props.titulo = titulo;
    }
    if (cambios.descripcion !== undefined) {
      const descripcion = cambios.descripcion.trim();
      if (descripcion.length < 20) throw AppError.validation('La descripcion es demasiado corta.');
      this.props.descripcion = descripcion;
    }
    if (cambios.presupuestoEstimado !== undefined) {
      if (!esVacio(cambios.presupuestoEstimado) && Number(cambios.presupuestoEstimado) <= 0) {
        throw AppError.validation('El presupuesto debe ser mayor que cero.');
      }
      this.props.presupuestoEstimado = cambios.presupuestoEstimado;
    }
  }

  cerrar(idUsuario: number, estado: Extract<EstadoNecesidad, 'CERRADA' | 'CANCELADA'>): void {
    this.exigirAutor(idUsuario);
    if (this.props.estado !== 'ABIERTA') {
      throw AppError.invalidTransition('La necesidad ya no esta abierta.', ['ABIERTA']);
    }
    this.props.estado = estado;
  }

  /** La ejecuta un proceso programado, no una persona: sin comprobacion de autor. */
  vencer(ahora: Date): boolean {
    if (this.props.estado !== 'ABIERTA') return false;
    if (this.props.fechaVigencia.getTime() > ahora.getTime()) return false;
    this.props.estado = 'VENCIDA';
    return true;
  }

  adjudicar(idUsuario: number, ahora: Date): void {
    this.exigirAutor(idUsuario);
    if (!this.estaAbierta(ahora)) {
      throw AppError.invalidTransition('Solo se puede adjudicar una necesidad abierta y vigente.', [
        'ABIERTA',
      ]);
    }
    this.props.estado = 'ADJUDICADA';
  }

  /**
   * Reapertura tras la retractacion del oferente (SRS RF184 a RF186).
   *
   * Al adjudicar se descartaron todas las demas propuestas, asi que el
   * solicitante quedo sin alternativas: si el oferente se retira ahora, esta
   * PEOR que antes de publicar. Devolver la necesidad a ABIERTA es la
   * reparacion, y hay que ampliar la vigencia porque el tiempo original se
   * consumio esperando.
   */
  reabrir(ahora: Date, diasExtra: number): void {
    if (this.props.estado !== 'ADJUDICADA') {
      throw AppError.invalidTransition('Solo se reabre una necesidad adjudicada.', ['ADJUDICADA']);
    }
    this.props.estado = 'ABIERTA';

    /**
     * Los dias se anaden SOBRE lo que quedaba, no desde hoy.
     *
     * `ahora + diasExtra` parece lo mismo y no lo es: si la necesidad se
     * publico con 30 dias de vigencia y la retractacion llega el primer dia,
     * fijar la vigencia en hoy mas 15 la ACORTARIA de 29 dias restantes a 15.
     * La reparacion habria dejado al solicitante peor que antes de adjudicar,
     * que es exactamente lo contrario de lo que RF185 persigue.
     *
     * Se parte del momento mas tardio entre la vigencia que quedaba y hoy, para
     * que el plazo tambien crezca cuando la necesidad ya habia caducado
     * esperando a un oferente que acabo retractandose.
     */
    const desde = Math.max(this.props.fechaVigencia.getTime(), ahora.getTime());
    this.props.fechaVigencia = new Date(desde + diasExtra * 86_400_000);
  }

  /** Vista para oferentes. Nunca incluye datos de contacto (SRS RF136). */
  toPublicJSON(): Record<string, unknown> {
    return {
      id: this.props.id,
      titulo: this.props.titulo,
      descripcion: this.props.descripcion,
      idCategoria: this.props.idCategoria,
      presupuestoEstimado: this.props.presupuestoEstimado,
      fechaDeseada: this.props.fechaDeseada,
      ubicacionAproximada: this.props.ubicacionAproximada,
      fechaPublicacion: this.props.fechaPublicacion,
      fechaVigencia: this.props.fechaVigencia,
    };
  }

  toOwnerJSON(): Record<string, unknown> {
    return { ...this.toPublicJSON(), estado: this.props.estado, idUsuario: this.props.idUsuario };
  }
}

// ─── Propuesta ──────────────────────────────────────────────────────────────

export interface PropuestaProps {
  id: number;
  idNecesidad: number;
  idPrestador: number;
  precio: string;
  tiempoEstimado: number;
  mensaje: string;
  idServicio: number | null;
  estado: EstadoPropuesta;
}

export class Propuesta {
  private constructor(private props: PropuestaProps) {}

  static rehydrate(props: PropuestaProps): Propuesta {
    return new Propuesta(props);
  }

  static enviar(input: {
    necesidad: Necesidad;
    idPrestador: number;
    idUsuarioPrestador: number;
    estadoPrestador: string;
    precio: string;
    tiempoEstimado: number;
    mensaje: string;
    idServicio?: number | null;
    yaTienePropuestaVigente: boolean;
    ahora: Date;
  }): Propuesta {
    if (!input.necesidad.estaAbierta(input.ahora)) {
      throw AppError.conflict('Esta necesidad ya no admite propuestas.');
    }
    if (input.estadoPrestador !== 'ACTIVE') {
      throw AppError.conflict('Su perfil de prestador debe estar validado para proponer.');
    }
    // El autor no puede proponerse a si mismo (PROPOSAL-INV-003). Se compara por
    // USUARIO y no por prestador: la misma persona puede tener ambos roles.
    if (input.necesidad.idUsuario === input.idUsuarioPrestador) {
      throw AppError.conflict('No puede enviar una propuesta sobre su propia necesidad.');
    }
    if (input.yaTienePropuestaVigente) {
      throw AppError.conflict('Ya tiene una propuesta pendiente de decision en esta necesidad.');
    }

    const mensaje = input.mensaje.trim();
    const errores: { field: string; message: string }[] = [];

    if (Number(input.precio) <= 0) {
      errores.push({ field: 'precio', message: 'Debe ser mayor que cero.' });
    }
    if (!Number.isInteger(input.tiempoEstimado) || input.tiempoEstimado <= 0) {
      errores.push({
        field: 'tiempoEstimado',
        message: 'Debe ser un numero de dias mayor que cero.',
      });
    }
    if (mensaje.length < 10) {
      errores.push({ field: 'mensaje', message: 'Escriba al menos 10 caracteres.' });
    }
    if (errores.length > 0) {
      throw AppError.validation('Los datos de la propuesta no son validos.', errores);
    }

    return new Propuesta({
      id: 0,
      idNecesidad: input.necesidad.id,
      idPrestador: input.idPrestador,
      precio: input.precio,
      tiempoEstimado: input.tiempoEstimado,
      mensaje,
      idServicio: input.idServicio ?? null,
      estado: 'ENVIADA',
    });
  }

  get id(): number {
    return this.props.id;
  }
  get idNecesidad(): number {
    return this.props.idNecesidad;
  }
  get idPrestador(): number {
    return this.props.idPrestador;
  }
  get precio(): string {
    return this.props.precio;
  }
  get tiempoEstimado(): number {
    return this.props.tiempoEstimado;
  }
  get estado(): EstadoPropuesta {
    return this.props.estado;
  }
  get vigente(): boolean {
    return this.props.estado === 'ENVIADA';
  }

  private exigirVigente(): void {
    if (!this.vigente) {
      throw AppError.invalidTransition('La propuesta ya fue decidida.', ['ENVIADA']);
    }
  }

  modificar(
    idPrestador: number,
    cambios: { precio?: string; tiempoEstimado?: number; mensaje?: string }
  ): void {
    if (this.props.idPrestador !== idPrestador) throw AppError.notFound('La propuesta no existe.');
    this.exigirVigente();

    if (cambios.precio !== undefined) {
      if (Number(cambios.precio) <= 0)
        throw AppError.validation('El precio debe ser mayor que cero.');
      this.props.precio = cambios.precio;
    }
    if (cambios.tiempoEstimado !== undefined) {
      if (!Number.isInteger(cambios.tiempoEstimado) || cambios.tiempoEstimado <= 0) {
        throw AppError.validation('El tiempo estimado no es valido.');
      }
      this.props.tiempoEstimado = cambios.tiempoEstimado;
    }
    if (cambios.mensaje !== undefined) {
      const mensaje = cambios.mensaje.trim();
      if (mensaje.length < 10) throw AppError.validation('El mensaje es demasiado corto.');
      this.props.mensaje = mensaje;
    }
  }

  retirar(idPrestador: number): void {
    if (this.props.idPrestador !== idPrestador) throw AppError.notFound('La propuesta no existe.');
    this.exigirVigente();
    this.props.estado = 'RETIRADA';
  }

  aceptar(): void {
    this.exigirVigente();
    this.props.estado = 'ACEPTADA';
  }

  rechazar(): void {
    this.exigirVigente();
    this.props.estado = 'RECHAZADA';
  }

  /** Decae porque se adjudico otra o la necesidad dejo de estar abierta. */
  descartar(): boolean {
    if (!this.vigente) return false;
    this.props.estado = 'DESCARTADA';
    return true;
  }

  /** Lo que ve su autor. Ningun OTRO oferente ve esto (SRS RF148). */
  toAuthorJSON(): Record<string, unknown> {
    return {
      id: this.props.id,
      idNecesidad: this.props.idNecesidad,
      idPrestador: this.props.idPrestador,
      precio: this.props.precio,
      tiempoEstimado: this.props.tiempoEstimado,
      mensaje: this.props.mensaje,
      idServicio: this.props.idServicio,
      estado: this.props.estado,
    };
  }
}

// ─── Solicitud de servicio ──────────────────────────────────────────────────

export interface SolicitudProps {
  id: number;
  estado: EstadoSolicitud;
  origen: OrigenSolicitud;
  descripcionProblema: string;
  idUsuario: number;
  idPrestador: number;
  idServicio: number | null;
  idNecesidad: number | null;
  idPropuesta: number | null;
  valorAcordado: string | null;
  plazoAcordado: number | null;
  fechaSolicitud: Date;
}

export class Solicitud {
  private constructor(private props: SolicitudProps) {}

  static rehydrate(props: SolicitudProps): Solicitud {
    return new Solicitud(props);
  }

  /** Camino del catalogo: nace PENDIENTE y espera respuesta del oferente. */
  static directa(input: {
    descripcionProblema: string;
    idUsuario: number;
    idPrestador: number;
    idServicio: number;
    servicioActivo: boolean;
    ahora: Date;
  }): Solicitud {
    if (!input.servicioActivo) {
      throw AppError.conflict('El servicio solicitado ya no esta disponible.');
    }
    const descripcion = input.descripcionProblema.trim();
    if (descripcion.length < 10) {
      throw AppError.validation('Describa el problema.', [
        { field: 'descripcionProblema', message: 'Escriba al menos 10 caracteres.' },
      ]);
    }

    return new Solicitud({
      id: 0,
      estado: 'PENDIENTE',
      origen: 'DIRECTA',
      descripcionProblema: descripcion,
      idUsuario: input.idUsuario,
      idPrestador: input.idPrestador,
      idServicio: input.idServicio,
      idNecesidad: null,
      idPropuesta: null,
      valorAcordado: null,
      plazoAcordado: null,
      fechaSolicitud: input.ahora,
    });
  }

  /**
   * Camino de la adjudicacion: nace ACEPTADA.
   *
   * No pasa por PENDIENTE porque el acuerdo YA se alcanzo al adjudicar: pedirle
   * al oferente que acepte lo que el mismo propuso dejaria la contratacion
   * esperando una aprobacion que nadie va a dar (REQUEST-INV-004).
   *
   * El precio y el plazo se copian de la propuesta y quedan congelados: son el
   * acuerdo, no una preferencia editable (REQUEST-INV-009).
   */
  static porAdjudicacion(input: {
    necesidad: Necesidad;
    propuesta: Propuesta;
    idPrestador: number;
    ahora: Date;
  }): Solicitud {
    return new Solicitud({
      id: 0,
      estado: 'ACEPTADA',
      origen: 'ADJUDICACION',
      descripcionProblema: input.necesidad.descripcion,
      idUsuario: input.necesidad.idUsuario,
      idPrestador: input.idPrestador,
      idServicio: null,
      idNecesidad: input.necesidad.id,
      idPropuesta: input.propuesta.id,
      valorAcordado: input.propuesta.precio,
      plazoAcordado: input.propuesta.tiempoEstimado,
      fechaSolicitud: input.ahora,
    });
  }

  get id(): number {
    return this.props.id;
  }
  get estado(): EstadoSolicitud {
    return this.props.estado;
  }
  get origen(): OrigenSolicitud {
    return this.props.origen;
  }
  get idUsuario(): number {
    return this.props.idUsuario;
  }
  get idPrestador(): number {
    return this.props.idPrestador;
  }
  get idNecesidad(): number | null {
    return this.props.idNecesidad;
  }

  /**
   * Traduce un usuario a su papel en ESTA solicitud.
   *
   * Un tercero no es ninguno de los dos y recibe 404: devolver 403 confirmaria
   * que la solicitud existe.
   */
  actorDe(idUsuario: number, idUsuarioPrestador: number): Actor {
    if (idUsuario === this.props.idUsuario) return 'SOLICITANTE';
    if (idUsuario === idUsuarioPrestador) return 'OFERENTE';
    throw AppError.notFound('La solicitud no existe.');
  }

  cambiarEstado(nuevo: EstadoSolicitud, actor: Actor): void {
    const permitidas = TRANSICIONES[this.props.estado];
    const valida = permitidas.some((t) => t.a === nuevo && t.por === actor);

    if (!valida) {
      throw AppError.invalidTransition(
        `No se puede pasar de ${this.props.estado} a ${nuevo}.`,
        transicionesDesde(this.props.estado),
        { estadoActual: this.props.estado, actor }
      );
    }
    this.props.estado = nuevo;
  }

  toJSON(revelarContacto: boolean, contacto?: Record<string, unknown>): Record<string, unknown> {
    return {
      id: this.props.id,
      estado: this.props.estado,
      origen: this.props.origen,
      descripcionProblema: this.props.descripcionProblema,
      idUsuario: this.props.idUsuario,
      idPrestador: this.props.idPrestador,
      idServicio: this.props.idServicio,
      idNecesidad: this.props.idNecesidad,
      idPropuesta: this.props.idPropuesta,
      valorAcordado: this.props.valorAcordado,
      plazoAcordado: this.props.plazoAcordado,
      fechaSolicitud: this.props.fechaSolicitud,
      // Solo tras el acuerdo (SRS RF156, RNF84).
      contacto: revelarContacto ? (contacto ?? null) : null,
    };
  }
}

// ─── Politica de cancelacion ────────────────────────────────────────────────

export const FRANJAS = ['GRACIA', 'HOLGADA', 'AJUSTADA', 'TARDIA'] as const;
export type Franja = (typeof FRANJAS)[number];

export interface ParametrosCancelacion {
  graciaHoras: number;
  holgadaHoras: number;
  pesoGracia: number;
  pesoHolgada: number;
  pesoAjustada: number;
  pesoTardia: number;
}

/** Punto de partida del SRS 10.2.3. Son parametros, no constantes: se recalibran con datos. */
export const PARAMETROS_POR_DEFECTO: ParametrosCancelacion = {
  graciaHoras: 2,
  holgadaHoras: 48,
  pesoGracia: 0,
  pesoHolgada: 0.5,
  pesoAjustada: 1,
  pesoTardia: 1.5,
};

/**
 * Clasifica una cancelacion segun cuanto aviso dio.
 *
 * Son dos relojes distintos: la gracia se mide desde que se ACEPTO —permite
 * deshacer un arrepentimiento inmediato— y el resto desde la FECHA ACORDADA,
 * porque lo que dana a la contraparte es quedarse sin margen para reorganizarse.
 *
 * Sin fecha acordada no hay proximidad que medir, asi que cuenta como holgada.
 */
export function clasificarCancelacion(input: {
  aceptadaAt: Date;
  fechaAcordada: Date | null;
  ahora: Date;
  parametros?: ParametrosCancelacion;
}): { franja: Franja; peso: number; horasDeAntelacion: number | null } {
  const p = input.parametros ?? PARAMETROS_POR_DEFECTO;
  const horasDesdeAceptacion = (input.ahora.getTime() - input.aceptadaAt.getTime()) / 3_600_000;

  if (horasDesdeAceptacion <= p.graciaHoras) {
    return { franja: 'GRACIA', peso: p.pesoGracia, horasDeAntelacion: null };
  }

  if (input.fechaAcordada === null) {
    return { franja: 'HOLGADA', peso: p.pesoHolgada, horasDeAntelacion: null };
  }

  const horasDeAntelacion = (input.fechaAcordada.getTime() - input.ahora.getTime()) / 3_600_000;

  if (horasDeAntelacion <= 0) {
    return { franja: 'TARDIA', peso: p.pesoTardia, horasDeAntelacion };
  }
  if (horasDeAntelacion < p.holgadaHoras) {
    return { franja: 'AJUSTADA', peso: p.pesoAjustada, horasDeAntelacion };
  }
  return { franja: 'HOLGADA', peso: p.pesoHolgada, horasDeAntelacion };
}

export interface MotivoCancelacion {
  codigo: string;
  computa: boolean;
  trasladaFalta: boolean;
  exigeValidacion: boolean;
  exigeDetalle: boolean;
}

/**
 * Decide si la cancelacion computa y a quien se le carga.
 *
 * Un motivo excusado no se acepta sin mas: los que trasladan la falta o exigen
 * validacion abren una disputa o una revision antes de surtir efecto. De lo
 * contrario todo el mundo elegiria siempre un motivo excusado (SRS 10.2.4).
 */
export function resolverImputacion(input: {
  motivo: MotivoCancelacion;
  franja: Franja;
  idUsuarioCancela: number;
  idUsuarioAfectado: number;
  detalle?: string | null;
}): { computa: boolean; idUsuarioImputado: number | null; requiereRevision: boolean } {
  if (input.motivo.exigeDetalle && (input.detalle ?? '').trim().length < 10) {
    throw AppError.validation('Ese motivo exige una explicacion.', [
      { field: 'detalle', message: 'Escriba al menos 10 caracteres.' },
    ]);
  }

  // Dentro de la gracia no computa, sea cual sea el motivo.
  if (input.franja === 'GRACIA') {
    return { computa: false, idUsuarioImputado: null, requiereRevision: false };
  }

  if (input.motivo.trasladaFalta) {
    // La falta pasa a la contraparte, pero no se da por buena hasta que la
    // incomparecencia se confirme o venza el plazo de disputa.
    return { computa: true, idUsuarioImputado: input.idUsuarioAfectado, requiereRevision: true };
  }

  if (input.motivo.exigeValidacion) {
    return { computa: false, idUsuarioImputado: null, requiereRevision: true };
  }

  if (!input.motivo.computa) {
    return { computa: false, idUsuarioImputado: null, requiereRevision: false };
  }

  return { computa: true, idUsuarioImputado: input.idUsuarioCancela, requiereRevision: false };
}

/**
 * Resultado de adjudicar. Lo produce el dominio en una sola operacion.
 *
 * Devolver el conjunto completo —y no ir mutando por fuera— es lo que permite
 * que el caso de uso lo escriba todo en UNA transaccion. Si cada cambio se
 * decidiera por separado, alguien acabaria confirmando la mitad.
 */
export interface ResultadoAdjudicacion {
  necesidad: Necesidad;
  propuestaAceptada: Propuesta;
  propuestasDescartadas: Propuesta[];
  solicitud: Solicitud;
}

export function adjudicar(input: {
  necesidad: Necesidad;
  propuestas: Propuesta[];
  idPropuestaElegida: number;
  idUsuarioAutor: number;
  ahora: Date;
}): ResultadoAdjudicacion {
  const elegida = input.propuestas.find((p) => p.id === input.idPropuestaElegida);
  if (elegida === undefined) {
    throw AppError.notFound('La propuesta no existe.');
  }
  if (!elegida.vigente) {
    throw AppError.invalidTransition('Esa propuesta ya fue decidida.', ['ENVIADA']);
  }

  // El orden importa: la necesidad valida autor y vigencia, y si falla no se
  // ha tocado ninguna propuesta todavia.
  input.necesidad.adjudicar(input.idUsuarioAutor, input.ahora);
  elegida.aceptar();

  const descartadas = input.propuestas.filter((p) => p.id !== elegida.id && p.descartar());

  const solicitud = Solicitud.porAdjudicacion({
    necesidad: input.necesidad,
    propuesta: elegida,
    idPrestador: elegida.idPrestador,
    ahora: input.ahora,
  });

  return {
    necesidad: input.necesidad,
    propuestaAceptada: elegida,
    propuestasDescartadas: descartadas,
    solicitud,
  };
}

// ─── Puertos de salida ──────────────────────────────────────────────────────
//
// Las interfaces viven junto al dominio que las necesita y las implementaciones
// en infrastructure/. Asi la dependencia apunta hacia adentro: cambiar MySQL por
// otro motor no toca una linea de dominio.
//
// El reloj y el publicador de eventos NO se declaran aqui: los aporta
// @punto-amigo/service-kit (IClock, IEventPublisher).

export interface Pagina<T> {
  elementos: readonly T[];
  total: number;
  pagina: number;
  tamano: number;
}

/** Tope de pagina: sin el, una peticion puede pedir todas las necesidades. */
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

export interface FiltrosNecesidad {
  idCategoria?: number | undefined;
  texto?: string | undefined;
}

export interface INecesidadRepository {
  findById(id: number): Promise<Necesidad | null>;
  save(necesidad: Necesidad, creadoPor: number): Promise<Necesidad>;
  update(necesidad: Necesidad, motivoCierre?: string | null): Promise<void>;
  /** Cuantas tiene abiertas: alimenta el limite anti-abuso (SRS RF125, RNF86). */
  contarAbiertasDe(idUsuario: number, ahora: Date): Promise<number>;
  listarAbiertas(
    filtros: FiltrosNecesidad,
    pagina: number,
    tamano: number
  ): Promise<Pagina<Necesidad>>;
  listarDeAutor(idUsuario: number, pagina: number, tamano: number): Promise<Pagina<Necesidad>>;
}

export interface IPropuestaRepository {
  findById(id: number): Promise<Propuesta | null>;
  /** Todas las de una necesidad. La adjudicacion las necesita juntas. */
  findByNecesidad(idNecesidad: number): Promise<Propuesta[]>;
  save(propuesta: Propuesta, creadoPor: number): Promise<Propuesta>;
  update(propuesta: Propuesta): Promise<void>;
  tieneVigente(idNecesidad: number, idPrestador: number): Promise<boolean>;
  listarDePrestador(
    idPrestador: number,
    pagina: number,
    tamano: number
  ): Promise<Pagina<Propuesta>>;
}

export interface ISolicitudRepository {
  findById(id: number): Promise<Solicitud | null>;
  save(solicitud: Solicitud, creadoPor: number): Promise<Solicitud>;
  update(
    solicitud: Solicitud,
    motivoEstado: string | null,
    completadaAt: Date | null
  ): Promise<void>;
  /** Fecha en que se acepto: la politica de cancelacion mide la gracia desde ahi. */
  aceptadaAt(idSolicitud: number): Promise<Date | null>;
  listarDeUsuario(idUsuario: number, pagina: number, tamano: number): Promise<Pagina<Solicitud>>;
  listarDePrestador(
    idPrestador: number,
    pagina: number,
    tamano: number
  ): Promise<Pagina<Solicitud>>;
}

/** Asiento del historial de una solicitud: append-only (SRS RF70). */
export interface AsientoHistorial {
  idSolicitud: number;
  estadoAnterior: EstadoSolicitud | null;
  estadoNuevo: EstadoSolicitud;
  cambiadoPor: number;
  motivo: string | null;
  fechaCambio: Date;
}

export interface IHistorialRepository {
  registrar(asiento: AsientoHistorial): Promise<void>;
}

/** Lo que se guarda de una cancelacion, ya clasificada e imputada. */
export interface RegistroCancelacion {
  idSolicitud: number;
  parteCanceladora: Actor;
  idUsuarioCancela: number;
  idUsuarioAfectado: number;
  estadoOrigen: EstadoSolicitud;
  codigoMotivo: string;
  detalle: string | null;
  franja: Franja;
  horasDeAntelacion: number | null;
  peso: number;
  computa: boolean;
  idUsuarioImputado: number | null;
  estado: 'REGISTRADA' | 'EN_REVISION';
  canceladaAt: Date;
}

/** Motivo tal como se le ofrece a quien va a cancelar. */
export interface MotivoOfrecido {
  codigo: string;
  descripcion: string;
  /** Si al elegirlo hay que escribir una explicacion. */
  exigeDetalle: boolean;
  /**
   * Si al elegirlo la cancelacion queda en revision en lugar de surtir efecto.
   *
   * Se dice de antemano a proposito. Quien cancela tiene derecho a saber que
   * elegir "la contraparte no se presento" abre una disputa y no es un atajo
   * para no cargar con la cancelacion.
   */
  abreRevision: boolean;
}

export interface ICancelacionRepository {
  /** Catalogo de motivos. Null si el codigo no existe o esta desactivado. */
  buscarMotivo(codigo: string): Promise<MotivoCancelacion | null>;
  /**
   * Los motivos activos, para que el cliente los ofrezca.
   *
   * Hace falta un endpoint porque la tabla existe precisamente para que un
   * administrador pueda anadir o retirar un motivo sin desplegar (RF105). Si el
   * cliente los llevara fijos en su codigo, cambiar la tabla no cambiaria nada
   * de lo que la gente ve, y el acoplamiento que la tabla evita volveria por la
   * puerta de atras.
   *
   * NO expone `computa` ni `trasladaFalta`: son el efecto que decide el
   * servidor, y publicarlos invitaria a elegir el motivo por su efecto en lugar
   * de por lo que paso.
   */
  listarMotivos(): Promise<readonly MotivoOfrecido[]>;
  guardar(registro: RegistroCancelacion): Promise<number>;
}

/** Copia local de un prestador, alimentada por eventos de provider-service. */
export interface PrestadorRef {
  idPrestador: number;
  idUsuario: number;
  nombre: string;
  especialidad: string | null;
  estado: string;
}

/** Copia local de un servicio, alimentada por eventos de catalog-service. */
export interface ServicioRef {
  idServicio: number;
  idPrestador: number;
  idCategoria: number;
  nombreServicio: string;
  estado: string;
}

/**
 * Copia local de un usuario, alimentada por eventos de auth-service.
 *
 * Guarda el contacto porque es de aqui de donde sale lo que se revela cuando
 * hay acuerdo (SRS RF156, RNF84). Pedirselo a auth-service en cada consulta
 * ataria el detalle de una contratacion a que la identidad este levantada, y
 * ademas convertiria ese servicio en un directorio consultable.
 */
export interface UsuarioRef {
  idUsuario: number;
  nombre: string;
  correo: string | null;
  telefono: string | null;
  estado: string;
}

export interface IReplicaRepository {
  usuarioPorId(idUsuario: number): Promise<UsuarioRef | null>;
  upsertUsuario(ref: UsuarioRef): Promise<void>;
  prestadorPorId(idPrestador: number): Promise<PrestadorRef | null>;
  prestadorPorUsuario(idUsuario: number): Promise<PrestadorRef | null>;
  servicioPorId(idServicio: number): Promise<ServicioRef | null>;
  categoriaActiva(idCategoria: number): Promise<boolean>;
  upsertPrestador(ref: PrestadorRef): Promise<void>;
  upsertServicio(ref: ServicioRef): Promise<void>;
  upsertCategoria(ref: {
    idCategoria: number;
    nombreCategoria: string;
    activa: boolean;
  }): Promise<void>;
}
