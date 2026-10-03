import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { borrarSesion, estaPorExpirar, guardarSesion, obtenerToken } from '../api/sesion';
import { cerrarSesion, iniciarSesion } from '../api/cliente';

/**
 * Pruebas del manejo de sesion.
 *
 * Es la parte del cliente donde un error cuesta caro: el brief exige que el
 * token NUNCA se guarde en localStorage, y esa clase de regla se rompe el dia
 * que alguien "arregla" la perdida de sesion al recargar guardandolo ahi. Estas
 * pruebas lo convierten en un fallo en rojo en lugar de en una revision de
 * codigo que alguien tiene que acordarse de hacer.
 */

const sesionDePrueba = {
  accessToken: 'token-de-prueba-abc123',
  expiraEn: new Date(Date.now() + 15 * 60 * 1000),
  usuario: { id: 7, nombre: 'Prueba', roles: ['SOLICITANTE'] },
};

beforeEach(() => {
  borrarSesion();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('donde vive el token', () => {
  it('NUNCA aparece en localStorage ni en sessionStorage', () => {
    guardarSesion(sesionDePrueba);

    expect(obtenerToken()).toBe(sesionDePrueba.accessToken);

    // Se recorren los dos almacenes enteros, no una clave concreta: lo que hay
    // que impedir es que el token acabe ahi con CUALQUIER nombre.
    for (const almacen of [localStorage, sessionStorage]) {
      const volcado = JSON.stringify(almacen);
      expect(volcado).not.toContain(sesionDePrueba.accessToken);
      expect(almacen.length).toBe(0);
    }
  });

  it('se pierde al borrar la sesion', () => {
    guardarSesion(sesionDePrueba);
    borrarSesion();
    expect(obtenerToken()).toBeNull();
  });
});

describe('renovacion anticipada', () => {
  /** Esperar al 401 cuesta una peticion perdida y un parpadeo. */
  it('un token con menos de un minuto de vida ya se considera por expirar', () => {
    guardarSesion({ ...sesionDePrueba, expiraEn: new Date(Date.now() + 30 * 1000) });
    expect(estaPorExpirar()).toBe(true);
  });

  it('uno con quince minutos por delante, no', () => {
    guardarSesion(sesionDePrueba);
    expect(estaPorExpirar()).toBe(false);
  });

  it('sin sesion, siempre esta por expirar', () => {
    expect(estaPorExpirar()).toBe(true);
  });
});

describe('inicio y cierre de sesion', () => {
  it('el inicio guarda el token que devuelve el servidor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              accessToken: 'token-nuevo',
              expiresAt: new Date(Date.now() + 900_000).toISOString(),
              usuario: { id: 7, nombre: 'Prueba', roles: ['SOLICITANTE'] },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
      )
    );

    await iniciarSesion('alguien@puntoamigo.local', 'la-que-sea');
    expect(obtenerToken()).toBe('token-nuevo');
    expect(localStorage.length).toBe(0);
  });

  /**
   * Lo que mas importa del cierre de sesion.
   *
   * Si el servidor no responde y se conservara el token, la persona creeria
   * haber salido y la pestana seguiria autenticada. Es lo peor de los dos
   * mundos, asi que el borrado local ocurre pase lo que pase.
   */
  it('el cierre borra el token aunque la peticion falle', async () => {
    guardarSesion(sesionDePrueba);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('red caida');
      })
    );

    await cerrarSesion();
    expect(obtenerToken()).toBeNull();
  });
});
