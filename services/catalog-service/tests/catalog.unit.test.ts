import { AppError } from '@punto-amigo/shared';
import {
  Categoria,
  Servicio,
  normalizarCriterios,
  TAMANO_PAGINA_MAXIMO,
} from '../src/domain';

const VALIDO = {
  nombre: 'Reparacion de fugas de agua',
  descripcion: 'Localizo y reparo fugas en cocina, bano y redes internas.',
  idPrestador: 10,
  idCategoria: 1,
  estadoPrestador: 'ACTIVE' as const,
  categoriaActiva: true,
};

describe('publicacion de servicio', () => {
  it('publica cuando el prestador esta validado y la categoria activa', () => {
    const s = Servicio.publicar(VALIDO);
    expect(s.estado).toBe('ACTIVE');
    expect(s.activo).toBe(true);
  });

  it('rechaza si el perfil del prestador no esta validado (SRS RF34)', () => {
    for (const estado of ['PENDING_VALIDATION', 'SUSPENDED', 'INACTIVE'] as const) {
      expect(() => Servicio.publicar({ ...VALIDO, estadoPrestador: estado })).toThrow(AppError);
    }
  });

  it('rechaza si la categoria esta desactivada', () => {
    expect(() => Servicio.publicar({ ...VALIDO, categoriaActiva: false })).toThrow(AppError);
  });

  it('exige una descripcion util, no una palabra', () => {
    expect(() => Servicio.publicar({ ...VALIDO, descripcion: 'arreglo cosas' })).toThrow(AppError);
  });
});

describe('propiedad del servicio', () => {
  const servicio = (): Servicio =>
    Servicio.rehydrate({
      id: 1,
      nombre: 'Reparacion de fugas',
      descripcion: 'x'.repeat(30),
      idPrestador: 10,
      idCategoria: 1,
      estado: 'ACTIVE',
      deletedAt: null,
    });

  it('el dueno edita y cambia estado', () => {
    const s = servicio();
    s.editar(10, { nombre: 'Reparacion de fugas y desagues' });
    s.cambiarEstado(10, 'INACTIVE');
    expect(s.activo).toBe(false);
  });

  /**
   * El guardia de rol del borde solo dice que quien llama es OFERENTE. Sin esta
   * comprobacion, cualquier oferente editaria el catalogo de otro.
   */
  it('otro oferente no puede editar ni desactivar', () => {
    expect(() => servicio().editar(99, { nombre: 'Secuestrado por otro' })).toThrow(AppError);
    expect(() => servicio().cambiarEstado(99, 'INACTIVE')).toThrow(AppError);
  });

  it('responde 404 y no 403, para no confirmar que el servicio existe', () => {
    try {
      servicio().editar(99, { nombre: 'Intento ajeno' });
      throw new Error('deberia haber lanzado');
    } catch (error) {
      expect((error as AppError).httpStatus).toBe(404);
    }
  });

  it('la moderacion retira sin ser el dueno (SRS RF104)', () => {
    const s = servicio();
    s.retirarPorModeracion();
    expect(s.activo).toBe(false);
  });
});

describe('categorias', () => {
  it('desactivar no borra: los servicios ya clasificados sobreviven (SRS RF43)', () => {
    const c = Categoria.crear({ nombre: 'Plomeria' });
    c.desactivar();
    expect(c.activa).toBe(false);
    expect(c.nombre).toBe('Plomeria');
  });

  it('rechaza nombres fuera de rango', () => {
    expect(() => Categoria.crear({ nombre: 'ab' })).toThrow(AppError);
    expect(() => Categoria.crear({ nombre: 'x'.repeat(101) })).toThrow(AppError);
  });
});

describe('criterios de busqueda', () => {
  it('acota el tamano de pagina', () => {
    expect(normalizarCriterios({ tamano: 10_000 }).tamano).toBe(TAMANO_PAGINA_MAXIMO);
    expect(normalizarCriterios({ tamano: -5 }).tamano).toBe(1);
  });

  it('la pagina nunca es cero ni negativa', () => {
    expect(normalizarCriterios({ pagina: 0 }).pagina).toBe(1);
    expect(normalizarCriterios({ pagina: -3 }).pagina).toBe(1);
  });

  it('un texto vacio no cuenta como filtro', () => {
    expect(normalizarCriterios({ texto: '   ' }).texto).toBeUndefined();
  });
});
