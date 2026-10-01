import { AppError } from '@punto-amigo/shared';
import { Prestador, TRANSICIONES, type EstadoPrestador } from '../src/domain';

/**
 * Pruebas del dominio de prestadores.
 *
 * El dominio lo escribio un subagente; estas pruebas comprueban que de verdad
 * hace lo que sus comentarios afirman. Codigo sin verificar no cuenta como
 * construido, venga de donde venga.
 */

const PERFIL = {
  idUsuario: 7,
  nombre: 'Pedro Plomero',
  especialidad: 'Plomeria y redes de agua',
  telefono: '3001112233',
  correo: 'pedro@puntoamigo.local',
};

const nuevo = (extra: Partial<typeof PERFIL> = {}): Prestador =>
  Prestador.crear({ ...PERFIL, ...extra });

/** Lleva un perfil recien creado hasta ACTIVE, como haria un administrador. */
function validado(extra: Partial<typeof PERFIL> = {}): Prestador {
  const p = nuevo(extra);
  p.validar();
  return p;
}

function conEstado(estado: EstadoPrestador, deletedAt: Date | null = null): Prestador {
  return Prestador.rehydrate({
    id: 1,
    idUsuario: 7,
    nombre: 'Pedro Plomero',
    especialidad: 'Plomeria',
    experiencia: null,
    telefono: '3001112233',
    correo: 'pedro@puntoamigo.local',
    disponibilidad: null,
    estado,
    deletedAt,
  });
}

describe('alta del perfil', () => {
  it('nace PENDING_VALIDATION, nunca validado', () => {
    expect(nuevo().estado).toBe('PENDING_VALIDATION');
    expect(nuevo().estaValidado).toBe(false);
  });

  /**
   * El estado no es parametro del alta: si lo fuera, una peticion podria darse
   * por validada a si misma y saltarse al administrador.
   */
  it('no admite un estado inicial inyectado desde la peticion', () => {
    const p = Prestador.crear({ ...PERFIL, estado: 'ACTIVE' } as never);
    expect(p.estado).toBe('PENDING_VALIDATION');
  });

  it('exige nombre y especialidad', () => {
    expect(() => nuevo({ nombre: '' })).toThrow(AppError);
    expect(() => nuevo({ especialidad: '' })).toThrow(AppError);
  });
});

describe('visibilidad publica (SRS RF25)', () => {
  it('un perfil sin validar no es visible', () => {
    expect(nuevo().esVisiblePublicamente).toBe(false);
  });

  it('validado si es visible', () => {
    expect(validado().esVisiblePublicamente).toBe(true);
  });

  /**
   * Estado y borrado logico son dos columnas distintas. La consulta publica no
   * debe depender de que esten siempre de acuerdo.
   */
  it('el borrado logico lo oculta aunque el estado diga ACTIVE', () => {
    expect(conEstado('ACTIVE', new Date('2026-10-01T00:00:00.000Z')).esVisiblePublicamente).toBe(
      false
    );
  });

  it('la vista publica no filtra datos de contacto', () => {
    const publico = JSON.stringify(validado().vistaPublica());
    expect(publico).not.toContain('3001112233');
    expect(publico).not.toContain('pedro@puntoamigo.local');
  });
});

describe('propiedad del perfil (SRS RF28)', () => {
  it('el dueno edita', () => {
    const p = validado();
    p.editar(7, { especialidad: 'Plomeria, gas y redes' });
    expect(p.especialidad).toBe('Plomeria, gas y redes');
  });

  it('otro oferente no edita, y recibe 404 en vez de 403', () => {
    try {
      validado().editar(999, { nombre: 'Secuestrado por otro' });
      throw new Error('deberia lanzar');
    } catch (e) {
      expect((e as AppError).httpStatus).toBe(404);
    }
  });

  /**
   * Corregir un telefono no debe sacar al oferente del catalogo mientras un
   * administrador vuelve a mirarlo. La revalidacion es decision administrativa.
   */
  it('editar NO devuelve el perfil a la cola de validacion', () => {
    const p = validado();
    p.editar(7, { telefono: '3009998877' });
    expect(p.estado).toBe('ACTIVE');
  });
});

describe('validacion administrativa', () => {
  it('validar pasa a ACTIVE', () => {
    expect(validado().estado).toBe('ACTIVE');
  });

  it('rechazar exige motivo', () => {
    expect(() => nuevo().rechazar('')).toThrow(AppError);
  });

  /**
   * El modelo no tiene estados terminales a proposito: un perfil siempre puede
   * volver a INACTIVE y de ahi a la cola de validacion. Lo que si prohibe son
   * atajos concretos, y son esos los que hay que fijar.
   */
  it('rechaza transiciones que el modelo no contempla', () => {
    const prohibidas: [EstadoPrestador, EstadoPrestador][] = [
      // Suspender exige haber estado activo antes; no se suspende la cola.
      ['PENDING_VALIDATION', 'SUSPENDED'],
      // Reactivar un perfil retirado pasa por revision, no por atajo a ACTIVE.
      ['INACTIVE', 'ACTIVE'],
      ['INACTIVE', 'SUSPENDED'],
    ];

    for (const [desde, hasta] of prohibidas) {
      expect(TRANSICIONES[desde]).not.toContain(hasta);
      expect(() => conEstado(desde).cambiarEstado(hasta)).toThrow(AppError);
    }
  });

  /** INACTIVE no es una tumba: devuelve a revision, nunca directo a ACTIVE. */
  it('un perfil retirado solo vuelve por la cola de validacion', () => {
    const p = conEstado('INACTIVE');
    p.cambiarEstado('PENDING_VALIDATION');
    expect(p.estado).toBe('PENDING_VALIDATION');
    expect(p.esVisiblePublicamente).toBe(false);
  });
});

describe('suspension en cascada (SRS RF32)', () => {
  it('suspender la cuenta suspende el perfil', () => {
    const p = validado();
    expect(p.suspenderPorCuentaSuspendida()).toBe(true);
    expect(p.estado).toBe('SUSPENDED');
    expect(p.esVisiblePublicamente).toBe(false);
  });

  /** Idempotente: el evento puede llegar dos veces y no debe romper nada. */
  it('aplicarlo dos veces no cambia el resultado', () => {
    const p = validado();
    p.suspenderPorCuentaSuspendida();
    expect(p.suspenderPorCuentaSuspendida()).toBe(false);
    expect(p.estado).toBe('SUSPENDED');
  });
});
