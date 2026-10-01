import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSesion } from '../autenticacion/ContextoSesion';
import { ErrorApi } from '../api/cliente';
import { Aviso, Boton, Campo, Tarjeta } from '../ui';

/**
 * Inicio de sesion.
 *
 * El mensaje de error NO distingue "ese correo no existe" de "esa contrasena no
 * es". El servidor devuelve lo mismo en los dos casos a proposito, y la
 * interfaz no debe deshacer eso: distinguirlos convertiria la pantalla en un
 * verificador de que correos estan registrados.
 */
export default function Entrar() {
  const { entrar } = useSesion();
  const navegar = useNavigate();
  const ubicacion = useLocation();

  const [correo, setCorreo] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  /** A donde queria ir antes de que le pidieran iniciar sesion. */
  const destino = (ubicacion.state as { destino?: string } | null)?.destino ?? '/';

  const enviar = async (evento: React.FormEvent): Promise<void> => {
    evento.preventDefault();
    setError(null);
    setEnviando(true);

    try {
      await entrar(correo.trim(), contrasena);
      navegar(destino, { replace: true });
    } catch (fallo) {
      if (fallo instanceof ErrorApi) {
        /**
         * El bloqueo por intentos SI se dice, y no es una contradiccion con lo
         * anterior: a esas alturas quien lo ve ya demostro conocer la cuenta, y
         * callarselo lo deja reintentando contra una puerta cerrada sin saber
         * por que.
         */
        setError(
          fallo.estado === 423
            ? 'La cuenta esta bloqueada temporalmente por varios intentos fallidos. Espere unos minutos.'
            : fallo.estado === 429
              ? 'Demasiados intentos. Espere un momento antes de volver a probar.'
              : 'El correo o la contrasena no son correctos.'
        );
      } else {
        setError('No se pudo conectar. Revise su conexion e intentelo de nuevo.');
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div style={{ maxWidth: '26rem', marginInline: 'auto' }}>
      <h1>Entrar</h1>
      <p className="pa-tarjeta__meta" style={{ marginBottom: 'var(--esp-6)' }}>
        Use el correo con el que creo su cuenta.
      </p>

      <Tarjeta>
        {error !== null && <Aviso tono="error">{error}</Aviso>}

        <form onSubmit={(ev) => void enviar(ev)} noValidate>
          <Campo
            etiqueta="Correo"
            name="correo"
            type="email"
            // `username` ayuda al gestor de contrasenas a guardar la pareja.
            autoComplete="username"
            inputMode="email"
            requerido
            value={correo}
            onChange={(ev) => setCorreo(ev.target.value)}
          />
          <Campo
            etiqueta="Contrasena"
            name="contrasena"
            type="password"
            autoComplete="current-password"
            requerido
            value={contrasena}
            onChange={(ev) => setContrasena(ev.target.value)}
          />

          <Boton type="submit" completo cargando={enviando}>
            Entrar
          </Boton>
        </form>
      </Tarjeta>

      <p style={{ marginTop: 'var(--esp-4)', textAlign: 'center' }}>
        No tiene cuenta? <Link to="/registro">Crear una</Link>
      </p>
    </div>
  );
}
