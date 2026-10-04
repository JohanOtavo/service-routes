import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Contratacion from '../paginas/Contratacion';
import { Cancelar } from '../paginas/partes/Cancelar';
import { ProveedorSesion } from '../autenticacion/ContextoSesion';
import { borrarSesion, guardarSesion } from '../api/sesion';

/**
 * Pruebas del resultado de una cancelacion (pendiente I-6).
 *
 * Lo que se protege aqui no es el formulario, es el mensaje del final: el que
 * dice si la cancelacion cuenta en la tasa y con que peso. Al cancelar, el
 * estado pasa a `CANCELADA` en el mismo instante, y la pantalla desmontaba el
 * formulario con su mensaje dentro, asi que desaparecia antes de que nadie lo
 * leyera. Es la unica vez que se le dice a la persona, y como la plataforma no
 * cobra, la reputacion es su unico instrumento disuasorio: uno que no se ve no
 * disuade.
 *
 * La primera prueba monta la PAGINA y no el componente, a proposito. El defecto
 * no estaba en `Cancelar` —su mensaje siempre se pintaba— sino en la condicion
 * de `Contratacion` que lo desmontaba. Una prueba sobre el componente suelto
 * habria pasado en verde con el defecto puesto.
 */

const MOTIVOS = {
  elementos: [
    {
      codigo: 'IMPREVISTO',
      descripcion: 'Me surgio un imprevisto',
      abreRevision: false,
      exigeDetalle: false,
    },
  ],
};

/** Las seis claves que exige `resultadoCancelacion`: el cliente valida con Zod. */
const RESULTADO = {
  idCancelacion: 31,
  estado: 'CONTABILIZADA',
  franja: 'AJUSTADA',
  peso: 0.5,
  computa: true,
  enRevision: false,
};

function solicitud(estado: string): Record<string, unknown> {
  return {
    id: 7,
    estado,
    origen: 'DIRECTA',
    descripcionProblema: 'Hay una fuga bajo el lavaplatos.',
    idUsuario: 34,
    idPrestador: 1,
    idServicio: null,
    idNecesidad: null,
    idPropuesta: null,
    valorAcordado: '180000.00',
    plazoAcordado: 2,
    fechaSolicitud: '2026-10-04T12:00:00.000Z',
    contacto: { idUsuario: 35, nombre: 'Pedro Oferente', telefono: null, correo: null },
  };
}

beforeEach(() => {
  borrarSesion();
  guardarSesion({
    accessToken: 'token-de-prueba',
    expiraEn: new Date(Date.now() + 15 * 60 * 1000),
    usuario: { id: 34, nombre: 'Marta Solicitante', roles: ['SOLICITANTE'] },
  });
});

afterEach(() => {
  borrarSesion();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function respuesta(cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * `fetch` falso, con el estado del servidor dentro.
 *
 * Se finge la red y no los hooks: el cambio de estado tras cancelar es
 * justamente lo que hacia desaparecer el mensaje, y eso solo ocurre si la
 * consulta se vuelve a pedir y devuelve `CANCELADA`, como en el sistema real.
 */
function fingirRed(): void {
  let estado = 'ACEPTADA';

  vi.stubGlobal(
    'fetch',
    vi.fn((entrada: string, opciones?: RequestInit) => {
      const url = String(entrada);
      void opciones;

      // El catalogo va ANTES: su ruta es `/cancellation-reasons`, que contiene
      // la palabra `cancel`. Con el orden al reves, pedir los motivos se leia
      // como una cancelacion y la pantalla pasaba a CANCELADA sin que nadie
      // cancelara nada.
      if (url.includes('cancellation-reasons')) return Promise.resolve(respuesta(MOTIVOS));
      if (url.includes('/cancel')) {
        estado = 'CANCELADA';
        return Promise.resolve(respuesta(RESULTADO));
      }
      if (url.includes('/auth/refresh'))
        return Promise.resolve(new Response(null, { status: 401 }));
      if (url.includes('/requests/7')) return Promise.resolve(respuesta(solicitud(estado)));

      return Promise.resolve(respuesta({ elementos: [], total: 0, pagina: 1, tamano: 20 }));
    })
  );
}

function montarPagina(): void {
  const cliente = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });

  render(
    <QueryClientProvider client={cliente}>
      <ProveedorSesion>
        <MemoryRouter initialEntries={['/contrataciones/7']}>
          <Routes>
            <Route path="/contrataciones/:id" element={<Contratacion />} />
          </Routes>
        </MemoryRouter>
      </ProveedorSesion>
    </QueryClientProvider>
  );
}

async function cancelarDesdeLaPagina(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /Cancelar la contratacion/u }));

  // Se espera a la OPCION, no al desplegable: el desplegable existe vacio
  // mientras los motivos viajan, y elegir en una lista sin opciones no cambia
  // nada. El boton de confirmar se quedaba desactivado.
  await waitFor(() => {
    expect(screen.getByRole('option', { name: /imprevisto/iu })).toBeTruthy();
  });
  fireEvent.change(screen.getByLabelText(/Por que cancela/u), {
    target: { value: 'IMPREVISTO' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Confirmar la cancelacion/u }));
}

describe('resultado de una cancelacion', () => {
  it('sigue a la vista despues de que la contratacion pase a CANCELADA', async () => {
    // Arrange
    fingirRed();
    montarPagina();

    // Act
    await cancelarDesdeLaPagina();

    // Assert: aparece el mensaje con el peso...
    await waitFor(() => {
      expect(screen.getByText(/La contratacion quedo cancelada/u)).toBeTruthy();
    });
    expect(screen.getByText(/0,5/u)).toBeTruthy();

    // ...y sigue ahi cuando la consulta se refresca y el estado ya es CANCELADA,
    // que es el momento en el que antes se desmontaba. Que el boton de cancelar
    // haya desaparecido demuestra que la pagina ya recibio el estado nuevo.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Cancelar la contratacion/u })).toBeNull();
    });
    expect(screen.getByText(/La contratacion quedo cancelada/u)).toBeTruthy();
    expect(screen.getByText(/0,5/u)).toBeTruthy();
  });

  it('no ofrece cancelar una contratacion que ya estaba cancelada', () => {
    // Arrange y Act: se entra de nuevo a la pantalla, sin haber cancelado aqui.
    const cliente = new QueryClient({
      defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={cliente}>
        <Cancelar idSolicitud={7} estado="CANCELADA" />
      </QueryClientProvider>
    );

    // Assert: ni boton ni mensaje. El resultado se cuenta una vez, a quien
    // cancelo, y no cada vez que alguien abre la contratacion.
    expect(screen.queryByRole('button', { name: /Cancelar la contratacion/u })).toBeNull();
    expect(screen.queryByText(/La contratacion quedo cancelada/u)).toBeNull();
  });
});
