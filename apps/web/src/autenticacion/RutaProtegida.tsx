import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useSesion } from './ContextoSesion';
import { Aviso, Cargando } from '../ui';

/**
 * Exige sesion, y opcionalmente un rol, para llegar a una pantalla.
 *
 * NO es seguridad. El servidor decide en cada endpoint y responde 401 o 403 sin
 * mirar lo que el navegador crea. Esto existe para que la persona no llegue a
 * una pantalla que no va a poder usar, y para enviarla a iniciar sesion
 * recordando a donde queria ir.
 */
export function RutaProtegida({
  children,
  roles,
}: {
  children: ReactNode;
  roles?: readonly string[];
}) {
  const { sesion, comprobando, tieneRol } = useSesion();
  const ubicacion = useLocation();

  /**
   * Mientras se comprueba NO se redirige.
   *
   * Al recargar, el access token esta en memoria y por tanto vacio durante el
   * instante que tarda la renovacion. Redirigir en ese momento echaria fuera a
   * quien si tiene sesion, en cada recarga.
   */
  if (comprobando) return <Cargando que="su sesion" />;

  if (sesion === null) {
    // `state` guarda a donde iba, para volver ahi despues de entrar. Y
    // `replace` evita que el boton de atras la devuelva al inicio de sesion.
    return <Navigate to="/entrar" replace state={{ destino: ubicacion.pathname }} />;
  }

  if (roles !== undefined && !tieneRol(...roles)) {
    /**
     * Sin el rol no se redirige: se explica.
     *
     * Mandarla al inicio sin decir nada deja a la persona preguntandose si
     * pulso mal. Y un oferente que llega a una pantalla de solicitante
     * necesita saber que le falta un rol, no que se equivoco de enlace.
     */
    return (
      <Aviso tono="aviso" titulo="Esta pantalla no es para su perfil">
        Necesita el rol {roles.join(' o ')} para entrar aqui. Si cree que deberia tenerlo,
        escriba a quien administra la plataforma.
      </Aviso>
    );
  }

  return <>{children}</>;
}
