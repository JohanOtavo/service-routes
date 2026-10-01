import { AppError } from '@punto-amigo/shared';
import {
  CAMPOS_ORDEN_AUDITORIA,
  crearAsiento,
  depurarDetalle,
  exigirRangoValido,
  normalizarPaginacion,
  normalizarParametro,
} from '../src/domain';

/**
 * Pruebas del dominio de auditoria e informes.
 *
 * El dominio lo escribio un subagente; estas pruebas comprueban que de verdad
 * hace lo que sus comentarios afirman. La parte que mas importa es el depurador
 * del detalle: lo que se cuele por ahi queda escrito en una tabla que por
 * diseno no se puede corregir.
 */

const AHORA = new Date('2026-10-01T12:00:00.000Z');

const asientoBase = {
  ocurridoAt: AHORA,
  idActor: 7,
  actorRol: 'ADMINISTRADOR',
  accion: 'SUSPENDER_CUENTA',
  recursoTipo: 'Usuario',
  recursoId: 42,
  resultado: 'EXITO' as const,
};

describe('depuracion del detalle (lo que NO se guarda)', () => {
  it('omite cualquier clave que suene a secreto o a dato personal', () => {
    const d = depurarDetalle({
      contrasena: 'HolaMundo2026',
      passwordHash: 'argon2id$...',
      refreshToken: 'abc.def.ghi',
      correo: 'pedro@puntoamigo.local',
      email: 'pedro@puntoamigo.local',
      telefono: '3001112233',
      cedula: '1020304050',
      direccion: 'Calle 1 # 2-3',
      apiSecret: 'shhh',
    })!;

    for (const clave of Object.keys(d)) {
      expect(d[clave]).toBe('[omitido]');
    }

    const texto = JSON.stringify(d);
    expect(texto).not.toContain('HolaMundo2026');
    expect(texto).not.toContain('pedro@puntoamigo.local');
    expect(texto).not.toContain('3001112233');
  });

  /** Marcar lo descartado y no omitirlo en silencio: el silencio esconde fallos. */
  it('deja constancia de lo descartado en vez de borrar la clave', () => {
    const d = depurarDetalle({ token: 'x', motivo: 'incumplimiento' })!;
    expect(Object.keys(d).sort()).toEqual(['motivo', 'token']);
    expect(d['token']).toBe('[omitido]');
    expect(d['motivo']).toBe('incumplimiento');
  });

  /**
   * Un objeto anidado puede traer cualquier cosa a cualquier profundidad, y una
   * regla que hay que aplicar recursivamente acaba aplicandose mal.
   */
  it('no recorre objetos anidados: los marca omitidos', () => {
    const d = depurarDetalle({ usuario: { correo: 'pedro@puntoamigo.local' } })!;
    expect(d['usuario']).toBe('[omitido]');
    expect(JSON.stringify(d)).not.toContain('pedro@puntoamigo.local');
  });

  it('conserva escalares y listas de escalares, acotados', () => {
    const d = depurarDetalle({
      intentos: 3,
      activo: true,
      vacio: null,
      roles: ['OFERENTE', 'SOLICITANTE'],
      largo: 'x'.repeat(900),
    })!;

    expect(d['intentos']).toBe(3);
    expect(d['activo']).toBe(true);
    expect(d['vacio']).toBeNull();
    expect(d['roles']).toEqual(['OFERENTE', 'SOLICITANTE']);
    expect(String(d['largo'])).toHaveLength(500);
  });

  it('acota el numero de claves y el tamano de las listas', () => {
    const muchas: Record<string, unknown> = {};
    for (let i = 0; i < 50; i += 1) muchas[`campo${i}`] = i;
    expect(Object.keys(depurarDetalle(muchas)!)).toHaveLength(20);

    const lista = depurarDetalle({ ids: Array.from({ length: 50 }, (_, i) => i) })!;
    expect(lista['ids']).toHaveLength(20);
  });

  it('un detalle vacio o nulo se guarda como NULL', () => {
    expect(depurarDetalle(null)).toBeNull();
    expect(depurarDetalle({})).toBeNull();
  });
});

