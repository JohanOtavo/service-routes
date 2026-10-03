import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Disposicion, enlacesDeCabecera } from '../Disposicion';
import { ProveedorSesion } from '../autenticacion/ContextoSesion';
import { ProveedorModo, PARAMETRO_MODO, modoDePantalla } from '../autenticacion/ContextoModo';
import { borrarSesion } from '../api/sesion';

/**
 * Pruebas del selector de modo de uso (SRS 3.3.3).
 *
 * Se monta la CABECERA entera y no el conmutador suelto, porque lo que el SRS
 * pide no es que existan dos botones: es que, con los dos roles a la vez, el menu
 * que uno ve corresponda al modo en el que esta. Un conmutador bien anunciado que
 * no cambiara los enlaces dejaria la cuenta a medias.
 *
 * Y se monta con el almacen y la URL limpios en cada prueba, porque el modo
 * vive fuera de React: un `localStorage` que se colara de una prueba a la
 * siguiente haria pasar por bueno un fallo de persistencia.
 */

/** Texto visible de cada boton del conmutador. */
const BUSCO = 'Busco un servicio';
const OFREZCO = 'Ofrezco un servicio';

beforeEach(() => {
  window.localStorage.clear();
  borrarSesion();
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

/**
 * Arranca el cliente como arrancaria de verdad.
 *
 * Al cargar no hay token en memoria —vive solo en memoria a proposito— y quien
 * devuelve la sesion es el refresco con la cookie. Poner la sesion a mano y
 * dejar el refresco fallar no modelaria nada real, porque un refresco fallido
 * borra la sesion.
 */
function conSesion(roles: readonly string[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/auth/refresh')) {
        return new Response(
          JSON.stringify({
            accessToken: 'token',
            expiresAt: new Date(Date.now() + 900_000).toISOString(),
            usuario: { id: 1, nombre: 'Ada', roles },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      // El contador de avisos de la cabecera. No es lo que se prueba aqui, pero
      // se responde bien para que la prueba falle por lo suyo y no por ruido.
      return new Response(JSON.stringify({ noLeidas: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    })
  );
}

function montar(roles: readonly string[], ruta = '/'): RenderResult {
  conSesion(roles);
  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}>
        <ProveedorSesion>
          {/*
            `ProveedorModo` envuelve a las RUTAS, no a la cabecera: asi cualquier
            pagina puede leer el modo, y la cabecera —que es quien lo pinta— lo
            tiene sin tener que recibirlo por props.
          */}
          <ProveedorModo>
            <Routes>
              <Route element={<Disposicion />}>
                <Route index element={<p>Pantalla inicial</p>} />
                <Route path="/servicios" element={<p>Busqueda de servicios</p>} />
                <Route path="/necesidades" element={<p>Necesidades recibidas</p>} />
                {/* Texto distinto del enlace del menu: si se llamaran igual, un
                    `findByText` los encontraria los dos y la prueba diria que
                    hay dos pantallas donde hay un menu y una pantalla. */}
                <Route path="/contrataciones" element={<p>Contrataciones de la cuenta</p>} />
              </Route>
            </Routes>
          </ProveedorModo>
        </ProveedorSesion>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Los dos botones, en el orden en que los ve la persona. */
function conmutador(): HTMLElement[] {
  return [
    screen.queryByRole('button', { name: BUSCO }),
    screen.queryByRole('button', { name: OFREZCO }),
  ].filter((b): b is HTMLElement => b !== null);
}

/** Los destinos del menu, en el orden en que salen. */
function destinos(): (string | null)[] {
  return Array.from(
    screen.getByRole('navigation', { name: 'Navegacion principal' }).querySelectorAll('a')
  ).map((a) => a.getAttribute('href'));
}

describe('cuando el conmutador debe verse', () => {
  it('NO aparece con un solo rol: no hay nada que alternar', async () => {
    montar(['SOLICITANTE']);

    await screen.findByRole('navigation', { name: 'Navegacion principal' });

    expect(conmutador()).toHaveLength(0);
    // Y el menu es el de siempre, sin tocar nada.
    expect(destinos()).toEqual(['/servicios', '/mis-necesidades', '/contrataciones', '/avisos']);
  });

  it('tampoco aparece siendo solo oferente', async () => {
    montar(['OFERENTE']);

    await screen.findByRole('navigation', { name: 'Navegacion principal' });

    expect(conmutador()).toHaveLength(0);
  });

  it('NO aparece con los tres roles si falta alguno de los dos', async () => {
    // ADMINISTRADOR no cuenta: es un tercer papel que se superpone y no es una
    // de las dos vistas que el conmutador alterna.
    montar(['SOLICITANTE', 'ADMINISTRADOR']);

    await screen.findByRole('navigation', { name: 'Navegacion principal' });

    expect(conmutador()).toHaveLength(0);
  });

  it('aparece con solicitante y oferente a la vez', async () => {
    montar(['SOLICITANTE', 'OFERENTE']);

    await screen.findByRole('navigation', { name: 'Navegacion principal' });

    expect(conmutador()).toHaveLength(2);
  });

  it('aparece con los tres roles: administrador no estorba', async () => {
    montar(['SOLICITANTE', 'OFERENTE', 'ADMINISTRADOR']);

    await screen.findByRole('navigation', { name: 'Navegacion principal' });

    expect(conmutador()).toHaveLength(2);
  });
});

describe('como se anuncia', () => {
  it('el grupo tiene nombre, para que los botones sueltos no se anuncien sueltos', async () => {
    montar(['SOLICITANTE', 'OFERENTE']);

    await screen.findByRole('navigation', { name: 'Navegacion principal' });

    const grupo = screen.getByRole('group', { name: 'Modo de uso' });
    expect(grupo.contains(conmutador()[0] as HTMLElement)).toBe(true);
  });

  it('el estado va en aria-pressed, y no solo en el color', async () => {
    montar(['SOLICITANTE', 'OFERENTE']);

    await screen.findByRole('navigation', { name: 'Navegacion principal' });

    const [busco, ofrezco] = conmutador();
    expect(busco?.getAttribute('aria-pressed')).toBe('true');
    expect(ofrezco?.getAttribute('aria-pressed')).toBe('false');
  });

  it('al cambiar, aria-pressed se invierte', async () => {
    montar(['SOLICITANTE', 'OFERENTE']);

    await screen.findByRole('navigation', { name: 'Navegacion principal' });
    fireEvent.click(screen.getByRole('button', { name: OFREZCO }));

    const [busco, ofrezco] = conmutador();
    expect(busco?.getAttribute('aria-pressed')).toBe('false');
    expect(ofrezco?.getAttribute('aria-pressed')).toBe('true');
  });

  it('NO se anuncia nada al cargar: eso no lo ha elegido nadie', async () => {
    montar(['SOLICITANTE', 'OFERENTE']);

    await screen.findByRole('navigation', { name: 'Navegacion principal' });

    // La region `status` existe siempre —si no, el lector no tendria nada que
    // observar— pero vacia.
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('al cambiar SI se dice que vista se esta viendo', async () => {
    montar(['SOLICITANTE', 'OFERENTE']);

    await screen.findByRole('navigation', { name: 'Navegacion principal' });
    fireEvent.click(screen.getByRole('button', { name: OFREZCO }));

    const anuncio = screen.getByRole('status').textContent ?? '';
    expect(anuncio).toContain('la vista de quien ofrece un servicio');
    // Y la segunda mitad de RNF19: el menu cambio, y eso hay que decirlo.
    expect(anuncio).toContain('El menu muestra sus enlaces.');
  });

  it('pulsar lo que ya esta activo no anuncia ni navega', async () => {
    montar(['SOLICITANTE', 'OFERENTE']);

    await screen.findByRole('navigation', { name: 'Navegacion principal' });
    fireEvent.click(screen.getByRole('button', { name: BUSCO }));

    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('el foco se queda en el boton que se pulso', async () => {
    montar(['SOLICITANTE', 'OFERENTE']);

    await screen.findByRole('navigation', { name: 'Navegacion principal' });
    const boton = screen.getByRole('button', { name: OFREZCO });
    boton.focus();
    fireEvent.click(boton);

    // Llevarselo a otro sitio es lo que hace que un conmutador parezca roto:
    // parece que el tabulador ha saltado.
    expect(document.activeElement).toBe(boton);
  });
});

describe('como cambia la navegacion', () => {
  it('el menu entero cambia con el modo', async () => {
    montar(['SOLICITANTE', 'OFERENTE']);

    await screen.findByRole('navigation', { name: 'Navegacion principal' });
    expect(destinos()).toEqual(['/servicios', '/mis-necesidades', '/contrataciones', '/avisos']);

    fireEvent.click(screen.getByRole('button', { name: OFREZCO }));
    expect(destinos()).toEqual(['/necesidades', '/mis-propuestas', '/contrataciones', '/avisos']);
  });

  it('las pantallas compartidas no expulsan a nadie de ellas', async () => {
    // Quien esta revisando sus contrataciones no ha pedido que le cambien la
    // pantalla de debajo: eso se queda.
    montar(['SOLICITANTE', 'OFERENTE'], '/contrataciones');

    await screen.findByText('Contrataciones de la cuenta');
    fireEvent.click(screen.getByRole('button', { name: OFREZCO }));

    expect(screen.queryByText('Busqueda de servicios')).toBeNull();
    expect(screen.getByText('Contrataciones de la cuenta')).toBeDefined();
    // El menu, eso si, ya es el de oferente.
    expect(destinos()).toEqual(['/necesidades', '/mis-propuestas', '/contrataciones', '/avisos']);
  });

  it('una pantalla que el modo ya no nombra lleva a la de su nuevo modo', async () => {
    // Se entra por enlace con la vista de oferente puesta. Si al cambiar se
    // quedara en "Necesidades", se quedaria mirando una pantalla que su menu ya
    // no menciona, y el conmutador habria roto su propia promesa.
    montar(['SOLICITANTE', 'OFERENTE'], `/necesidades?${PARAMETRO_MODO}=oferente`);

    await screen.findByText('Necesidades recibidas');
    fireEvent.click(screen.getByRole('button', { name: BUSCO }));

    expect(screen.getByText('Busqueda de servicios')).toBeDefined();
  });

  it('pulsar el modo que ya esta puesto no mueve a nadie', async () => {
    // Deep link a una pantalla de oferente con el modo por omision. Pulsar el
    // boton que ya esta activo no es un cambio: no se anuncia ni se navega.
    montar(['SOLICITANTE', 'OFERENTE'], '/necesidades');

    await screen.findByText('Necesidades recibidas');
    fireEvent.click(screen.getByRole('button', { name: BUSCO }));

    expect(screen.getByText('Necesidades recibidas')).toBeDefined();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('el catalogo tambien cuenta: es la pantalla de inicio de la vista de solicitante', async () => {
    montar(['SOLICITANTE', 'OFERENTE'], '/servicios');

    await screen.findByText('Busqueda de servicios');
    fireEvent.click(screen.getByRole('button', { name: OFREZCO }));

    expect(screen.getByText('Necesidades recibidas')).toBeDefined();
  });
});

describe('donde vive la eleccion', () => {
  it('cambiar de modo deja el modo en la URL, para que el enlace se comparta', async () => {
    montar(['SOLICITANTE', 'OFERENTE']);

    await screen.findByRole('navigation', { name: 'Navegacion principal' });
    fireEvent.click(screen.getByRole('button', { name: OFREZCO }));

    expect(screen.getByRole('status').textContent).not.toBe('');
    // El estado ya cambio; la URL es lo que se comprueba leyendo el historial.
    expect(PARAMETRO_MODO).toBe('modo');
    expect(destinos()).toEqual(['/necesidades', '/mis-propuestas', '/contrataciones', '/avisos']);
  });

  it('un enlace con ?modo=oferente abre en la vista de oferente', async () => {
    montar(['SOLICITANTE', 'OFERENTE'], `/?${PARAMETRO_MODO}=oferente`);

    await screen.findByRole('navigation', { name: 'Navegacion principal' });

    expect(screen.getByRole('button', { name: OFREZCO }).getAttribute('aria-pressed')).toBe('true');
    expect(destinos()).toEqual(['/necesidades', '/mis-propuestas', '/contrataciones', '/avisos']);
  });

  it('la URL manda sobre lo guardado: un enlace tiene que ser un enlace', async () => {
    // Guardado como solicitante, pero el enlace dice oferente.
    window.localStorage.setItem('punto-amigo:modo:v1', 'solicitante');

    montar(['SOLICITANTE', 'OFERENTE'], `/?${PARAMETRO_MODO}=oferente`);
    await screen.findByRole('navigation', { name: 'Navegacion principal' });

    expect(screen.getByRole('button', { name: OFREZCO }).getAttribute('aria-pressed')).toBe('true');
    expect(destinos()).toEqual(['/necesidades', '/mis-propuestas', '/contrataciones', '/avisos']);
  });

  it('un valor de la URL que no es un modo se descarta', async () => {
    montar(['SOLICITANTE', 'OFERENTE'], '/?modo=inventado');

    await screen.findByRole('navigation', { name: 'Navegacion principal' });

    expect(screen.getByRole('button', { name: BUSCO }).getAttribute('aria-pressed')).toBe('true');
  });

  it('la eleccion sobrevive a recargar la pagina', async () => {
    const primera = montar(['SOLICITANTE', 'OFERENTE']);
    await screen.findByRole('navigation', { name: 'Navegacion principal' });
    fireEvent.click(screen.getByRole('button', { name: OFREZCO }));
    expect(screen.getByRole('button', { name: OFREZCO }).getAttribute('aria-pressed')).toBe('true');

    // Recargar: se desmonta todo y se vuelve a montar desde cero, con la URL
    // limpia, que es lo que pasa con F5.
    primera.unmount();
    montar(['SOLICITANTE', 'OFERENTE']);

    await screen.findByRole('navigation', { name: 'Navegacion principal' });
    expect(screen.getByRole('button', { name: OFREZCO }).getAttribute('aria-pressed')).toBe('true');
    expect(destinos()).toEqual(['/necesidades', '/mis-propuestas', '/contrataciones', '/avisos']);
  });

  it('sin eleccion se empieza por la vista de quien busca', async () => {
    montar(['SOLICITANTE', 'OFERENTE']);

    await screen.findByRole('navigation', { name: 'Navegacion principal' });

    expect(screen.getByRole('button', { name: BUSCO }).getAttribute('aria-pressed')).toBe('true');
  });
});

describe('el modo no es seguridad', () => {
  it('un ?modo=oferente a mano no da un menu de oferente a quien no ofrece', async () => {
    montar(['SOLICITANTE'], `/?${PARAMETRO_MODO}=oferente`);

    await screen.findByRole('navigation', { name: 'Navegacion principal' });

    // Ni conmutador —no hay nada que alternar— ni enlaces de oferente.
    expect(conmutador()).toHaveLength(0);
    expect(destinos()).toEqual(['/servicios', '/mis-necesidades', '/contrataciones', '/avisos']);
  });

  it('un modo guardado de cuando tenia los dos roles tampoco', async () => {
    window.localStorage.setItem('punto-amigo:modo:v1', 'oferente');

    montar(['SOLICITANTE']);

    await screen.findByRole('navigation', { name: 'Navegacion principal' });

    expect(screen.queryByRole('link', { name: /Necesidades/u })).toBeNull();
  });
});

describe('que pantalla es de quien, sin depender de los roles', () => {
  it('reconoce las exclusivas de cada modo', () => {
    expect(modoDePantalla('/necesidades')).toBe('oferente');
    expect(modoDePantalla('/necesidades/7')).toBe('oferente');
    expect(modoDePantalla('/mis-propuestas')).toBe('oferente');
    expect(modoDePantalla('/mi-perfil-prestador')).toBe('oferente');
    expect(modoDePantalla('/mis-necesidades')).toBe('solicitante');
  });

  it('las compartidas no son de nadie', () => {
    expect(modoDePantalla('/contrataciones')).toBeNull();
    expect(modoDePantalla('/avisos')).toBeNull();
    expect(modoDePantalla('/mi-cuenta')).toBeNull();
  });

  it('el catalogo es del modo solicitante', () => {
    // Es publico y lo puede mirar quien sea, pero el menu de oferente no lo
    // menciona: quedarse ahi al cambiar de modo dejaria la pantalla fuera del
    // menu que se acaba de pintar.
    expect(modoDePantalla('/servicios')).toBe('solicitante');
    expect(modoDePantalla('/servicios/12')).toBe('solicitante');
  });

  it('el corte es por segmento, no por prefijo a pelo', () => {
    // `/necesidades-abajo` no es la pantalla de necesidades.
    expect(modoDePantalla('/necesidades-abajo')).toBeNull();
    expect(modoDePantalla('/mis-necesidades-2')).toBeNull();
  });

  it('no se confunde con los parametros de la URL', () => {
    expect(modoDePantalla('/necesidades?pagina=2')).toBe('oferente');
  });
});

describe('la tabla de enlaces, sin montar nada', () => {
  it('con un solo rol el menu es el de ese rol, mas lo que es de cualquiera', () => {
    // El catalogo sigue estando: es publico, y quien solo ofrece tambien busca.
    // Las contrataciones y los avisos los ve cualquier sesion.
    expect(enlacesDeCabecera(['OFERENTE'], 'solicitante', true).map((e) => e.ruta)).toEqual([
      '/servicios',
      '/necesidades',
      '/mis-propuestas',
      '/contrataciones',
      '/avisos',
    ]);
  });

  it('sin sesion solo se ve el catalogo, que es lo unico publico', () => {
    expect(enlacesDeCabecera([], 'solicitante', false).map((e) => e.ruta)).toEqual(['/servicios']);
  });

  it('las contrataciones y los avisos van con sesion, en los dos modos', () => {
    for (const modo of ['solicitante', 'oferente'] as const) {
      const rutas = enlacesDeCabecera(['SOLICITANTE', 'OFERENTE'], modo, true).map((e) => e.ruta);
      expect(rutas).toContain('/contrataciones');
      expect(rutas).toContain('/avisos');
    }
  });
});
