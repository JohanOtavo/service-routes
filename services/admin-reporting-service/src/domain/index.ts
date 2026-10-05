import { AppError } from '@punto-amigo/shared';

/**
 * Dominio de administracion: el asiento de auditoria, los parametros del
 * sistema y las agregaciones de informe.
 *
 * SRS: RF101 a RF116, SRS-ADM-01 a SRS-ADM-13, RNF81.
 *
 * Todo cabe en un archivo por la misma razon que en provider-service: no hay
 * una maquina de estados ni un ciclo de vida que repartir. Lo que hay es un
 * registro que solo se anade, un diccionario de parametros y tres formas de
 * agregar. Partirlo en siete archivos anadiria navegacion sin anadir claridad.
 *
 * Este servicio consulta la base de datos de ningun otro (RF108), con una sola y
 * documentada excepcion: ADR-005 le concede lectura de SELECT, a nivel de tabla, de
 * cinco tablas de `pa_request`, `pa_catalog` y `pa_rating` para calcular las
 * estadisticas. La lista de tablas esta cerrada en el ADR y en el script de
 * aprovisionamiento, que verifica al arrancar que no existe ninguna mas.
 */

/**
 * Resultados admitidos. Coinciden con el CHECK de `audit_record.resultado`.
 *
 * Se declaran aqui ademas de en la migracion porque un valor fuera del conjunto
 * llegaria al motor como un error 500 opaco en lugar de un fallo que diga que
 * esta mal. Si los dos se separan, el asiento se pierde, que es lo peor que
 * puede pasarle a una auditoria.
 */
export const RESULTADOS_AUDITORIA = ['EXITO', 'FALLO', 'DENEGADO'] as const;
export type ResultadoAuditoria = (typeof RESULTADOS_AUDITORIA)[number];

/**
 * Tipos de dato de un parametro (SRS RF105).
 *
 * La columna `system_parameter.tipo_dato` no lleva CHECK en la migracion, asi
 * que esta lista es la unica barrera. Importa porque el valor se guarda como
 * texto: sin declarar de que tipo es, un umbral numerico puede acabar valiendo
 * "dos horas" y el servicio que lo lea fallara al convertirlo, lejos de aqui.
 */
export const TIPOS_PARAMETRO = ['string', 'number', 'boolean'] as const;
export type TipoParametro = (typeof TIPOS_PARAMETRO)[number];

/** Pagina de resultados. El tope lo impone el dominio, no el llamador. */
export interface Pagina<T> {
  elementos: readonly T[];
  total: number;
  pagina: number;
  tamano: number;
}

/**
 * Tope de pagina.
 *
 * Un informe sin tope no es un informe: es una descarga de la base entera por
 * una peticion HTTP, y la auditoria es la tabla que mas crece de todas.
 */
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

// ─── Asiento de auditoria ───────────────────────────────────────────────────

/** Valor admitido dentro de `detalle`: escalares y listas de escalares. */
export type ValorDetalle = string | number | boolean | null | readonly (string | number)[];

/**
 * Asiento de auditoria (SRS RF101).
 *
 * Es un hecho ya ocurrido, no una entidad con ciclo de vida: no tiene metodos
 * que lo cambien porque la tabla no admite UPDATE ni DELETE, y un objeto con
 * setters sugeriria lo contrario a quien lo lea.
 */
export interface AsientoAuditoria {
  /** Cuando paso, no cuando se registro. Viene del sobre del evento. */
  ocurridoAt: Date;
  /** Quien lo hizo. NULL cuando el hecho lo produjo el sistema. */
  idActor: number | null;
  /** Rol con el que actuo. NULL cuando el origen no lo acredita. */
  actorRol: string | null;
  accion: string;
  recursoTipo: string;
  recursoId: string | null;
  resultado: ResultadoAuditoria;
  correlationId: string | null;
  detalle: Readonly<Record<string, ValorDetalle>> | null;
  ipOrigen: string | null;
}