describe('asiento de auditoria', () => {
  it('exige accion y tipo de recurso', () => {
    expect(() => crearAsiento({ ...asientoBase, accion: '   ' })).toThrow(AppError);
    expect(() => crearAsiento({ ...asientoBase, recursoTipo: '' })).toThrow(AppError);
  });

  /** El depurador se aplica SIEMPRE, no solo cuando el llamador se acuerda. */
  it('depura el detalle al construirlo, no despues', () => {
    const a = crearAsiento({ ...asientoBase, detalle: { correo: 'pedro@puntoamigo.local' } });
    expect(JSON.stringify(a.detalle)).not.toContain('pedro@puntoamigo.local');
  });

  it('el identificador del recurso se guarda como texto acotado', () => {
    expect(crearAsiento({ ...asientoBase, recursoId: 42 }).recursoId).toBe('42');
    expect(crearAsiento({ ...asientoBase, recursoId: null }).recursoId).toBeNull();
  });

  it('recorta los campos a lo que admite la columna', () => {
    expect(crearAsiento({ ...asientoBase, accion: 'A'.repeat(200) }).accion).toHaveLength(80);
  });
});

describe('consulta de la bitacora', () => {
  /**
   * ORDER BY no admite parametros, asi que el nombre de columna acaba
   * concatenado al SQL. La lista blanca es lo unico que separa un filtro de una
   * inyeccion.
   */
  it('el orden solo admite los campos de la lista blanca', () => {
    expect([...CAMPOS_ORDEN_AUDITORIA]).toEqual(['ocurrido_at', 'registrado_at']);
    expect([...CAMPOS_ORDEN_AUDITORIA]).not.toContain('id_actor');
  });

  it('un rango de fechas al reves no pasa', () => {
    expect(() => exigirRangoValido(new Date('2026-10-02'), new Date('2026-10-01'))).toThrow(
      AppError
    );
    expect(() => exigirRangoValido(new Date('2026-10-01'), new Date('2026-10-02'))).not.toThrow();
    expect(() => exigirRangoValido(undefined, undefined)).not.toThrow();
  });

  /** Un informe sin tope de pagina es una descarga de toda la base. */
  it('la pagina esta acotada', () => {
    expect(normalizarPaginacion({ tamano: 10_000 }).tamano).toBe(50);
    expect(normalizarPaginacion({ pagina: 0, tamano: 0 })).toEqual({ pagina: 1, tamano: 1 });
  });
});

describe('parametros del sistema (SRS RF105)', () => {
  it('normaliza la clave a mayusculas', () => {
    expect(
      normalizarParametro({ clave: 'umbral_uno', valor: '0.15', tipoDato: 'number' }).clave
    ).toBe('UMBRAL_UNO');
  });

  /**
   * Otros servicios leen el parametro por su nombre exacto. Si conviviesen
   * `UMBRAL CANCELACION` y `UMBRAL_CANCELACION`, quien buscara uno leeria
   * siempre el valor por defecto sin enterarse de que cambiaron el otro.
   */
  it('rechaza claves con espacios, guiones o inicio invalido', () => {
    for (const clave of ['UMBRAL CANCELACION', 'UMBRAL-UNO', '1UMBRAL', 'U', 'umbral.uno']) {
      expect(() => normalizarParametro({ clave, valor: '1', tipoDato: 'number' })).toThrow(AppError);
    }
  });

  /**
   * Un umbral declarado `number` que valga "pronto" rompe al servicio que lo
   * convierta, en otro proceso y mucho despues, con un error que no apunta aqui.
   */
  it('comprueba el valor contra el tipo declarado', () => {
    expect(() =>
      normalizarParametro({ clave: 'UMBRAL', valor: 'pronto', tipoDato: 'number' })
    ).toThrow(AppError);
    expect(() =>
      normalizarParametro({ clave: 'ACTIVO', valor: 'quiza', tipoDato: 'boolean' })
    ).toThrow(AppError);

    expect(normalizarParametro({ clave: 'UMBRAL', valor: '0.15', tipoDato: 'number' }).valor).toBe(
      '0.15'
    );
    expect(normalizarParametro({ clave: 'ACTIVO', valor: 'true', tipoDato: 'boolean' }).valor).toBe(
      'true'
    );
  });
});
