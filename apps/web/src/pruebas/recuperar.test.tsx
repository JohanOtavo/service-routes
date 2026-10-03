import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen, waitFor, type RenderResult } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Recuperar from '../paginas/Recuperar';

/**
 * Pruebas de la pantalla de pedir recuperacion.
 *
 * La garantia que se protege aqui es una sola y es la mas importante del
 * formulario: la respuesta es la MISMA exista o no la cuenta. El servidor lo
 * decide asi a proposito, y una interfaz que se lovarez rompiendolo
 * devolveria el formulario a ser un verificador de que correos estan
 * registrados. Por eso la prueba no mira el texto palabra por palabra: monta la
 * pantalla dos veces, con dos correos distintos y compara lo que se pinta.
 */

const MENSAJE_SERVIDOR = 'Si el correo esta registrado, recibira instrucciones para continuar.';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function montar(): RenderResult {
  const cliente = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={['/recuperar']}>
        <Routes>
          <Route path="/recuperar" element={<Recuperar />} />
          <Route path="/entrar" element={<p>Pantalla de inicio de sesion</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/**
 * Sustituto de `fetch` que declara su firma.
 *
 * Sin declarar los parametros, `vi.fn` los tipa como una tupla vacia y
 * `mock.calls` deja de decir QUE se le paso. Lo que se comprobaba entonces —que
 * la peticion vaya sin token, que el cuerpo sea el que se cree— pasaria a ser
 * "existe la propiedad", que se cumple igual cuando la peticion va mal.
 */
function peticionMock(
  respuesta: () => Promise<Response>
): Mock<(entrada: RequestInfo | URL, opciones?: RequestInit) => Promise<Response>> {
  return vi.fn(async (_entrada: RequestInfo | URL, _opciones?: RequestInit) => respuesta());
}

type Llamada = ReturnType<typeof peticionMock>;

/** Un 202 tal cual lo devuelve el backend: siempre, exista o no la cuenta. */
function aceptarPeticcion(): Llamada {
  const llamada = peticionMock(
    async () =>
      new Response(JSON.stringify({ mensaje: MENSAJE_SERVIDOR }), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      })
  );
  vi.stubGlobal('fetch', llamada);
  return llamada;
}

/** Un error tal como lo arma `toErrorResponse`. */
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

/** Escribe el correo y envia el formulario, como haria una persona. */
async function pedir(correo: string): Promise<void> {
  fireEvent.change(screen.getByLabelText(/Correo/u), { target: { value: correo } });
  fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));
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

describe('la confirmacion no revela si la cuenta existe', () => {
  /**
   * La prueba de la propiedad, no de una frase: si un dia alguien "mejora" el
   * aviso escribiendo "hemos enviado un correo a...", esta comparacion falla.
   */
  it('es exactamente la misma con un correo que no esta registrado', async () => {
    aceptarPeticcion();
    const primera = montar();

    await pedir('nadie-esta-registrado@example.com');
    const textoAjeno = await screen.findByRole('status').then((n) => n.textContent);
    primera.unmount();

    aceptarPeticcion();
    montar();

    await pedir('alguien-registrado@example.com');
    const textoPropio = await screen.findByRole('status').then((n) => n.textContent);

    expect(textoAjeno).toBe(textoPropio);
  });

  it('reproduce el condicional del servidor y no afirma nada como cierto', async () => {
    aceptarPeticcion();
    montar();

    await pedir('quien-sea@example.com');

    const aviso = await screen.findByRole('status');
    // El servidor ya redacta la frase sin afirmar que la cuenta exista; lo que
    // hace falta es no contradecirla.
    expect(aviso.textContent).toContain(MENSAJE_SERVIDOR);
    expect(aviso.textContent).not.toMatch(
      /hemos enviado|le enviamos|le hemos enviado|su correo existe|ya hay una cuenta|su cuenta existe/iu
    );
  });

  /** Repetir lo escrito no aporta nada y empuja a confirmar un correo mal. */
  it('no repite el correo escrito en el aviso', async () => {
    aceptarPeticcion();
    montar();

    await pedir('escrito-mal@example.com');

    expect((await screen.findByRole('status')).textContent).not.toContain(
      'escrito-mal@example.com'
    );
  });

  it('deja volver a entrar', async () => {
    aceptarPeticcion();
    montar();

    await pedir('quien-sea@example.com');
    await screen.findByRole('status');

    expect(screen.getByRole('link', { name: 'Entrar' }).getAttribute('href')).toBe('/entrar');
  });

  /**
   * Sin esto, quien navega con teclado se queda pulsando en un sitio muerto: el
   * boton desaparece y el foco se queda en el cuerpo, sin contexto.
   */
  it('lleva el foco a la confirmacion', async () => {
    aceptarPeticcion();
    montar();

    await pedir('quien-sea@example.com');
    const aviso = await screen.findByRole('status');

    /**
     * El foco va al BLOQUE de confirmacion, no al boton que acaba de desaparecer
     * —que es lo que dejaria al tabulador en el cuerpo del documento, sin nada
     * que leer— ni al aviso en si, que ya avisa con su propio `role="status"` y
     * no necesita ser el punto de foco.
     */
    await waitFor(() => {
      const activo = document.activeElement;
      expect(activo).not.toBe(document.body);
      expect(activo?.contains(aviso)).toBe(true);
    });
  });
});

