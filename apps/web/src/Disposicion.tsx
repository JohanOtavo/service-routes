import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useSesion } from './autenticacion/ContextoSesion';
import { useNoLeidas } from './api/hooks';
import { Boton } from './ui';
import './disposicion.css';

/**
 * Cabecera y marco de la aplicacion.
 *
 * El menu muestra solo lo que el rol de la persona puede usar. Es comodidad, no
 * seguridad: el servidor decide en cada endpoint. Pero ensenar seis opciones de
 * las que cuatro devuelven 403 convierte la navegacion en una adivinanza.
 */
export function Disposicion() {
  const { sesion, tieneRol, salir } = useSesion();
  const navegar = useNavigate();
  // Solo con sesion: sin ella la peticion daria 401 en cada pantalla publica.
  const noLeidas = useNoLeidas();

  const cerrar = async (): Promise<void> => {
    await salir();
    navegar('/');
  };

  return (
    <>
      {/* Primer elemento enfocable: quien navega con teclado no deberia tener
          que recorrer el menu en cada pantalla. */}
      <a className="salto-contenido" href="#contenido">
        Saltar al contenido
      </a>

      <header className="pa-cabecera">
        <div className="contenido pa-cabecera__interior">
          <Link to="/" className="pa-marca">
            <span className="pa-marca__punto" aria-hidden="true" />
            Punto Amigo
          </Link>

          <nav className="pa-nav" aria-label="Navegacion principal">
            <NavLink to="/servicios" className="pa-nav__enlace">
              Buscar servicios
            </NavLink>

            {tieneRol('OFERENTE') && (
              <NavLink to="/necesidades" className="pa-nav__enlace">
                Necesidades
              </NavLink>
            )}

            {sesion !== null && (
              <NavLink to="/contrataciones" className="pa-nav__enlace">
                Mis contrataciones
              </NavLink>
            )}

            {sesion !== null && (
              <NavLink to="/avisos" className="pa-nav__enlace">
                Avisos
                {/* El numero es decorativo para el lector: el texto ya lo dice. */}
                {noLeidas.data !== undefined && noLeidas.data.noLeidas > 0 && (
                  <>
                    <span className="pa-distintivo" aria-hidden="true">
                      {noLeidas.data.noLeidas > 9 ? '9+' : noLeidas.data.noLeidas}
                    </span>
                    <span className="solo-lectores">
                      , {noLeidas.data.noLeidas} sin leer
                    </span>
                  </>
                )}
              </NavLink>
            )}

            {tieneRol('ADMINISTRADOR') && (
              <NavLink to="/administracion" className="pa-nav__enlace">
                Administracion
              </NavLink>
            )}
          </nav>

          <div className="pa-fila">
            {sesion === null ? (
              <>
                <Link to="/entrar" className="pa-boton pa-boton--fantasma">
                  Entrar
                </Link>
                <Link to="/registro" className="pa-boton pa-boton--primario">
                  Crear cuenta
                </Link>
              </>
            ) : (
              <>
                <Link to="/mi-cuenta" className="pa-nav__enlace pa-nav__enlace--yo">
                  {sesion.usuario.nombre === '' ? 'Mi cuenta' : sesion.usuario.nombre}
                </Link>
                <Boton variante="fantasma" onClick={() => void cerrar()}>
                  Salir
                </Boton>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="contenido" className="contenido pa-seccion">
        <Outlet />
      </main>

      <footer className="pa-pie">
        <div className="contenido">
          <p className="pa-tarjeta__meta">
            Punto Amigo conecta a quien necesita un servicio con quien sabe hacerlo.
            Los datos de contacto se comparten solo cuando las dos partes han
            acordado un trabajo.
          </p>
        </div>
      </footer>
    </>
  );
}
