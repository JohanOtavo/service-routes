import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { ProveedorSesion } from './autenticacion/ContextoSesion';
import { App } from './App';
import { ErrorApi } from './api/cliente';
import './estilos/tokens.css';
import './estilos/base.css';

/**
 * Arranque del cliente.
 *
 * La configuracion de React Query esta aqui y no repartida: decide como se
 * comporta TODA la aplicacion ante un fallo de red, y eso no debe depender de
 * lo que cada pantalla recuerde poner.
 */
const cliente = new QueryClient({
  defaultOptions: {
    queries: {
      /**
       * No se reintenta lo que no se arregla reintentando.
       *
       * Un 401, un 403 o un 404 van a dar lo mismo tres veces: reintentarlos
       * solo gasta datos y retrasa el mensaje de error. Un 5xx o una red caida
       * si merecen un segundo intento.
       */
      retry: (intentos, error) => {
        if (error instanceof ErrorApi && error.estado < 500) return false;
        return intentos < 2;
      },
      staleTime: 30_000,
      /**
       * No se vuelve a pedir al volver a la pestana.
       *
       * Por omision React Query refresca al recuperar el foco. En un movil con
       * datos contados, cambiar de aplicacion y volver no deberia costar una
       * ronda de peticiones.
       */
      refetchOnWindowFocus: false,
    },
    mutations: {
      // Una mutacion NUNCA se reintenta sola: reintentar "aceptar contratacion"
      // o "cancelar" podria aplicarla dos veces.
      retry: false,
    },
  },
});

const raiz = document.getElementById('raiz');
if (raiz === null) throw new Error('Falta el elemento #raiz en index.html.');

createRoot(raiz).render(
  <StrictMode>
    <QueryClientProvider client={cliente}>
      <BrowserRouter>
        <ProveedorSesion>
          <App />
        </ProveedorSesion>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