/**
 * Claves que nunca se guardan, pase lo que pase.
 *
 * Es una SEGUNDA barrera. La primera es que cada manejador construye `detalle`
 * nombrando los campos uno a uno, sin volcar el payload entero. Esta existe
 * porque esa disciplina se pierde en cuanto alguien anada un `...payload` con
 * prisa, y entonces un correo o un token quedarian escritos en una tabla que
 * por diseno no se puede corregir: el error seria permanente.
 */
const CLAVES_SENSIBLES =
  /(pass|contrasen|secret|token|jwt|refresh|credential|hash|salt|correo|e?mail|telefono|phone|celular|documento|cedula|direccion)/iu;

/**
 * Si un NOMBRE suena a secreto o a dato personal.
 *
 * `depurarDetalle` lo aplica a las claves del detalle, pero se exporta porque
 * hay un caso que esa funcion no puede ver: cuando el nombre sensible viaja
 * como VALOR. Al auditar un parametro del sistema, el detalle lleva
 * `{clave, anterior, nuevo}`; ninguna de esas tres claves suena a secreto, y
 * sin embargo el valor de `nuevo` puede ser la contrasena del SMTP si la
 * `clave` se llama SMTP_PASSWORD. Quien construye ese detalle tiene que
 * preguntarlo por el nombre del parametro, no por el de sus campos.
 */
export function nombreSensible(nombre: string): boolean {
  return CLAVES_SENSIBLES.test(nombre);
}

/** Marca visible de lo que se descarto. Omitir en silencio esconde el fallo. */
const OMITIDO = '[omitido]';

/** Topes del detalle: una auditoria no es un almacen de cargas utiles. */
const MAX_CLAVES_DETALLE = 20;
const MAX_TEXTO_DETALLE = 500;
const MAX_ELEMENTOS_LISTA = 20;

/**
 * Deja el detalle en algo que se pueda guardar sin arrepentirse.
 *
 * Descarta en lugar de lanzar a proposito. Lanzar mandaria el evento a la cola
 * de fallidos y el asiento no se escribiria: perder la entrada completa es peor
 * que perder un campo de contexto, porque lo que la auditoria demuestra es que
 * la accion ocurrio, no sus detalles.
 *
 * Solo admite escalares y listas de escalares. Un objeto anidado se marca como
 * omitido en vez de recorrerse: un payload anidado puede traer cualquier cosa a
 * cualquier profundidad, y una regla que hay que aplicar recursivamente es una
 * regla que tarde o temprano se aplica mal.
 */
export function depurarDetalle(
  bruto: Readonly<Record<string, unknown>> | null
): Readonly<Record<string, ValorDetalle>> | null {
  if (bruto === null) return null;

  const salida: Record<string, ValorDetalle> = {};

  for (const clave of Object.keys(bruto).slice(0, MAX_CLAVES_DETALLE)) {
    if (CLAVES_SENSIBLES.test(clave)) {
      salida[clave] = OMITIDO;
      continue;
    }

    const valor = bruto[clave];

    if (valor === null || valor === undefined) {
      salida[clave] = null;
    } else if (typeof valor === 'string') {
      salida[clave] = valor.slice(0, MAX_TEXTO_DETALLE);
    } else if (typeof valor === 'number' && Number.isFinite(valor)) {
      salida[clave] = valor;
    } else if (typeof valor === 'boolean') {
      salida[clave] = valor;
    } else if (Array.isArray(valor)) {
      salida[clave] = valor
        .slice(0, MAX_ELEMENTOS_LISTA)
        .filter((e): e is string | number => typeof e === 'string' || typeof e === 'number')
        .map((e) => (typeof e === 'string' ? e.slice(0, MAX_TEXTO_DETALLE) : e));
    } else {
      salida[clave] = OMITIDO;
    }
  }

  return Object.keys(salida).length === 0 ? null : salida;
}