describe('validacion del formulario', () => {
  it('un correo vacio se anuncia junto a su campo', async () => {
    const llamada = aceptarPeticcion();
    montar();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));

    // `role="alert"` es lo que hace que el lector lo diga sin que la persona
    // tenga que llegar navegando hasta el final del campo.
    expect(screen.getByRole('alert').textContent).toContain('correo');
    expect(llamada).not.toHaveBeenCalled();
  });

  it('el campo con error queda marcado como invalido y descrito', async () => {
    aceptarPeticcion();
    montar();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));

    const campo = screen.getByLabelText(/Correo/u);
    expect(campo.getAttribute('aria-invalid')).toBe('true');
    expect(campo.getAttribute('aria-describedby')).toContain('correo-error');
  });

  it('un correo que no parece correo se anuncia antes de viajar', async () => {
    const llamada = aceptarPeticcion();
    montar();

    await pedir('esto-no-es-un-correo');

    expect(screen.getByRole('alert').textContent).toBeDefined();
    expect(llamada).not.toHaveBeenCalled();
  });

  /** Regañar por algo que la persona ya esta corrigiendo. */
  it('el error se borra al seguir escribiendo', async () => {
    aceptarPeticcion();
    montar();

    fireEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));
    expect(screen.getByRole('alert')).toBeDefined();

    fireEvent.change(screen.getByLabelText(/Correo/u), { target: { value: 'a@b.co' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('el campo obligatorio se dice con texto, no solo con un asterisco', () => {
    aceptarPeticcion();
    montar();

    expect(screen.getByText('(obligatorio)')).toBeDefined();
  });
});

describe('lo que responde el servidor', () => {
  it('manda el correo por la ruta publica y sin token adjunto', async () => {
    const llamada = aceptarPeticcion();
    montar();

    await pedir('  con-espacios@example.com  ');
    await esperarPeticion(llamada);

    const [url, opciones] = llamada.mock.calls[0] ?? [];
    expect(String(url)).toBe('/api/v1/auth/password-recovery');
    expect(opciones?.method).toBe('POST');
    // Ruta publica: mandar un token de acceso aqui solo crearia una sesion que
    // renovar en una pantalla de la que nadie sale con sesion.
    expect((opciones?.headers as Record<string, string>)['authorization']).toBeUndefined();
    expect(cuerpoDe(llamada)).toEqual({ correo: 'con-espacios@example.com' });
  });

  it('un 429 se explica y el formulario sigue disponible', async () => {
    falloDelServidor(429, {
      code: 'RATE_LIMITED',
      message: 'Demasiadas peticiones.',
      correlationId: 'c1',
    });
    montar();

    await pedir('quien-sea@example.com');

    expect(await screen.findByRole('alert')).toBeDefined();
    // Un limite de peticiones NO es un fallo definitivo: puede volver a
    // intentarse, asi que el formulario no desaparece.
    expect(screen.getByRole('button', { name: 'Enviar enlace' })).toBeDefined();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('una caida de red lo dice sin insinuar nada sobre la cuenta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('red caida');
      })
    );
    montar();

    await pedir('quien-sea@example.com');

    const error = await screen.findByRole('alert');
    expect(error.textContent).toMatch(/conexion/iu);
    expect(error.textContent).not.toMatch(/registrad|existe/iu);
  });

  it('el boton se bloquea mientras la peticion esta en vuelo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined))
    );
    montar();

    await pedir('quien-sea@example.com');

    const boton = screen.getByRole('button', { name: 'Un momento…' });
    expect((boton as HTMLButtonElement).disabled).toBe(true);
    expect(boton.getAttribute('aria-busy')).toBe('true');
  });
});
