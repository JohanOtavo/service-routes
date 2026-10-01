import { AppError } from '@punto-amigo/shared';
import {
  Calificacion,
  CONTRATACIONES_MINIMAS_EVALUABLES,
  DIAS_PERIODO_CIEGO_POR_DEFECTO,
  DIRECCIONES,
  FACETAS,
  PeriodoCiego,
  Reputacion,
  TasaCancelacion,
  calcularMedia,
  direccionContraria,
  direccionQueEvalua,
  facetaEvaluada,
  inicioDeVentana,
  nivelDeUmbral,
  normalizarPaginacion,
  promedioDeServicio,
  resolverParte,
  validarCancelacion,
  type CancelacionImputada,
  type Faceta,
  type SolicitudCalificable,
} from '../src/domain';

/**
 * Pruebas del dominio de reputacion.
 *
 * El dominio lo escribio un subagente; estas pruebas comprueban que de verdad
 * hace lo que sus comentarios afirman. Codigo sin verificar no cuenta como
 * construido, venga de donde venga.
 */

const SOLICITANTE = 11;
const OFERENTE = 22;
const AJENO = 99;

const AHORA = new Date('2026-10-01T12:00:00.000Z');
const DIA = 86_400_000;

const completada = (extra: Partial<SolicitudCalificable> = {}): SolicitudCalificable => ({
  idSolicitud: 500,
  idUsuario: SOLICITANTE,
  idUsuarioPrestador: OFERENTE,
  idServicio: 7,
  estado: 'COMPLETADA',
  completadaAt: new Date('2026-09-30T10:00:00.000Z'),
  ...extra,
});

const registrar = (
  idEmisor: number,
  extra: {
    solicitud?: Partial<SolicitudCalificable>;
    puntuacion?: number;
    comentario?: string | null;
    yaCalificoEstaParte?: boolean;
    ahora?: Date;
  } = {}
): Calificacion =>
  Calificacion.registrar({
    solicitud: completada(extra.solicitud ?? {}),
    idEmisor,
    puntuacion: extra.puntuacion ?? 4,
    comentario: extra.comentario,
    yaCalificoEstaParte: extra.yaCalificoEstaParte ?? false,
    ahora: extra.ahora ?? AHORA,
  });

/** Codigo HTTP del AppError que lanza `fn`. Falla si no lanza. */
const estado = (fn: () => unknown): number => {
  try {
    fn();
  } catch (e) {
    return (e as AppError).httpStatus;
  }
  throw new Error('deberia lanzar');
};

describe('direccion y faceta', () => {
  it('cada direccion evalua la faceta de su receptor', () => {
    expect(facetaEvaluada('SOLICITANTE_A_OFERENTE')).toBe('COMO_OFERENTE');
    expect(facetaEvaluada('OFERENTE_A_SOLICITANTE')).toBe('COMO_SOLICITANTE');
  });

  it('direccionQueEvalua es la inversa exacta de facetaEvaluada', () => {
    for (const faceta of FACETAS) {
      expect(facetaEvaluada(direccionQueEvalua(faceta))).toBe(faceta);
    }
    for (const direccion of DIRECCIONES) {
      expect(direccionQueEvalua(facetaEvaluada(direccion))).toBe(direccion);
    }
  });

  it('la contraria aplicada dos veces vuelve al punto de partida', () => {
    for (const direccion of DIRECCIONES) {
      expect(direccionContraria(direccionContraria(direccion))).toBe(direccion);
      expect(direccionContraria(direccion)).not.toBe(direccion);
    }
  });
});

describe('quien puede calificar (SRS RF81, RF164)', () => {
  it('el solicitante califica al oferente', () => {
    expect(resolverParte(completada(), SOLICITANTE)).toEqual({
      direccion: 'SOLICITANTE_A_OFERENTE',
      idReceptor: OFERENTE,
    });
  });

  it('el oferente tambien califica al solicitante', () => {
    expect(resolverParte(completada(), OFERENTE)).toEqual({
      direccion: 'OFERENTE_A_SOLICITANTE',
      idReceptor: SOLICITANTE,
    });
  });

  /**
   * 404 y no 403: un 403 confirma que la solicitud existe, y con eso se pueden
   * recorrer identificadores para descubrir contrataciones de otras personas.
   */
  it('un tercero recibe 404, nunca 403', () => {
    expect(estado(() => resolverParte(completada(), AJENO))).toBe(404);
  });

  it('nadie se califica a si mismo aunque figure en los dos lados', () => {
    const consigoMismo = completada({ idUsuario: SOLICITANTE, idUsuarioPrestador: SOLICITANTE });
    expect(estado(() => resolverParte(consigoMismo, SOLICITANTE))).toBe(409);
  });
});