/** Topes que vienen de la migracion de `audit_record`. */
const LARGO_ACCION = 80;
const LARGO_RECURSO_TIPO = 40;
const LARGO_RECURSO_ID = 64;
const LARGO_ACTOR_ROL = 30;
const LARGO_IP = 45;

/** Datos con los que se pide un asiento, antes de normalizarlos. */
export interface DatosAsiento {
  ocurridoAt: Date;
  idActor?: number | null | undefined;
  actorRol?: string | null | undefined;
  accion: string;
  recursoTipo: string;
  recursoId?: string | number | null | undefined;
  resultado: ResultadoAuditoria;
  correlationId?: string | null | undefined;
  detalle?: Readonly<Record<string, unknown>> | null | undefined;
  ipOrigen?: string | null | undefined;
}

/**
 * Construye el asiento ya depurado y recortado a lo que la tabla acepta.
 *
 * Unico camino para crear uno. Recortar aqui y no en el repositorio evita que
 * un texto largo haga fallar el INSERT con un error del motor: en la ruta de
 * un evento eso derivaria el mensaje a la cola de fallidos y la plataforma
 * perderia la prueba de que la accion ocurrio.
 *
 * `accion` y `recursoTipo` si pueden lanzar: estan vacios solo si el programa
 * los olvido, y un asiento sin accion no documenta nada.
 */
export function crearAsiento(datos: DatosAsiento): AsientoAuditoria {
  const accion = datos.accion.trim();
  const recursoTipo = datos.recursoTipo.trim();

  if (accion.length === 0 || recursoTipo.length === 0) {
    throw AppError.validation('Un asiento de auditoria necesita accion y tipo de recurso.', [
      { field: 'accion', message: 'Obligatorio.' },
      { field: 'recursoTipo', message: 'Obligatorio.' },
    ]);
  }

  return {
    ocurridoAt: datos.ocurridoAt,
    idActor: datos.idActor ?? null,
    actorRol: recortar(datos.actorRol, LARGO_ACTOR_ROL),
    accion: accion.slice(0, LARGO_ACCION),
    recursoTipo: recursoTipo.slice(0, LARGO_RECURSO_TIPO),
    recursoId:
      datos.recursoId === null || datos.recursoId === undefined
        ? null
        : String(datos.recursoId).slice(0, LARGO_RECURSO_ID),
    resultado: datos.resultado,
    correlationId: datos.correlationId ?? null,
    detalle: depurarDetalle(datos.detalle ?? null),
    ipOrigen: recortar(datos.ipOrigen, LARGO_IP),
  };
}

function recortar(valor: string | null | undefined, largo: number): string | null {
  if (valor === null || valor === undefined) return null;
  const limpio = valor.trim();
  return limpio.length === 0 ? null : limpio.slice(0, largo);
}

// ─── Consulta de la bitacora ────────────────────────────────────────────────

/**
 * Campos por los que se puede ordenar la bitacora (SRS RF102).
 *
 * Lista blanca y no el texto que llegue: ORDER BY no admite parametros, asi
 * que el nombre de columna acaba concatenado al SQL sin remedio. Validarlo
 * contra esta lista es lo unico que separa un filtro de una inyeccion.
 *
 * Son dos fechas distintas a proposito: `ocurrido_at` responde "cuando paso" y
 * `registrado_at` responde "cuando lo supimos". Investigar un retraso en la
 * cola de eventos necesita la segunda.
 */
export const CAMPOS_ORDEN_AUDITORIA = ['ocurrido_at', 'registrado_at'] as const;
export type CampoOrdenAuditoria = (typeof CAMPOS_ORDEN_AUDITORIA)[number];

export const SENTIDOS_ORDEN = ['asc', 'desc'] as const;
export type SentidoOrden = (typeof SENTIDOS_ORDEN)[number];

/**
 * Filtros de la bitacora (SRS RF102).
 *
 * Cada uno corresponde a un indice de la migracion. No se admiten filtros
 * libres sobre `detalle`: la columna es JSON y sin indice, de modo que
 * cualquier busqueda dentro de ella recorreria la tabla entera.
 */
