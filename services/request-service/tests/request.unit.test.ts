import { AppError } from '@punto-amigo/shared';
import {
  Necesidad,
  Propuesta,
  Solicitud,
  adjudicar,
  clasificarCancelacion,
  resolverImputacion,
  transicionesDesde,
  PARAMETROS_POR_DEFECTO,
} from '../src/domain';

const AHORA = new Date('2026-10-01T10:00:00.000Z');
const dias = (n: number): Date => new Date(AHORA.getTime() + n * 86_400_000);

const BASE = {
  titulo: 'Fuga de agua bajo el lavaplatos',
  descripcion: 'Gotea desde hace dos dias y moja el mueble inferior.',
  idUsuario: 1,
  idCategoria: 5,
  categoriaActiva: true,
  abiertasDelUsuario: 0,
  maximoAbiertas: 5,
  diasVigencia: 14,
  ahora: AHORA,
};

/** Publica y asigna id, como haria el repositorio al persistir. */
function necesidadConId(id = 1, extra: Partial<typeof BASE> = {}): Necesidad {
  const n = Necesidad.publicar({ ...BASE, ...extra });
  (n as unknown as { props: { id: number } }).props.id = id;
  return n;
}

function propuestaConId(
  id: number,
  n: Necesidad,
  idPrestador: number,
  idUsuarioPrestador: number,
  precio = '230000'
): Propuesta {
  const p = Propuesta.enviar({
    necesidad: n,
    idPrestador,
    idUsuarioPrestador,
    estadoPrestador: 'ACTIVE',
    precio,
    tiempoEstimado: 3,
    mensaje: 'Puedo atenderlo el jueves por la manana.',
    yaTienePropuestaVigente: false,
    ahora: AHORA,
  });
  (p as unknown as { props: { id: number } }).props.id = id;
  return p;
}

describe('publicacion de necesidad', () => {
  it('nace ABIERTA y vigente', () => {
    const n = necesidadConId();
    expect(n.estado).toBe('ABIERTA');
    expect(n.estaAbierta(AHORA)).toBe(true);
  });

  it('respeta el limite de necesidades abiertas (SRS RF125)', () => {
    expect(() => Necesidad.publicar({ ...BASE, abiertasDelUsuario: 5, maximoAbiertas: 5 })).toThrow(
      AppError
    );
  });

  it('rechaza categoria inactiva y fecha deseada en el pasado', () => {
    expect(() => Necesidad.publicar({ ...BASE, categoriaActiva: false })).toThrow(AppError);
    expect(() => Necesidad.publicar({ ...BASE, fechaDeseada: dias(-1) })).toThrow(AppError);
  });

  it('vencida deja de estar abierta aunque su estado siga siendo ABIERTA', () => {
    expect(necesidadConId().estaAbierta(dias(15))).toBe(false);
  });

  it('la vista publica no lleva al autor ni contacto (SRS RF136)', () => {
    const publico = necesidadConId().toPublicJSON();
    expect(publico['idUsuario']).toBeUndefined();
    expect(JSON.stringify(publico)).not.toContain('contacto');
  });

  it('solo el autor edita; otro recibe 404 y no 403', () => {
    try {
      necesidadConId().editar(999, AHORA, { titulo: 'Secuestrada por otro' });
      throw new Error('deberia lanzar');
    } catch (e) {
      expect((e as AppError).httpStatus).toBe(404);
    }
  });
});

