import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cerrarSesion, iniciarSesion, recuperarSesion } from '../api/cliente';
import { obtenerSesion, suscribirse, type Sesion } from '../api/sesion';

/**
 * Sesion para el arbol de componentes.
 *
 * El estado vive en `api/sesion.ts`, no aqui, porque el cliente HTTP lo
 * necesita al renovar tras un 401 y eso ocurre fuera de React.
 * `useSyncExternalStore` es la forma correcta de leer un estado externo: evita
 * el desgarro que produce guardar una copia en `useState` y actualizarla a mano.
 */

interface Contexto {
  sesion: Sesion | null;
  /** `null` mientras se intenta recuperar la sesion al arrancar. */
  comprobando: boolean;
  entrar: (correo: string, contrasena: string) => Promise<void>;
  salir: () => Promise<void>;
  tieneRol: (...roles: readonly string[]) => boolean;
}

const ContextoSesion = createContext<Contexto | null>(null);

export function ProveedorSesion({ children }: { children: ReactNode }): ReactElement {
  const sesion = useSyncExternalStore(suscribirse, obtenerSesion, () => null);
  const [comprobando, setComprobando] = useState(true);

  /**
   * Al arrancar se intenta recuperar la sesion con la cookie de refresco.
   *
   * Hace falta porque el access token vive solo en memoria y una recarga lo
   * borra. Sin este paso, recargar la pagina sacaria a la persona de la
   * aplicacion aunque su sesion siguiera viva.
   */
  useEffect(() => {
    let vivo = true;

    void recuperarSesion().finally(() => {
      // Si el componente se desmonto, no se toca su estado: evita el aviso de
      // actualizacion sobre un componente desmontado.
      if (vivo) setComprobando(false);
    });

    return () => {
      vivo = false;
    };
  }, []);

  const entrar = useCallback(async (correo: string, contrasena: string) => {
    await iniciarSesion(correo, contrasena);
  }, []);

  const salir = useCallback(async () => {
    await cerrarSesion();
  }, []);

  /**
   * Comprueba el rol para DECIDIR QUE MOSTRAR, nunca para autorizar.
   *
   * La autorizacion de verdad la hace el servidor en cada endpoint. Esto solo
   * evita ensenar un boton que va a devolver 403: ocultar la opcion es una
   * comodidad, no un control de acceso (SRS RNF23).
   */
  const tieneRol = useCallback(
    (...roles: readonly string[]) =>
      roles.some((rol) => sesion?.usuario.roles.includes(rol) === true),
    [sesion]
  );

  return (
    <ContextoSesion.Provider value={{ sesion, comprobando, entrar, salir, tieneRol }}>
      {children}
    </ContextoSesion.Provider>
  );
}

export function useSesion(): Contexto {
  const contexto = useContext(ContextoSesion);
  if (contexto === null) {
    throw new Error('useSesion se usa dentro de ProveedorSesion.');
  }
  return contexto;
}