export interface FiltroAuditoria {
  desde?: Date | undefined;
  hasta?: Date | undefined;
  idActor?: number | undefined;
  accion?: string | undefined;
  recursoTipo?: string | undefined;
  recursoId?: string | undefined;
  resultado?: ResultadoAuditoria | undefined;
  correlationId?: string | undefined;
}

/** Asiento ya persistido: lleva ademas lo que asigna la base. */
export interface AsientoRegistrado extends AsientoAuditoria {
  id: number;
  registradoAt: Date;
}

/**
 * Comprueba que el rango de fechas tenga sentido antes de ir a la base.
 *
 * Un rango invertido no es un error del motor sino una peticion mal formada, y
 * devuelve cero filas en silencio: el administrador concluiria que no hubo
 * actividad cuando lo que pasa es que escribio las fechas al reves.
 */
export function exigirRangoValido(desde?: Date | undefined, hasta?: Date | undefined): void {
  if (desde !== undefined && hasta !== undefined && desde.getTime() > hasta.getTime()) {
    throw AppError.validation('El rango de fechas no es valido.', [
      { field: 'desde', message: 'La fecha inicial debe ser anterior a la final.' },
    ]);
  }
}

// ─── Parametros del sistema ─────────────────────────────────────────────────

/** Parametro del sistema, tal como vive en `system_parameter` (SRS RF105). */
export interface ParametroSistema {
  clave: string;
  valor: string;
  descripcion: string | null;
  tipoDato: TipoParametro;
  actualizadoAt: Date | null;
  /** Administrador que lo dio de alta. NULL si lo escribio el sistema. */
  creadoPor: number | null;
}

/** Topes que vienen de la migracion de `system_parameter`. */
const LARGO_CLAVE = 80;
const LARGO_VALOR = 500;
const LARGO_DESCRIPCION = 255;

/**
 * Forma de la clave: mayusculas, digitos y guion bajo.
 *
 * Los parametros los leen otros servicios por su nombre exacto. Admitir
 * espacios o acentos haria que `UMBRAL CANCELACION` y `UMBRAL_CANCELACION`
 * convivieran como dos parametros distintos, y el servicio que buscara uno
 * leeria siempre el valor por defecto sin enterarse de que el administrador
 * cambio el otro.
 */
const FORMA_CLAVE = /^[A-Z][A-Z0-9_]{1,79}$/u;

/**
 * Normaliza y valida un parametro antes de escribirlo (SRS RF105).
 *
 * El valor se guarda como texto porque la columna es texto, pero se comprueba
 * contra el tipo declarado: un umbral que diga `tipo_dato: number` y valga
 * "pronto" romperia al servicio que lo convierta, en otro proceso y mucho
 * despues, con un error que no apunta aqui.
 */
export function normalizarParametro(entrada: {
  clave: string;
  valor: string;
  descripcion?: string | null | undefined;
  tipoDato: TipoParametro;
}): { clave: string; valor: string; descripcion: string | null; tipoDato: TipoParametro } {
  const errores: { field: string; message: string }[] = [];

  const clave = entrada.clave.trim().toUpperCase();
  if (!FORMA_CLAVE.test(clave)) {
    errores.push({
      field: 'clave',
      message: 'Use mayusculas, digitos y guion bajo, entre 2 y 80 caracteres.',
    });
  }

  const valor = entrada.valor.trim();
  if (valor.length === 0 || valor.length > LARGO_VALOR) {
    errores.push({ field: 'valor', message: `Entre 1 y ${LARGO_VALOR} caracteres.` });
  } else if (entrada.tipoDato === 'number' && !/^-?\d+(\.\d+)?$/u.test(valor)) {
    errores.push({ field: 'valor', message: 'El parametro se declaro numerico.' });
  } else if (entrada.tipoDato === 'boolean' && valor !== 'true' && valor !== 'false') {
    errores.push({ field: 'valor', message: 'El parametro se declaro booleano: true o false.' });
  }

  const descripcion =
    entrada.descripcion === null || entrada.descripcion === undefined
      ? null
      : entrada.descripcion.trim().slice(0, LARGO_DESCRIPCION) || null;

  if (errores.length > 0) {
    throw AppError.validation('El parametro del sistema no es valido.', errores);
  }

  return { clave: clave.slice(0, LARGO_CLAVE), valor, descripcion, tipoDato: entrada.tipoDato };
}