describe('propuestas', () => {
  it('el autor no puede proponer sobre su propia necesidad', () => {
    expect(() =>
      Propuesta.enviar({
        necesidad: necesidadConId(),
        idPrestador: 10,
        idUsuarioPrestador: 1,
        estadoPrestador: 'ACTIVE',
        precio: '100',
        tiempoEstimado: 1,
        mensaje: 'me la adjudico yo mismo',
        yaTienePropuestaVigente: false,
        ahora: AHORA,
      })
    ).toThrow(AppError);
  });

  it('exige perfil de prestador ACTIVE', () => {
    expect(() =>
      Propuesta.enviar({
        necesidad: necesidadConId(),
        idPrestador: 10,
        idUsuarioPrestador: 2,
        estadoPrestador: 'PENDING_VALIDATION',
        precio: '100',
        tiempoEstimado: 1,
        mensaje: 'sin validar todavia',
        yaTienePropuestaVigente: false,
        ahora: AHORA,
      })
    ).toThrow(AppError);
  });

  it('una sola propuesta vigente por oferente y necesidad (SRS RF139)', () => {
    expect(() =>
      Propuesta.enviar({
        necesidad: necesidadConId(),
        idPrestador: 10,
        idUsuarioPrestador: 2,
        estadoPrestador: 'ACTIVE',
        precio: '100',
        tiempoEstimado: 1,
        mensaje: 'segunda propuesta a la vez',
        yaTienePropuestaVigente: true,
        ahora: AHORA,
      })
    ).toThrow(AppError);
  });

  it('no admite propuestas sobre una necesidad vencida', () => {
    expect(() =>
      Propuesta.enviar({
        necesidad: necesidadConId(),
        idPrestador: 10,
        idUsuarioPrestador: 2,
        estadoPrestador: 'ACTIVE',
        precio: '100',
        tiempoEstimado: 1,
        mensaje: 'llego demasiado tarde',
        yaTienePropuestaVigente: false,
        ahora: dias(20),
      })
    ).toThrow(AppError);
  });

  it('otro oferente no modifica ni retira la propuesta ajena', () => {
    const n = necesidadConId();
    const p = propuestaConId(1, n, 10, 2);
    expect(() => p.modificar(99, { precio: '1' })).toThrow(AppError);
    expect(() => p.retirar(99)).toThrow(AppError);
  });
});

describe('adjudicacion', () => {
  function escenario(): { n: Necesidad; propuestas: Propuesta[] } {
    const n = necesidadConId(1);
    return {
      n,
      propuestas: [
        propuestaConId(1, n, 10, 2, '230000'),
        propuestaConId(2, n, 11, 3, '210000'),
        propuestaConId(3, n, 12, 4, '250000'),
      ],
    };
  }

  it('acepta una, descarta el resto y produce la solicitud, todo junto', () => {
    const { n, propuestas } = escenario();
    const r = adjudicar({
      necesidad: n,
      propuestas,
      idPropuestaElegida: 2,
      idUsuarioAutor: 1,
      ahora: AHORA,
    });

    expect(r.necesidad.estado).toBe('ADJUDICADA');
    expect(r.propuestaAceptada.estado).toBe('ACEPTADA');
    expect(r.propuestasDescartadas.map((p) => p.id).sort()).toEqual([1, 3]);
    expect(r.propuestasDescartadas.every((p) => p.estado === 'DESCARTADA')).toBe(true);
  });

  /** REQUEST-INV-004: el acuerdo ya existe; pedir aceptacion lo dejaria colgado. */
  it('la solicitud nace ACEPTADA, nunca PENDIENTE', () => {
    const { n, propuestas } = escenario();
    const r = adjudicar({
      necesidad: n,
      propuestas,
      idPropuestaElegida: 2,
      idUsuarioAutor: 1,
      ahora: AHORA,
    });

    expect(r.solicitud.estado).toBe('ACEPTADA');
    expect(r.solicitud.origen).toBe('ADJUDICACION');
  });

  it('congela precio y plazo de la propuesta ganadora (REQUEST-INV-009)', () => {
    const { n, propuestas } = escenario();
    const r = adjudicar({
      necesidad: n,
      propuestas,
      idPropuestaElegida: 2,
      idUsuarioAutor: 1,
      ahora: AHORA,
    });
    const json = r.solicitud.toJSON(false);

    expect(json['valorAcordado']).toBe('210000');
    expect(json['plazoAcordado']).toBe(3);
  });

  /** Si la validacion falla, ninguna propuesta puede haber cambiado. */
  it('un autor distinto no adjudica y no deja nada a medias', () => {
    const { n, propuestas } = escenario();
    expect(() =>
      adjudicar({
        necesidad: n,
        propuestas,
        idPropuestaElegida: 2,
        idUsuarioAutor: 999,
        ahora: AHORA,
      })
    ).toThrow(AppError);

    expect(n.estado).toBe('ABIERTA');
    expect(propuestas.every((p) => p.estado === 'ENVIADA')).toBe(true);
  });

  it('no se adjudica dos veces la misma necesidad', () => {
    const { n, propuestas } = escenario();
    adjudicar({ necesidad: n, propuestas, idPropuestaElegida: 2, idUsuarioAutor: 1, ahora: AHORA });
    expect(() =>
      adjudicar({
        necesidad: n,
        propuestas,
        idPropuestaElegida: 1,
        idUsuarioAutor: 1,
        ahora: AHORA,
      })
    ).toThrow(AppError);
  });

  /**
   * Los dias extra se suman a lo que QUEDABA, no desde hoy. Fijarla en hoy mas
   * N acortaria el plazo cuando la retractacion llega pronto, y la reparacion
   * dejaria al solicitante peor que antes de adjudicar.
   */
  it('reabrir nunca acorta la vigencia, aunque la retractacion llegue el primer dia', () => {
    const n = necesidadConId(1, { diasVigencia: 30 });
    const original = n.fechaVigencia.getTime();
    n.adjudicar(BASE.idUsuario, dias(1));

    n.reabrir(dias(1), 15);

    expect(n.estado).toBe('ABIERTA');
    expect(n.fechaVigencia.getTime()).toBe(original + 15 * 86_400_000);
  });

  /** Si ya habia caducado esperando, el plazo arranca desde hoy. */
  it('reabrir una necesidad ya caducada cuenta los dias desde hoy', () => {
    const n = necesidadConId(1, { diasVigencia: 10 });
    n.adjudicar(BASE.idUsuario, dias(1));

    const tarde = dias(40);
    n.reabrir(tarde, 15);

    expect(n.fechaVigencia.getTime()).toBe(tarde.getTime() + 15 * 86_400_000);
  });

  it('reabrir devuelve la necesidad a ABIERTA y amplia la vigencia (SRS RF184)', () => {
    const { n, propuestas } = escenario();
    adjudicar({ necesidad: n, propuestas, idPropuestaElegida: 2, idUsuarioAutor: 1, ahora: AHORA });

    const vigenciaPrevia = n.fechaVigencia.getTime();
    n.reabrir(dias(3), 14);

    expect(n.estado).toBe('ABIERTA');
    expect(n.fechaVigencia.getTime()).toBeGreaterThan(vigenciaPrevia);
  });
});

