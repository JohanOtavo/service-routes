import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen, waitFor, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Restablecer from '../paginas/Restablecer';

/**
 * Pruebas de la pantalla de restablecer contrasena.
 *
 * El token llega por la cadena de consulta, no por un campo: viene en el enlace
 * del correo. Eso convierte el `token` de la URL en parte de la confianza de
 * esta pantalla, y por eso se comprueba que viaja tal cual llega. El backend lo
 * genera en base64url (`randomBytes(32).toString('base64url')`), cuyo alfabeto
 * no tiene `+` ni `/`, de modo que el tipico fallo de `+` convertido en espacio
 * no puede ocurrir; el caso que si se da es el token percent-encoded por quien
 * construye el enlace.
 */

/** 43 caracteres del alfabeto base64url, igual que los que emite el backend. */
const TOKEN = 'kZ8mQ2vXpL4nR7tY1wE5sD9fG3hJ6kM0aB2cE4g';

const CONTRASENA = 'una contrasena larga y normal';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function montar(ruta = `/restablecer?token=${TOKEN}`): RenderResult {
  const cliente = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={[ruta]}>
        <Routes>
          <Route path="/restablecer" element={<Restablecer />} />
          <Route path="/entrar" element={<p>Pantalla de inicio de sesion</p>} />
          <Route path="/recuperar" element={<p>Pantalla de pedir recuperacion</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * Sustituto de `fetch` que declara su firma.
 *
 * Sin declarar los parametros, `vi.fn` los tipa como una tupla vacia y
 * `mock.calls` deja de decir QUE se le paso. Lo que se comprueba aqui —que el
 * token viaje tal cual vino, que la peticion salga sin token de acceso— pasaria
 * a ser "existe la propiedad", que se cumple igual cuando la peticion va mal.
 */
function peticionMock(
  respuesta: () => Promise<Response>
): Mock<(entrada: RequestInfo | URL, opciones?: RequestInit) => Promise<Response>> {
  return vi.fn(async (_entrada: RequestInfo | URL, _opciones?: RequestInit) => respuesta());
}

type Llamada = ReturnType<typeof peticionMock>;

/** Un 204: el unico cuerpo que tiene este endpoint. */
function contrasenaCambiada(): Llamada {
  const llamada = peticionMock(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', llamada);
  return llamada;
}

/** Cuerpo de error tal como lo arma `toErrorResponse`. */
function falloDelServidor(estado: number, cuerpo: Record<string, unknown>): Llamada {
  const llamada = peticionMock(
    async () =>
      new Response(JSON.stringify(cuerpo), {
        status: estado,
        headers: { 'content-type': 'application/json' },
      })
  );
  vi.stubGlobal('fetch', llamada);
  return llamada;
}

function cuerpoDe(llamada: Llamada): Record<string, string> {
  const opciones = llamada.mock.calls.at(-1)?.[1];
  return JSON.parse(String(opciones?.body ?? '{}')) as Record<string, string>;
}

async function escribir(contrasena: string, confirmacion: string): Promise<void> {
  fireEvent.change(screen.getByLabelText(/Contrasena nueva/u), { target: { value: contrasena } });
  fireEvent.change(screen.getByLabelText(/Repita la contrasena/u), {
    target: { value: confirmacion },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar contrasena' }));
}

/**
 * Espera a que la peticion salga de verdad.
 *
 * La mutacion tarda varios `await` en llegar al `fetch`, asi que comprobar las
 * llamadas en el mismo tick en que se pulsa el boton mide el reloj, no la
 * pantalla: la prueba pasaria o fallaria por como estea escrito el codigo y no
 * por lo que hace.
 */
async function esperarPeticion(llamada: Llamada): Promise<void> {
  await waitFor(() => {
    expect(llamada).toHaveBeenCalled();
  });
}

describe('el token llega desde el enlace del correo', () => {
  it('se manda tal cual vino en la cadena de consulta', async () => {
    const llamada = contrasenaCambiada();
    montar();

    await escribir(CONTRASENA, CONTRASENA);
    await esperarPeticion(llamada);

    const [url, opciones] = llamada.mock.calls[0] ?? [];
    expect(String(url)).toBe('/api/v1/auth/password-reset');
    expect(opciones?.method).toBe('POST');
    // Ruta publica: el enlace del correo llega sin sesion y debe seguir asi.
    expect((opciones?.headers as Record<string, string>)['authorization']).toBeUndefined();
    expect(cuerpoDe(llamada)).toEqual({
      token: TOKEN,
      contrasena: CONTRASENA,
      confirmacionContrasena: CONTRASENA,
    });
  });

  it('un token percent-encoded se decodifica antes de mandarlo', async () => {
    const llamada = contrasenaCambiada();
    montar(`/restablecer?token=${encodeURIComponent(TOKEN)}`);

    await escribir(CONTRASENA, CONTRASENA);
    await esperarPeticion(llamada);

    expect(cuerpoDe(llamada)['token']).toBe(TOKEN);
  });

  it('sin token no se ofrece el formulario: no hay nada que enviar', () => {
    montar('/restablecer');

    expect(screen.queryByLabelText(/Contrasena nueva/u)).toBeNull();
    // Y se dice por que, con la salida: una pantalla en blanco deja a la
    // persona pensando que la aplicacion fallo.
    expect(screen.getByRole('link', { name: /Pedir un enlace nuevo/u }).getAttribute('href')).toBe(
      '/recuperar'
    );
  });
});

describe('validacion antes de viajar', () => {
  it('unas contrasenas que no coinciden se anuncian y no se envia nada', async () => {
    const llamada = contrasenaCambiada();
    montar();

    await escribir(CONTRASENA, 'otra distinta');

    expect(screen.getByRole('alert').textContent).toContain('no coinciden');
    expect(llamada).not.toHaveBeenCalled();
  });

  it('una contrasena demasiado corta se anuncia en su campo', async () => {
    const llamada = contrasenaCambiada();
    montar();

    await escribir('corta', 'corta');

    expect(screen.getByRole('alert').textContent).toContain('12');
    expect(llamada).not.toHaveBeenCalled();
  });

  it('lo obligatorio se dice con texto, no solo con un asterisco', () => {
    contrasenaCambiada();
    montar();

    expect(screen.getAllByText('(obligatorio)')).toHaveLength(2);
  });

  it('el error se borra al seguir escribiendo', async () => {
    contrasenaCambiada();
    montar();

    await escribir(CONTRASENA, 'otra distinta');
    expect(screen.getByRole('alert')).toBeDefined();

    fireEvent.change(screen.getByLabelText(/Repita la contrasena/u), {
      target: { value: CONTRASENA },
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('el enlace ya no sirve', () => {
  /**
   * El backend responde 401 con el mismo texto para un token caducado que para
   * uno inventado, y con razon: distinguirlos permitiria averiguar que enlaces
   * existieron. La pantalla dice lo mismo y ofrece la unica salida, pedir otro.
   */
  it('lo explica y ofrece pedir un enlace nuevo en lugar de otro intento', async () => {
    falloDelServidor(401, {
      code: 'UNAUTHENTICATED',
      message: 'El enlace de recuperacion ya no es valido.',
      correlationId: 'c1',
    });
    montar();

    await escribir(CONTRASENA, CONTRASENA);

    const aviso = await screen.findByRole('alert');
    expect(aviso.textContent).toContain('valido');
    expect(screen.getByRole('link', { name: /Pedir un enlace nuevo/u }).getAttribute('href')).toBe(
      '/recuperar'
    );
    // Un token de un solo uso no se reintenta: dejar el formulario invites a
    // una segunda peticion que va a fallar igual.
    expect(screen.queryByLabelText(/Contrasena nueva/u)).toBeNull();
  });

  it('no sugiere que el correo este mal escrito', async () => {
    falloDelServidor(401, {
      code: 'UNAUTHENTICATED',
      message: 'El enlace de recuperacion ya no es valido.',
      correlationId: 'c1',
    });
    montar();

    await escribir(CONTRASENA, CONTRASENA);
    const aviso = await screen.findByRole('alert');

    expect(aviso.textContent).not.toMatch(/correo|contrasena incorrecta/iu);
  });
});

describe('errores por campo del servidor', () => {
  it('se pintan junto al campo que nombran', async () => {
    // El backend llama `confirmacionContrasena` al campo que aqui se llama
    // `confirmacion`: si la pantalla no tradujera el nombre, el aviso caeria en
    // un banner generico y habria que adivinar a que campo pertenece.
    falloDelServidor(422, {
      code: 'VALIDATION_FAILED',
      message: 'Los datos enviados no son validos.',
      correlationId: 'c1',
      details: [
        { field: 'contrasena', message: 'Use al menos cinco caracteres distintos.' },
        { field: 'confirmacionContrasena', message: 'Debe coincidir con la contrasena.' },
      ],
    });
    montar();

    await escribir(CONTRASENA, CONTRASENA);

    // Se espera a que lleguen: los dos avisos los pinta la respuesta del
    // servidor, y buscarlos en el mismo tick mediria el reloj, no la pantalla.
    const alertas = await screen.findAllByRole('alert');
    expect(alertas).toHaveLength(2);
    expect(alertas[0]?.textContent).toContain('cinco caracteres distintos');
    expect(alertas[1]?.textContent).toContain('Debe coincidir');
  });
});

describe('la contrasena queda cambiada', () => {
  it('confirma, recuerda que se cerraron las sesiones y deja entrar', async () => {
    contrasenaCambiada();
    montar();

    await escribir(CONTRASENA, CONTRASENA);

    const aviso = await screen.findByRole('status');
    expect(aviso.textContent).toContain('sesiones');
    expect(screen.getByRole('link', { name: 'Entrar' }).getAttribute('href')).toBe('/entrar');
  });

  it('el formulario desaparece para que no se reenvie', async () => {
    contrasenaCambiada();
    montar();

    await escribir(CONTRASENA, CONTRASENA);
    await screen.findByRole('status');

    expect(screen.queryByLabelText(/Contrasena nueva/u)).toBeNull();
  });

  it('lleva el foco a la confirmacion', async () => {
    contrasenaCambiada();
    montar();

    await escribir(CONTRASENA, CONTRASENA);
    const aviso = await screen.findByRole('status');

    /**
     * El foco va al BLOQUE de confirmacion, no al boton que acaba de desaparecer
     * —que es lo que dejaria al tabulador en el cuerpo del documento, sin nada
     * que leer— ni al aviso en si, que ya avisa con su propio `role="status"`.
     */
    await waitFor(() => {
      const activo = document.activeElement;
      expect(activo).not.toBe(document.body);
      expect(activo?.contains(aviso)).toBe(true);
    });
  });
});

describe('lo que se dice ante un fallo', () => {
  it('un limite de peticiones se explica sin insinuar nada sobre la cuenta', async () => {
    falloDelServidor(429, {
      code: 'RATE_LIMITED',
      message: 'Demasiadas peticiones.',
      correlationId: 'c1',
    });
    montar();

    await escribir(CONTRASENA, CONTRASENA);

    const aviso = await screen.findByRole('alert');
    expect(aviso.textContent).toMatch(/demasiad/iu);
    expect(aviso.textContent).not.toMatch(/registrad|existe/iu);
  });

  it('una caida de red no se disfraza de otro problema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('red caida');
      })
    );
    montar();

    await escribir(CONTRASENA, CONTRASENA);

    expect((await screen.findByRole('alert')).textContent).toMatch(/conexion/iu);
  });
});