// ─── Agregaciones de informe ────────────────────────────────────────────────
//
// Solo hay tres formas de informe porque solo hay tres tablas de `pa_admin` con
// datos que informar: `audit_record`, `statistics_snapshot` y `backup_record`.
// Los informes por rol, por categoria, por estado de solicitud y por
// calificacion (RF109 a RF112) necesitan datos que hoy NO estan replicados
// aqui, y este servicio no puede ir a buscarlos a otro esquema (RF108). Se
// quedan sin implementar a proposito, no por olvido.

/** Un renglon del informe de actividad: cuantas veces y con que resultado. */
export interface ResumenAccion {
  accion: string;
  resultado: ResultadoAuditoria;
  total: number;
}

/** Actividad agregada por dia, para dibujar la serie (SRS RF115). */
export interface ActividadDiaria {
  fecha: string;
  total: number;
}

/**
 * Informe consolidado de actividad (SRS RF115, SRS-ADM-04).
 *
 * Se construye sobre `audit_record`, que es la unica tabla de este esquema que
 * un evento consumido alimenta hoy.
 */
export interface InformeActividad {
  desde: string | null;
  hasta: string | null;
  totalAsientos: number;
  porAccion: readonly ResumenAccion[];
  porDia: readonly ActividadDiaria[];
}

/** Punto de la serie de una metrica precalculada (SRS §7.5, RF113). */
export interface PuntoSerie {
  fecha: string;
  metrica: string;
  dimension: string;
  valor: number;
}

/** Estado de un respaldo y de su prueba de restauracion (SRS RF106, RF107). */
export interface EstadoRespaldo {
  id: number;
  esquema: string;
  iniciadoAt: Date;
  finalizadoAt: Date | null;
  exitoso: boolean | null;
  tamanoBytes: number | null;
  ubicacion: string | null;
  error: string | null;
  restauracionProbadaAt: Date | null;
}

// ─── Puertos de salida ──────────────────────────────────────────────────────
//
// Las interfaces viven junto al dominio que las necesita y las
// implementaciones en infrastructure/. Asi la dependencia apunta hacia adentro.
//
// El reloj y el publicador de eventos NO se declaran aqui: los aporta
// @punto-amigo/service-kit (IClock, IEventPublisher) y duplicar su interfaz
// solo crearia dos contratos que divergen.

/**
 * Bitacora de auditoria (SRS RF101, RF102, RF103).
 *
 * El puerto NO declara `update` ni `delete`, y esa ausencia es la regla: una
 * bitacora corregible no prueba nada. Las correcciones se hacen anadiendo otro
 * asiento. La base lo impone ademas con dos disparadores, pero el puerto tiene
 * que decir lo mismo: si solo lo dijera la base, el programa seguiria pudiendo
 * intentarlo y el fallo saldria como un error 500 en produccion.
 */
export interface IAuditRepository {
  registrar(asiento: AsientoAuditoria): Promise<void>;
  consultar(
    filtros: FiltroAuditoria,
    orden: { campo: CampoOrdenAuditoria; sentido: SentidoOrden },
    pagina: number,
    tamano: number
  ): Promise<Pagina<AsientoRegistrado>>;
  /** Agregado por accion y resultado, acotado por rango de fechas (RF113). */
  resumirPorAccion(
    filtros: Pick<FiltroAuditoria, 'desde' | 'hasta'>,
    limite: number
  ): Promise<readonly ResumenAccion[]>;
  /** Serie diaria de asientos, para la vista consolidada (RF115). */
  resumirPorDia(
    filtros: Pick<FiltroAuditoria, 'desde' | 'hasta'>,
    limite: number
  ): Promise<readonly ActividadDiaria[]>;
  contar(filtros: Pick<FiltroAuditoria, 'desde' | 'hasta'>): Promise<number>;
}