describe('ciclo de vida de la solicitud', () => {
  const directa = (): Solicitud =>
    Solicitud.directa({
      descripcionProblema: 'Se tapo el desague de la cocina',
      idUsuario: 1,
      idPrestador: 10,
      idServicio: 500,
      servicioActivo: true,
      ahora: AHORA,
    });

  it('el oferente acepta y completa', () => {
    const s = directa();
    s.cambiarEstado('ACEPTADA', 'OFERENTE');
    s.cambiarEstado('COMPLETADA', 'OFERENTE');
    expect(s.estado).toBe('COMPLETADA');
  });

  it('el solicitante NO puede aceptar su propia solicitud', () => {
    expect(() => directa().cambiarEstado('ACEPTADA', 'SOLICITANTE')).toThrow(AppError);
  });

  it('el oferente puede retractarse tras aceptar (SRS 10.2)', () => {
    const s = directa();
    s.cambiarEstado('ACEPTADA', 'OFERENTE');
    s.cambiarEstado('CANCELADA', 'OFERENTE');
    expect(s.estado).toBe('CANCELADA');
  });

  it('los estados terminales no admiten nada mas', () => {
    const s = directa();
    s.cambiarEstado('RECHAZADA', 'OFERENTE');
    expect(transicionesDesde('RECHAZADA')).toEqual([]);
    expect(() => s.cambiarEstado('ACEPTADA', 'OFERENTE')).toThrow(AppError);
  });

  it('un tercero no es ni solicitante ni oferente: 404', () => {
    try {
      directa().actorDe(999, 77);
      throw new Error('deberia lanzar');
    } catch (e) {
      expect((e as AppError).httpStatus).toBe(404);
    }
  });

  it('el contacto no viaja hasta que se revela (SRS RNF84)', () => {
    const s = directa();
    expect(s.toJSON(false, { telefono: '3001112233' })['contacto']).toBeNull();
    expect(s.toJSON(true, { telefono: '3001112233' })['contacto']).toEqual({
      telefono: '3001112233',
    });
  });

  it('rechaza una solicitud sobre un servicio inactivo', () => {
    expect(() =>
      Solicitud.directa({
        descripcionProblema: 'Se tapo el desague',
        idUsuario: 1,
        idPrestador: 10,
        idServicio: 500,
        servicioActivo: false,
        ahora: AHORA,
      })
    ).toThrow(AppError);
  });
});

