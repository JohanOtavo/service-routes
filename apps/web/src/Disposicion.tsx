import type { ReactElement } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useSesion } from './autenticacion/ContextoSesion';
import { modoDePantalla, useModo } from './autenticacion/ContextoModo';
import { useNoLeidas } from './api/hooks';
import { Boton, ConmutadorModo, type Modo } from './ui';
import './disposicion.css';

/**
 * Cabecera y marco de la aplicacion.
 *
 * El menu muestra solo lo que el rol de la persona puede usar. Es comodidad, no
 * seguridad: el servidor decide en cada endpoint. Pero ensenar seis opciones de
 * las que cuatro devuelven 403 convierte la navegacion en una adivinanza.
 *
 * Con los dos roles a la vez hay ademas que elegir de que lado se mira
 * (SRS 3.3.3), y el conmutador tambien es solo comodidad: cambiar el modo a mano
 * desde la barra de direcciones no da acceso a nada, porque el servidor comprueba
 * el rol en cada endpoint (SRS RNF23).
 */

/** Destino de cada enlace, para no repetir la cadena dentro del JSX. */
interface Enlace {
  texto: string;
  ruta: string;
}

/**
 * Enlaces de quien busca un servicio.
 *
 * "Mis servicios" NO va con los dos grupos: en esta aplicacion quien publica
 * servicios tiene un perfil de prestador que los reune, asi que duplicarlo
 * seriaensenar dos caminos al mismo sitio.
 */
const DE_SOLICITANTE: readonly Enlace[] = [
  { texto: 'Buscar servicios', ruta: '/servicios' },
  { texto: 'Mis necesidades', ruta: '/mis-necesidades' },
];

const DE_OFERENTE: readonly Enlace[] = [
  { texto: 'Necesidades', ruta: '/necesidades' },
  { texto: 'Mis propuestas', ruta: '/mis-propuestas' },
];

/** Enlaces de la cabecera, segun los roles y el modo. */
export function enlacesDeCabecera(
  roles: readonly string[],
  modo: Modo,
  conSesion: boolean
): readonly Enlace[] {
  const esSolicitante = roles.includes('SOLICITANTE');
  const esOferente = roles.includes('OFERENTE');

  let propios: readonly Enlace[];

  if (esSolicitante && esOferente) {
    /**
     * Con los dos roles, el menu entero cambia con el modo.
     *
     * Es lo que pide el SRS y es lo que hace falta: a quien ofrece y a la vez
     * busca le sirve ver solo lo que tiene delante, no las ocho opciones de las
     * que cuatro serian suyas y cuatro no.
     */
    propios = modo === 'oferente' ? DE_OFERENTE : DE_SOLICITANTE;
  } else if (esOferente) {
    // Solo ofrece: busca tambien es suya, porque el catalogo es publico.
    propios = [{ texto: 'Buscar servicios', ruta: '/servicios' }, ...DE_OFERENTE];
  } else if (esSolicitante) {
    propios = DE_SOLICITANTE;
  } else {
    // Sin sesion solo se ve el catalogo, que es lo unico publico.
    propios = conSesion ? [] : DE_SOLICITANTE.slice(0, 1);
  }

  if (!conSesion) return propios;

  return [
    ...propios,
    { texto: 'Mis contrataciones', ruta: '/contrataciones' },
    { texto: 'Avisos', ruta: '/avisos' },
  ];
}

export function Disposicion(): ReactElement {
  const { sesion, tieneRol, salir } = useSesion();
  const { modo, puedeElegir, cambiarModo } = useModo();
  const navegar = useNavigate();
  const ubicacion = useLocation();
  // Solo con sesion: sin ella la peticion daria 401 en cada pantalla publica.
  const noLeidas = useNoLeidas();

  const roles = sesion?.usuario.roles ?? [];
  const enlaces = enlacesDeCabecera(roles, modo, sesion !== null);

  const cerrar = async (): Promise<void> => {
    await salir();
    navegar('/');
  };

  /**
   * Cambia el modo y lleva a la pantalla que le corresponde.
   *
   * Solo se mueve si la pantalla actual es EXCLUSIVA del otro modo. En una
   * pantalla compartida —las contrataciones, los avisos, la cuenta— quedarse
   * donde esta es lo correcto: quien esta revisando sus contrataciones no ha
   * pedido que le cambien la pantalla de debajo. Y quien estaba en "Necesidades"
   * se va a la pantalla de inicio de su nuevo modo, porque si no se queda
   * mirando una pantalla que su menu ya no menciona.
   */
  const cambiarVista = (destino: Modo): void => {
    const dueña = modoDePantalla(ubicacion.pathname);
    cambiarModo(destino);

    if (dueña === null || dueña === destino) return;
    navegar(destino === 'oferente' ? '/necesidades' : '/servicios');
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

          {/*
            El conmutador va FUERA de `<nav>` y no dentro.
            Cambiar de vista no es navegar: es cambiar que conjunto de enlaces
            existe. Meterlo en el menu lo declararia parte de la navegacion y
            haria que un lector de pantalla lo anunciara como un destino mas.
            Su lugar natural es al lado del menu, que es lo que cambia.
          */}
          {puedeElegir && <ConmutadorModo modo={modo} alCambiar={cambiarVista} />}

          <nav className="pa-nav" aria-label="Navegacion principal">
            {enlaces.map((enlace) => (
              <NavLink key={enlace.ruta} to={enlace.ruta} className="pa-nav__enlace">
                {/*
                  El contador de avisos va pegado a su enlace y no al resto. Se
                  mantiene aqui dentro porque pertenece a ESTA entrada del menu:
                  si el modo cambia, desaparece con ella, que es lo correcto.
                */}
                {enlace.ruta === '/avisos' ? (
                  <>
                    Avisos
                    {/* El numero es decorativo para el lector: el texto ya lo dice. */}
                    {noLeidas.data !== undefined && noLeidas.data.noLeidas > 0 && (
                      <>
                        <span className="pa-distintivo" aria-hidden="true">
                          {noLeidas.data.noLeidas > 9 ? '9+' : noLeidas.data.noLeidas}
                        </span>
                        <span className="solo-lectores">, {noLeidas.data.noLeidas} sin leer</span>
                      </>
                    )}
                  </>
                ) : (
                  enlace.texto
                )}
              </NavLink>
            ))}

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

      <main id="contenido" className="pa-seccion">
        <Outlet />
      </main>

      <footer className="pa-pie">
        <div className="contenido">
          <p className="pa-tarjeta__meta">
            Punto Amigo conecta a quien necesita un servicio con quien sabe hacerlo. Los datos de
            contacto se comparten solo cuando las dos partes han acordado un trabajo.
          </p>
        </div>
      </footer>
    </>
  );
}