export interface IParameterRepository {
  listar(pagina: number, tamano: number): Promise<Pagina<ParametroSistema>>;
  buscar(clave: string): Promise<ParametroSistema | null>;
  /**
   * Alta o cambio de un parametro.
   *
   * Es un upsert y no un update porque la migracion no siembra ninguna fila: si
   * solo se pudiera actualizar lo existente, la tabla se quedaria vacia para
   * siempre y RF105 no se podria cumplir por ninguna via.
   */
  guardar(
    parametro: Pick<ParametroSistema, 'clave' | 'valor' | 'descripcion' | 'tipoDato'>,
    idAdministrador: number
  ): Promise<ParametroSistema>;
}

export interface IStatisticsRepository {
  /** Serie de una metrica precalculada, acotada por fechas (RF113). */
  serie(
    consulta: {
      metrica: string;
      dimension?: string | undefined;
      desde?: Date | undefined;
      hasta?: Date | undefined;
    },
    pagina: number,
    tamano: number
  ): Promise<Pagina<PuntoSerie>>;
  /** Metricas disponibles: sin esto el administrador tendria que adivinarlas. */
  metricas(): Promise<readonly string[]>;
}

/**
 * Una metrica del catalogo, con su formula escrita.
 *
 * La formula va en el dominio y no en la consulta SQL a proposito: es lo que
 * permite responder "como se calcula esto" sin abrir el infraestructura, y es lo
 * que traveling se documenta para el administrador. Una metrica sin
 * formula declarada no entra en el catalogo.
 */
export interface DefinicionMetrica {
  /** Identificador almacenado en `statistics_snapshot.metrica` (varchar 60). */
  nombre: string;
  descripcion: string;
  /** Formula legible, expuesta al administrador en la API de metricas. */
  formula: string;
  /**
   * `diaria` cuenta hechos ocurridos ese dia, asi que admite historico.
   * `instantanea` es el estado del mundo en la fecha del calculo: se puede
   * repetir hoy y dara otro valor, y no tiene sentido promediarse.
   */
  granularidad: 'diaria' | 'instantanea';
  /** Eje de desglose, o null si la metrica solo admite un total. */
  dimension: string | null;
  /** Tablas ajenas a `pa_admin` que esta metrica necesita leer (ADR-005). */
  requiere: readonly string[];
}

/** Un valor calculado, listo para guardarse en la instantanea diaria. */
export interface PuntoCalculado {
  metrica: string;
  /** `TOTAL` es el agregado; cualquier otro valor es un corte por dimension. */
  dimension: string;
  valor: number;
}

/**
 * Lee los datos de origen y produce los puntos de las metricas pedidas.
 *
 * Vive como puerto y no como caso de uso porque el calculo es SQL: interesan los
 * tests de integracion contra el dato real, no una suite de unitarios sobre una
 * formula que en realidad no se ejecuta aqui.
 */
export interface IEstadisticasCalculadora {
  calcular(nombre: string, fecha: string): Promise<readonly PuntoCalculado[]>;
}

/**
 * Guarda los puntos de una fecha. Debe ser idempotente: el calculo corre cada
 * vez que el proceso arranca y luego en cada tick, y las dos vueltas tienen que
 * dejar el mismo estado, no duplicar filas.
 */
export interface IEstadisticasSnapshotRepository {
  guardar(fecha: string, puntos: readonly PuntoCalculado[], calculadoAt: Date): Promise<number>;
}

export interface IBackupRepository {
  listar(
    filtros: { esquema?: string | undefined; desde?: Date | undefined; hasta?: Date | undefined },
    pagina: number,
    tamano: number
  ): Promise<Pagina<EstadoRespaldo>>;
}