describe('politica de cancelacion', () => {
  const aceptada = AHORA;

  it('dentro de la gracia no computa, sea cual sea el motivo', () => {
    const c = clasificarCancelacion({
      aceptadaAt: aceptada,
      fechaAcordada: dias(5),
      ahora: new Date(aceptada.getTime() + 3_600_000),
    });
    expect(c.franja).toBe('GRACIA');
    expect(c.peso).toBe(0);
  });

  it('el peso crece al acercarse la fecha acordada', () => {
    const base = { aceptadaAt: aceptada, parametros: PARAMETROS_POR_DEFECTO };
    const holgada = clasificarCancelacion({ ...base, fechaAcordada: dias(10), ahora: dias(1) });
    const ajustada = clasificarCancelacion({ ...base, fechaAcordada: dias(10), ahora: dias(9) });
    const tardia = clasificarCancelacion({ ...base, fechaAcordada: dias(10), ahora: dias(11) });

    expect(holgada.franja).toBe('HOLGADA');
    expect(ajustada.franja).toBe('AJUSTADA');
    expect(tardia.franja).toBe('TARDIA');
    expect(holgada.peso).toBeLessThan(ajustada.peso);
    expect(ajustada.peso).toBeLessThan(tardia.peso);
  });

  it('sin fecha acordada no hay proximidad que medir: cuenta como holgada', () => {
    expect(
      clasificarCancelacion({ aceptadaAt: aceptada, fechaAcordada: null, ahora: dias(5) }).franja
    ).toBe('HOLGADA');
  });

  it('un motivo normal se imputa a quien cancela', () => {
    const r = resolverImputacion({
      motivo: {
        codigo: 'NO_PUEDO_ATENDERLO',
        computa: true,
        trasladaFalta: false,
        exigeValidacion: false,
        exigeDetalle: false,
      },
      franja: 'AJUSTADA',
      idUsuarioCancela: 2,
      idUsuarioAfectado: 1,
    });
    expect(r).toEqual({ computa: true, idUsuarioImputado: 2, requiereRevision: false });
  });

  it('la incomparecencia traslada la falta y abre revision', () => {
    const r = resolverImputacion({
      motivo: {
        codigo: 'CONTRAPARTE_NO_SE_PRESENTO',
        computa: false,
        trasladaFalta: true,
        exigeValidacion: false,
        exigeDetalle: false,
      },
      franja: 'TARDIA',
      idUsuarioCancela: 2,
      idUsuarioAfectado: 1,
    });
    expect(r.idUsuarioImputado).toBe(1);
    expect(r.requiereRevision).toBe(true);
  });

  /** Sin esto, todo el mundo elegiria siempre un motivo excusado. */
  it('un motivo excusado que exige validacion no surte efecto sin revision', () => {
    const r = resolverImputacion({
      motivo: {
        codigo: 'FUERZA_MAYOR',
        computa: false,
        trasladaFalta: false,
        exigeValidacion: true,
        exigeDetalle: false,
      },
      franja: 'TARDIA',
      idUsuarioCancela: 2,
      idUsuarioAfectado: 1,
    });
    expect(r.computa).toBe(false);
    expect(r.requiereRevision).toBe(true);
  });

  it('el motivo OTRO exige explicacion', () => {
    expect(() =>
      resolverImputacion({
        motivo: {
          codigo: 'OTRO',
          computa: true,
          trasladaFalta: false,
          exigeValidacion: false,
          exigeDetalle: true,
        },
        franja: 'AJUSTADA',
        idUsuarioCancela: 2,
        idUsuarioAfectado: 1,
        detalle: 'x',
      })
    ).toThrow(AppError);
  });
});
