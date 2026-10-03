import { lazy, Suspense, type ReactElement } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Disposicion } from './Disposicion';
import { RutaProtegida } from './autenticacion/RutaProtegida';
import { Cargando } from './ui';

/**
 * Tabla de rutas.
 *
 * Todas las pantallas van en carga diferida menos la portada. Quien llega por
 * primera vez solo descarga la portada y el armazon; el resto baja cuando hace
 * falta. En un movil con datos contados eso es la diferencia entre entrar y
 * cerrar la pestana.
 *
 * `roles` en `RutaProtegida` decide QUE SE MUESTRA, no quien puede. La
 * autorizacion la hace el servidor en cada endpoint (SRS RNF23).
 */

const Portada = lazy(() => import('./paginas/Portada'));
const Entrar = lazy(() => import('./paginas/Entrar'));
const Registro = lazy(() => import('./paginas/Registro'));
// Recuperacion de contrasena. Publicas a proposito: son precisamente las que
// ve quien ya no puede entrar. Sin estas rutas, el enlace "Olvide mi contrasena"
// de la pantalla de acceso caia en el 404.
const Recuperar = lazy(() => import('./paginas/Recuperar'));
const Restablecer = lazy(() => import('./paginas/Restablecer'));
const Servicios = lazy(() => import('./paginas/Servicios'));
const Servicio = lazy(() => import('./paginas/Servicio'));
const MiPerfilPrestador = lazy(() => import('./paginas/MiPerfilPrestador'));
const Necesidades = lazy(() => import('./paginas/Necesidades'));
const Necesidad = lazy(() => import('./paginas/Necesidad'));
const MisNecesidades = lazy(() => import('./paginas/MisNecesidades'));
const MisPropuestas = lazy(() => import('./paginas/MisPropuestas'));
const Contrataciones = lazy(() => import('./paginas/Contrataciones'));
const Contratacion = lazy(() => import('./paginas/Contratacion'));
const Avisos = lazy(() => import('./paginas/Avisos'));
const MiCuenta = lazy(() => import('./paginas/MiCuenta'));
const Administracion = lazy(() => import('./paginas/Administracion'));
const NoEncontrada = lazy(() => import('./paginas/NoEncontrada'));

export function App(): ReactElement {
  return (
    <Routes>
      <Route element={<Disposicion />}>
        {/* Publicas: el gateway las deja pasar sin token. */}
        <Route
          index
          element={
            <Pantalla>
              <Portada />
            </Pantalla>
          }
        />
        <Route
          path="entrar"
          element={
            <Pantalla>
              <Entrar />
            </Pantalla>
          }
        />
        <Route
          path="registro"
          element={
            <Pantalla>
              <Registro />
            </Pantalla>
          }
        />
        <Route
          path="recuperar"
          element={
            <Pantalla>
              <Recuperar />
            </Pantalla>
          }
        />
        {/* El token no va en la ruta: llega en la cadena de consulta del enlace
            que va en el correo, y la pantalla lo lee de ahi. */}
        <Route
          path="restablecer"
          element={
            <Pantalla>
              <Restablecer />
            </Pantalla>
          }
        />
        <Route
          path="servicios"
          element={
            <Pantalla>
              <Servicios />
            </Pantalla>
          }
        />
        <Route
          path="servicios/:id"
          element={
            <Pantalla>
              <Servicio />
            </Pantalla>
          }
        />

        {/* Oferente */}
        <Route
          path="mi-perfil-prestador"
          element={
            <Pantalla>
              <RutaProtegida roles={['OFERENTE']}>
                <MiPerfilPrestador />
              </RutaProtegida>
            </Pantalla>
          }
        />
        <Route
          path="necesidades"
          element={
            <Pantalla>
              <RutaProtegida roles={['OFERENTE']}>
                <Necesidades />
              </RutaProtegida>
            </Pantalla>
          }
        />
        <Route
          path="necesidades/:id"
          element={
            <Pantalla>
              <RutaProtegida roles={['OFERENTE']}>
                <Necesidad />
              </RutaProtegida>
            </Pantalla>
          }
        />
        <Route
          path="mis-propuestas"
          element={
            <Pantalla>
              <RutaProtegida roles={['OFERENTE']}>
                <MisPropuestas />
              </RutaProtegida>
            </Pantalla>
          }
        />

        {/* Solicitante */}
        <Route
          path="mis-necesidades"
          element={
            <Pantalla>
              <RutaProtegida roles={['SOLICITANTE']}>
                <MisNecesidades />
              </RutaProtegida>
            </Pantalla>
          }
        />

        {/* Cualquiera con sesion: las contrataciones las ven las dos partes. */}
        <Route
          path="contrataciones"
          element={
            <Pantalla>
              <RutaProtegida>
                <Contrataciones />
              </RutaProtegida>
            </Pantalla>
          }
        />
        <Route
          path="contrataciones/:id"
          element={
            <Pantalla>
              <RutaProtegida>
                <Contratacion />
              </RutaProtegida>
            </Pantalla>
          }
        />
        <Route
          path="avisos"
          element={
            <Pantalla>
              <RutaProtegida>
                <Avisos />
              </RutaProtegida>
            </Pantalla>
          }
        />
        <Route
          path="mi-cuenta"
          element={
            <Pantalla>
              <RutaProtegida>
                <MiCuenta />
              </RutaProtegida>
            </Pantalla>
          }
        />

        <Route
          path="administracion/*"
          element={
            <Pantalla>
              <RutaProtegida roles={['ADMINISTRADOR']}>
                <Administracion />
              </RutaProtegida>
            </Pantalla>
          }
        />

        <Route
          path="*"
          element={
            <Pantalla>
              <NoEncontrada />
            </Pantalla>
          }
        />
      </Route>
    </Routes>
  );
}

/** Envoltura de carga diferida, para no repetir el Suspense en cada ruta. */
function Pantalla({ children }: { children: React.ReactNode }): ReactElement {
  return <Suspense fallback={<Cargando que="la pantalla" />}>{children}</Suspense>;
}
