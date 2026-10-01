import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { RutaProtegida } from '../autenticacion/RutaProtegida';
import { ProveedorSesion } from '../autenticacion/ContextoSesion';
import { borrarSesion } from '../api/sesion';

/**
 * Pruebas de la ruta protegida.
 *
 * Vigilan un fallo concreto y facil de reintroducir: redirigir mientras se
 * comprueba la sesion. El access token vive solo en memoria, asi que al
 * recargar esta vacio durante el instante que tarda la renovacion. Si en ese
 * momento se redirige, se echa fuera a quien SI tiene sesion, en cada recarga.
 */

function montar(hijo: React.ReactNode, roles?: readonly string[]) {
  return render(
    <MemoryRouter initialEntries={['/privado']}>
      <ProveedorSesion>
        <Routes>
          <Route
            path="/privado"
            element={<RutaProtegida {...(roles === undefined ? {} : { roles })}>{hijo}</RutaProtegida>}
          />
          <Route path="/entrar" element={<p>Pantalla de inicio de sesion</p>} />
        </Routes>
      </ProveedorSesion>
    </MemoryRouter>
  );
}

beforeEach(() => {
  borrarSesion();
});

describe('mientras se comprueba la sesion', () => {
  it('NO redirige: muestra que esta cargando', () => {
    // El refresco nunca responde: se queda en el estado de comprobacion.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));

    montar(<p>Contenido privado</p>);

    expect(screen.queryByText('Pantalla de inicio de sesion')).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('su sesion');
  });
});

describe('sin sesion', () => {
  it('manda a iniciar sesion cuando la renovacion falla', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 401 }))
    );

    montar(<p>Contenido privado</p>);

    expect(await screen.findByText('Pantalla de inicio de sesion')).toBeDefined();
  });
});

describe('con sesion', () => {
  /**
   * Se simula el arranque REAL: al cargar la pagina no hay token en memoria y
   * el refresco con la cookie devuelve uno nuevo. Poner la sesion a mano y
   * dejar que el refresco falle no modela nada que pueda ocurrir, porque un
   * refresco fallido borra la sesion, que es justo lo que debe hacer.
   */
  const refrescoBueno = (roles: readonly string[]) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              accessToken: 'token-renovado',
              expiresAt: new Date(Date.now() + 900_000).toISOString(),
              usuario: { id: 1, nombre: 'Quien sea', roles },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } }
          )
      )
    );

  it('deja pasar a quien tiene el rol', async () => {
    refrescoBueno(['OFERENTE']);

    montar(<p>Contenido privado</p>, ['OFERENTE']);
    expect(await screen.findByText('Contenido privado')).toBeDefined();
  });

  /**
   * Sin el rol NO se redirige: se explica.
   *
   * Mandarla al inicio sin decir nada la deja preguntandose si pulso mal, y un
   * oferente que llega a una pantalla de solicitante necesita saber que le
   * falta un rol, no que se equivoco de enlace.
   */
  it('a quien le falta el rol le dice por que, en lugar de redirigirlo', async () => {
    refrescoBueno(['SOLICITANTE']);

    montar(<p>Contenido privado</p>, ['ADMINISTRADOR']);

    expect(await screen.findByText(/no es para su perfil/u)).toBeDefined();
    expect(screen.queryByText('Contenido privado')).toBeNull();
    expect(screen.queryByText('Pantalla de inicio de sesion')).toBeNull();
  });
});