describe('registro de la calificacion (SRS RF78 a RF82)', () => {
  it('solo una solicitud completada habilita calificar', () => {
    for (const e of ['PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'CANCELADA']) {
      expect(estado(() => registrar(SOLICITANTE, { solicitud: { estado: e } }))).toBe(409);
    }
  });

  /**
   * COMPLETADA sin fecha es una fila a medio sincronizar. Aceptarla dejaria
   * pasar calificaciones sobre contrataciones cuyo cierre no esta confirmado.
   */
  it('COMPLETADA sin completadaAt no vale', () => {
    expect(estado(() => registrar(SOLICITANTE, { solicitud: { completadaAt: null } }))).toBe(409);
  });

  it('cada parte califica una sola vez', () => {
    expect(estado(() => registrar(SOLICITANTE, { yaCalificoEstaParte: true }))).toBe(409);
  });

  it('la puntuacion es un entero de 1 a 5', () => {
    for (const p of [0, 6, -1, 3.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(estado(() => registrar(SOLICITANTE, { puntuacion: p }))).toBe(422);
    }
    for (const p of [1, 2, 3, 4, 5]) {
      expect(registrar(SOLICITANTE, { puntuacion: p }).puntuacion).toBe(p);
    }
  });

  it('un comentario en blanco se guarda como NULL, no como cadena vacia', () => {
    expect(registrar(SOLICITANTE, { comentario: '   ' }).comentario).toBeNull();
    expect(registrar(SOLICITANTE, { comentario: null }).comentario).toBeNull();
    expect(registrar(SOLICITANTE).comentario).toBeNull();
  });

  it('el comentario se recorta y tiene tope de longitud', () => {
    expect(registrar(SOLICITANTE, { comentario: '  buen trabajo  ' }).comentario).toBe(
      'buen trabajo'
    );
    expect(estado(() => registrar(SOLICITANTE, { comentario: 'x'.repeat(1001) }))).toBe(422);
    expect(registrar(SOLICITANTE, { comentario: 'x'.repeat(1000) }).comentario).toHaveLength(1000);
  });

  it('nace oculta: ni publica ni revelada (SRS RF166)', () => {
    const c = registrar(SOLICITANTE);
    expect(c.visibleAt).toBeNull();
    expect(c.enPeriodoCiego).toBe(true);
    expect(c.esPublica).toBe(false);
  });

  it('hereda el servicio de la solicitud, para el promedio por servicio', () => {
    expect(registrar(SOLICITANTE).idServicio).toBe(7);
    expect(registrar(SOLICITANTE, { solicitud: { idServicio: null } }).idServicio).toBeNull();
  });
});

describe('que se publica de una calificacion (SRS RF85, RF166)', () => {
  const revelada = (): Calificacion => {
    const c = registrar(SOLICITANTE, { comentario: 'cumplio' });
    c.revelar(AHORA);
    return c;
  };

  it('la vista publica se niega mientras siga en periodo ciego', () => {
    expect(estado(() => registrar(SOLICITANTE).vistaPublica())).toBe(409);
  });

  it('la vista publica se niega tras retirarla por moderacion', () => {
    const c = revelada();
    c.ocultarPorModeracion();
    expect(c.esPublica).toBe(false);
    expect(estado(() => c.vistaPublica())).toBe(409);
  });

  it('revelada y sin moderar, si se publica', () => {
    expect(revelada().vistaPublica()).toMatchObject({ puntuacion: 4, comentario: 'cumplio' });
  });

  /**
   * Decir que una calificacion fue retirada confirma que existio y que alguien
   * se quejo. Tampoco sale el emisor por el serializador.
   */
  it('no filtra el emisor ni la marca de moderacion', () => {
    const serializada = JSON.stringify(revelada().toJSON());
    expect(serializada).not.toContain('idEmisor');
    expect(serializada).not.toContain('ocultaPorModeracion');
  });
});

describe('periodo ciego (SRS RF166)', () => {
  const ciego = new PeriodoCiego();

  it('no admite un plazo de menos de un dia completo', () => {
    expect(() => new PeriodoCiego(0)).toThrow();
    expect(() => new PeriodoCiego(-1)).toThrow();
    expect(() => new PeriodoCiego(1.5)).toThrow();
    expect(new PeriodoCiego(1)).toBeInstanceOf(PeriodoCiego);
  });

  it('la primera de las dos sigue oculta y no devuelve nada que persistir', () => {
    const primera = registrar(SOLICITANTE);
    expect(ciego.resolverAlRegistrar(primera, null, AHORA)).toEqual([]);
    expect(primera.enPeriodoCiego).toBe(true);
  });

  /** Se revelan juntas: cuando una se ve, la otra ya estaba escrita. */
  it('la segunda revela las dos en el mismo instante', () => {
    const primera = registrar(SOLICITANTE);
    const segunda = registrar(OFERENTE);

    const cambiadas = ciego.resolverAlRegistrar(segunda, primera, AHORA);

    expect(cambiadas).toHaveLength(2);
    expect(primera.visibleAt).toEqual(AHORA);
    expect(segunda.visibleAt).toEqual(AHORA);
    expect(primera.esPublica).toBe(true);
  });

  /**
   * Mover la fecha haria que una calificacion antigua pareciera reciente. El
   * proceso que vence plazos y el registro de la contraparte pueden coincidir.
   */
  it('revelar dos veces conserva la fecha original', () => {
    const c = registrar(SOLICITANTE);
    c.revelar(AHORA);
    c.revelar(new Date(AHORA.getTime() + 5 * DIA));
    expect(c.visibleAt).toEqual(AHORA);
  });

  it('el plazo vence al cumplirse el dia, no antes', () => {
    const c = registrar(SOLICITANTE);
    const vence = new Date(AHORA.getTime() + DIAS_PERIODO_CIEGO_POR_DEFECTO * DIA);

    expect(ciego.venceAt(c)).toEqual(vence);
    expect(ciego.vencio(c, new Date(vence.getTime() - 1))).toBe(false);
    expect(ciego.vencio(c, vence)).toBe(true);
  });

  /** Sin plazo, quien nunca recibe respuesta queda oculto para siempre. */
  it('una ya revelada no vuelve a vencer', () => {
    const c = registrar(SOLICITANTE);
    c.revelar(AHORA);
    expect(ciego.vencio(c, new Date(AHORA.getTime() + 365 * DIA))).toBe(false);
  });

  it('el limite de vencimiento mira hacia atras el mismo plazo', () => {
    expect(ciego.limiteDeVencimiento(AHORA)).toEqual(
      new Date(AHORA.getTime() - DIAS_PERIODO_CIEGO_POR_DEFECTO * DIA)
    );
  });
});

describe('media y reputacion (SRS RF84, RF165, RF167)', () => {
  it('sin calificaciones la media es 0, no NaN', () => {
    expect(calcularMedia({ suma: 0, total: 0 })).toBe(0);
    expect(calcularMedia({ suma: 10, total: -3 })).toBe(0);
  });

  it('redondea a dos decimales, la precision de la columna', () => {
    expect(calcularMedia({ suma: 10, total: 3 })).toBe(3.33);
    expect(calcularMedia({ suma: 11, total: 3 })).toBe(3.67);
    expect(calcularMedia({ suma: 20, total: 4 })).toBe(5);
  });

  /** Se calcula de suma y conteo: arrastrar la media anterior acumula error. */
  it('recalcular da el mismo numero sin importar el orden de llegada', () => {
    const r = Reputacion.recalcular({
      idUsuario: OFERENTE,
      faceta: 'COMO_OFERENTE',
      agregado: { suma: 4 + 5 + 3, total: 3 },
      ahora: AHORA,
    });
    expect(r.puntuacionMedia).toBe(4);
    expect(r.totalCalificaciones).toBe(3);
    expect(r.faceta).toBe('COMO_OFERENTE');
  });

  it('las dos facetas de una persona son independientes', () => {
    const comoOferente = Reputacion.recalcular({
      idUsuario: OFERENTE,
      faceta: 'COMO_OFERENTE',
      agregado: { suma: 25, total: 5 },
      ahora: AHORA,
    });
    const comoSolicitante = Reputacion.recalcular({
      idUsuario: OFERENTE,
      faceta: 'COMO_SOLICITANTE',
      agregado: { suma: 5, total: 5 },
      ahora: AHORA,
    });

    expect(comoOferente.puntuacionMedia).toBe(5);
    expect(comoSolicitante.puntuacionMedia).toBe(1);
  });

  it('el total nunca es negativo ni fraccionario', () => {
    const r = Reputacion.recalcular({
      idUsuario: OFERENTE,
      faceta: 'COMO_OFERENTE',
      agregado: { suma: 0, total: -5 },
      ahora: AHORA,
    });
    expect(r.totalCalificaciones).toBe(0);
  });

  it('el promedio por servicio usa la misma media', () => {
    expect(promedioDeServicio(7, { suma: 10, total: 3 })).toEqual({
      idServicio: 7,
      promedio: 3.33,
      total: 3,
    });
  });
});

describe('paginacion acotada (SRS RF83)', () => {
  it('sin parametros devuelve la primera pagina', () => {
    expect(normalizarPaginacion({})).toEqual({ pagina: 1, tamano: 20 });
  });

  /** Sin tope, una peticion puede pedir todas las calificaciones de golpe. */
  it('nadie pide mas de 50 por pagina', () => {
    expect(normalizarPaginacion({ tamano: 10_000 }).tamano).toBe(50);
  });

  it('corrige pagina y tamano fuera de rango en vez de fallar', () => {
    expect(normalizarPaginacion({ pagina: 0, tamano: 0 })).toEqual({ pagina: 1, tamano: 1 });
    expect(normalizarPaginacion({ pagina: -9, tamano: -9 })).toEqual({ pagina: 1, tamano: 1 });
    expect(normalizarPaginacion({ pagina: 2.9, tamano: 7.9 })).toEqual({ pagina: 2, tamano: 7 });
  });
});

describe('umbrales de cancelacion (SRS RF181 a RF183)', () => {
  it('cada umbral entra justo en su tasa, no un paso antes', () => {
    expect(nivelDeUmbral(0.1499, true)).toBe(0);
    expect(nivelDeUmbral(0.15, true)).toBe(1);
    expect(nivelDeUmbral(0.2999, true)).toBe(1);
    expect(nivelDeUmbral(0.3, true)).toBe(2);
    expect(nivelDeUmbral(0.4999, true)).toBe(2);
    expect(nivelDeUmbral(0.5, true)).toBe(3);
  });

  /** Los pesos pueden pasar de 1; el nivel 3 es el techo. */
  it('una tasa superior a 1 sigue en el nivel 3', () => {
    expect(nivelDeUmbral(1.5, true)).toBe(3);
    expect(nivelDeUmbral(3, true)).toBe(3);
  });

  it('sin muestra suficiente no hay umbral, por alta que sea la tasa', () => {
    expect(nivelDeUmbral(0.9, false)).toBe(0);
  });
});

describe('validacion de la cancelacion imputada (SRS RF178, RF179)', () => {
  const imputada = (extra: Partial<CancelacionImputada> = {}): CancelacionImputada => ({
    idCancelacion: 1,
    idSolicitud: 500,
    idUsuarioImputado: OFERENTE,
    faceta: 'COMO_OFERENTE',
    peso: 1,
    computa: true,
    canceladaAt: AHORA,
    ...extra,
  });

  it('acepta los pesos de la politica tal como los manda request-service', () => {
    for (const peso of [0, 0.5, 1, 1.5]) {
      expect(validarCancelacion(imputada({ peso })).peso).toBe(peso);
    }
  });

  it('rechaza pesos imposibles para la columna DECIMAL(3,2)', () => {
    for (const peso of [-0.5, 10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(estado(() => validarCancelacion(imputada({ peso })))).toBe(422);
    }
  });

  it('rechaza una faceta que no existe', () => {
    expect(
      estado(() => validarCancelacion(imputada({ faceta: 'COMO_LO_QUE_SEA' as Faceta })))
    ).toBe(422);
  });

  /** Una excusada llega con computa=false y peso 0; se guarda igual, para auditoria. */
  it('conserva las excusadas aunque no computen', () => {
    const e = validarCancelacion(imputada({ peso: 0, computa: false }));
    expect(e.computa).toBe(false);
    expect(e.peso).toBe(0);
  });
});

describe('tasa de cancelacion (SRS RF180 a RF183, RF192)', () => {
  const desde = inicioDeVentana(AHORA, 90);
  const nueva = (): TasaCancelacion =>
    TasaCancelacion.inicial(OFERENTE, 'COMO_OFERENTE', desde, AHORA);

  it('nace en cero, no evaluable y no publica', () => {
    const t = nueva();
    expect(t.tasa).toBe(0);
    expect(t.evaluable).toBe(false);
    expect(t.umbralAlcanzado).toBe(0);
    expect(t.esPublica).toBe(false);
  });

  /**
   * Con 4 contrataciones y 3 cancelaciones la tasa seria del 75 % y abriria
   * revision administrativa. Esa muestra no distingue a quien cancela por
   * costumbre de quien tuvo un mal dia.
   */
  it('por debajo del minimo de muestra publica 0 y no dispara nada', () => {
    const t = nueva();
    const cruzado = t.recalcular(
      {
        contrataciones: CONTRATACIONES_MINIMAS_EVALUABLES - 1,
        ponderadas: 3,
        ventanaDesde: desde,
      },
      AHORA
    );

    expect(cruzado).toBeNull();
    expect(t.evaluable).toBe(false);
    expect(t.tasa).toBe(0);
    expect(t.esPublica).toBe(false);
  });

  it('el numerador suma pesos, no cancelaciones', () => {
    const t = nueva();
    // Dos cancelaciones: una el mismo dia (1,5) y otra con margen (0,5).
    t.recalcular({ contrataciones: 10, ponderadas: 1.5 + 0.5, ventanaDesde: desde }, AHORA);
    expect(t.cancelacionesPonderadas).toBe(2);
    expect(t.tasa).toBe(0.2);
  });

  it('la tasa puede pasar de 1 porque los pesos la empujan', () => {
    const t = nueva();
    t.recalcular({ contrataciones: 5, ponderadas: 7.5, ventanaDesde: desde }, AHORA);
    expect(t.tasa).toBe(1.5);
    expect(t.umbralAlcanzado).toBe(3);
  });

  it('devuelve el nivel al cruzarlo', () => {
    const t = nueva();
    expect(t.recalcular({ contrataciones: 10, ponderadas: 2, ventanaDesde: desde }, AHORA)).toBe(1);
  });

  /** Reemitir en cada recalculo convertiria la bandeja administrativa en ruido. */
  it('no reemite si el nivel no sube', () => {
    const t = nueva();
    t.recalcular({ contrataciones: 10, ponderadas: 2, ventanaDesde: desde }, AHORA);
    expect(
      t.recalcular({ contrataciones: 10, ponderadas: 2.5, ventanaDesde: desde }, AHORA)
    ).toBeNull();
    expect(t.umbralAlcanzado).toBe(1);
  });

  it('un salto de dos niveles devuelve el nivel alcanzado, no el siguiente', () => {
    const t = nueva();
    expect(t.recalcular({ contrataciones: 10, ponderadas: 5, ventanaDesde: desde }, AHORA)).toBe(3);
  });

  /**
   * La ventana es movil justamente para esto: lo que sale de ella se resta y la
   * marca se borra. Sin la bajada, una mala racha quedaria para siempre.
   */
  it('al salir cancelaciones de la ventana el nivel baja y deja de ser publica', () => {
    const t = nueva();
    t.recalcular({ contrataciones: 10, ponderadas: 5, ventanaDesde: desde }, AHORA);
    expect(t.esPublica).toBe(true);

    const despues = new Date(AHORA.getTime() + 30 * DIA);
    const movida = inicioDeVentana(despues, 90);
    expect(
      t.recalcular({ contrataciones: 12, ponderadas: 0.5, ventanaDesde: movida }, despues)
    ).toBeNull();

    expect(t.umbralAlcanzado).toBe(0);
    expect(t.esPublica).toBe(false);
    expect(t.ventanaDesde).toEqual(movida);
  });

  /**
   * Publicar el 0 % de todo el mundo no disuade a nadie y si expone a quien
   * cancelo una vez de forma justificada.
   */
  it('solo se publica a partir del primer umbral', () => {
    const t = nueva();
    t.recalcular({ contrataciones: 20, ponderadas: 1, ventanaDesde: desde }, AHORA);
    expect(t.tasa).toBe(0.05);
    expect(t.evaluable).toBe(true);
    expect(t.esPublica).toBe(false);
    expect(JSON.stringify(t.toJSON())).not.toContain('idUsuario');
  });

  it('no acepta contrataciones negativas ni fraccionarias', () => {
    const t = nueva();
    t.recalcular({ contrataciones: -5, ponderadas: -5, ventanaDesde: desde }, AHORA);
    expect(t.contratacionesEnVentana).toBe(0);
    expect(t.cancelacionesPonderadas).toBe(0);
    expect(t.tasa).toBe(0);
  });

  it('la ventana movil arranca el plazo exacto hacia atras', () => {
    expect(inicioDeVentana(AHORA, 90)).toEqual(new Date(AHORA.getTime() - 90 * DIA));
  });
});
