import { describe, expect, it } from 'vitest';
import { render, screen, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { ProveedorSesion } from '../autenticacion/ContextoSesion';
import { ProveedorModo } from '../autenticacion/ContextoModo';

/**
 * La tabla de rutas, probada.
 *
 * Las pantallas se probaban una a una montandolas en un `MemoryRouter` propio,
 * con sus rutas declaradas a mano dentro de la propia prueba. Eso hacia que no
 * hubiera forma de detectar que una ruta existia en su prueba y no en la
 * aplicacion: `Recuperar` y `Restablecer` llevaban semanas con sus pruebas en
 * verde, y `Entrar` ya enlazaba a `/recuperar`, pero ninguna de las dos estaba
 * en `App.tsx`. Quien pulsaba "Olvide mi contrasena" caia en el 404.
 *
 * Aqui se monta `App` de verdad, que es la unica fuente de verdad de las rutas.
 */
function montar(ruta: string): RenderResult {
  const cliente = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}>
        <ProveedorSesion>
          <ProveedorModo>
            <App />
          </ProveedorModo>
        </ProveedorSesion>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('Tabla de rutas', () => {
  it('abre la pantalla de pedir recuperacion en /recuperar', async () => {
    montar('/recuperar');
    expect(await screen.findByRole('heading', { name: /recuperar/i })).toBeDefined();
    // La pantalla de 404 dice algo propio; si apareciera, la ruta no existiria.
    expect(screen.queryByText(/no encontramos/i)).toBeNull();
  });

  it('abre la pantalla de restablecer en /restablecer', async () => {
    montar('/restablecer?token=cualquiera');
    expect(await screen.findByRole('heading', { name: /contrase/i })).toBeDefined();
    expect(screen.queryByText(/no encontramos/i)).toBeNull();
  });

  it('sigue llevando a la pantalla de inicio de sesion en /entrar', async () => {
    montar('/entrar');
    expect(await screen.findByRole('heading', { name: /entrar|iniciar/i })).toBeDefined();
  });
});
