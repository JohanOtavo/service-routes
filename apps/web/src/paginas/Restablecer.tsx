import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ErrorApi } from '../api/cliente';
import { useRestablecerContrasena } from '../api/hooks';
import { Aviso, Boton, Campo, Tarjeta } from '../ui';

/** Minimo de la contrasena. El servidor manda; esto solo evita un viaje. */
const MINIMO_CONTRASENA = 12;

/**
 * Traduce el nombre que el contrato da a un campo al que esta pantalla usa.
 *
 * Sin esto, un 422 caeria entero en un banner generico y quien lo leyera
 * tendria que adivinar a que campo pertenecía cada mensaje.
 */
const CAMPO_EN_PANTALLA: Record<string, string> = {
  confirmacionContrasena: 'confirmacion',
};

/**
 * Restablecer la contrasena con el token del enlace (SRS RF13).
 *
 * El token no se escribe: llega en el enlace del correo, en la cadena de
 * consulta. Por eso esta pantalla no es un formulario mas, es el final de un
 * enlace, y se comporta como tal:
 *
 *   - Si el token falta, no se ofrece formulario. Enviarlio vacio solo
 *     produce un 422, y un formulario que no puede tener exito es una promesa
 *     que la pantalla no cumple.
 *   - Si el servidor lo rechaza, el enlace esta muerto —el token es de un solo
 *     uso y caduca— y la unica salida es pedir otro. Se dice eso en lugar de
 *     dejar el formulario para un reintento que va a fallar igual.
 *
 * Tras el cambio el backend revoca todas las sesiones de esa cuenta. Se
 * menciona porque, si no, quien estuviera conectado en otro dispositivo no
 * entiende por que se salio de golpe.
 */
export default function Restablecer(): ReactElement {
  const [consulta] = useSearchParams();
  const restablecer = useRestablecerContrasena();

  /**
   * `URLSearchParams` ya devuelve el valor decodificado, y el backend genera el
   * token en base64url (`randomBytes(32).toString('base64url')`), cuyo alfabeto
   * no contiene `+`. El tipico fallo de "mas" convertido en espacio no puede
   * ocurrir por aqui; lo que si ocurre es un token percent-encoded por quien
   * construye el enlace, y eso lo resuelve el mismo `URLSearchParams`.
   */
  const token = consulta.get('token') ?? '';

  const [datos, setDatos] = useState({ contrasena: '', confirmacion: '' });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  /** Texto del servidor cuando el enlace ya no sirve. `null` mientras sirve. */
  const [enlaceMuerto, setEnlaceMuerto] = useState<string | null>(null);

  const destino = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // El foco tiene que viajar a donde paso la pantalla: si se queda en el
    // boton que acaba de desaparecer, el tabulador lo suelta al cuerpo.
    if (restablecer.isSuccess || enlaceMuerto !== null) destino.current?.focus();
  }, [restablecer.isSuccess, enlaceMuerto]);

  const cambiar =
    (campo: keyof typeof datos) =>
    (evento: React.ChangeEvent<HTMLInputElement>): void => {
      setDatos((previo) => ({ ...previo, [campo]: evento.target.value }));
      setErrores((previo) => {
        const { [campo]: _, ...resto } = previo;
        return resto;
      });
    };

  const validar = (): boolean => {
    const nuevos: Record<string, string> = {};

    if (datos.contrasena.length < MINIMO_CONTRASENA) {
      nuevos['contrasena'] = `Use al menos ${MINIMO_CONTRASENA} caracteres.`;
    }
    if (datos.contrasena !== datos.confirmacion) {
      nuevos['confirmacion'] = 'Las dos contrasenas no coinciden.';
    }

    setErrores(nuevos);
    return Object.keys(nuevos).length === 0;
  };

  const enviar = async (evento: React.FormEvent): Promise<void> => {
    evento.preventDefault();
    setGeneral(null);
    if (!validar()) return;

    try {
      await restablecer.mutateAsync({
        token,
        contrasena: datos.contrasena,
        confirmacionContrasena: datos.confirmacion,
      });
    } catch (problema) {
      /**
       * Una red caida se dice como red caida. El cliente la reporta con estado
       * 503 —igual que un servicio parado— pero con un codigo propio, y sin
       * esa distincion caeria el mensaje de capacidad, que habla de "comprobar
       * su sesion" en una pantalla donde no hay ninguna que comprobar.
       */
      if (!(problema instanceof ErrorApi) || problema.codigo === 'RED_NO_DISPONIBLE') {
        setGeneral('No se pudo conectar. Revise su conexion e intentelo de nuevo.');
        return;
      }

      /**
       * El token es de un solo uso y caduca, asi que cuando el servidor lo
       * rechaza esta muerto. El backend devuelve el mismo 401 para uno
       * caducado que para uno inventado, y con razon: distinguirlos permitiria
       * averiguar que enlaces existieron. Aqui solo se translate el mensaje y
       * se ofrece la unica salida que queda.
       */
      if (problema.codigo === 'UNAUTHENTICATED') {
        setEnlaceMuerto(problema.message);
        return;
      }

      if (problema.estado === 429) {
        setGeneral('Demasiadas peticiones. Espere unos minutos antes de intentarlo de nuevo.');
        return;
      }

      if (problema.detalles.length > 0) {
        // Los errores por campo se pintan junto a su campo, no en un banner.
        setErrores(
          Object.fromEntries(
            problema.detalles.map((d) => [CAMPO_EN_PANTALLA[d.field] ?? d.field, d.message])
          )
        );
        return;
      }

      setGeneral(problema.message);
    }
  };

  const cambioHecho = restablecer.isSuccess;

  /** Estado terminal sin formulario: o el enlace no trajo token, o ya no vale. */
  if (token === '' || enlaceMuerto !== null) {
    return (
      <div style={{ maxWidth: '28rem', marginInline: 'auto' }}>
        <h1>Restablecer contrasena</h1>

        <Tarjeta>
          <div ref={destino} tabIndex={-1}>
            <Aviso tono="error" titulo="El enlace no sirve">
              {enlaceMuerto ?? 'Este enlace no trae el codigo de recuperacion.'}
            </Aviso>
          </div>

          <p className="pa-tarjeta__meta" style={{ marginTop: 'var(--esp-4)' }}>
            Los enlaces caducan pasado un tiempo y valen una sola vez. Pida uno nuevo y abra el
            correo mas reciente: abrir uno viejo no funciona.
          </p>

          <div style={{ marginTop: 'var(--esp-6)' }}>
            <Link className="pa-boton pa-boton--primario" to="/recuperar">
              Pedir un enlace nuevo
            </Link>
          </div>
        </Tarjeta>
      </div>
    );
  }

  if (cambioHecho) {
    return (
      <div style={{ maxWidth: '28rem', marginInline: 'auto' }}>
        <h1>Restablecer contrasena</h1>

        <Tarjeta>
          <div ref={destino} tabIndex={-1}>
            <Aviso tono="exito" titulo="Contrasena cambiada">
              Ya puede entrar con la nueva. Por seguridad se cerraron todas las sesiones abiertas de
              esta cuenta, en cualquier dispositivo, asi que tendra que volver a entrar en cada uno.
            </Aviso>
          </div>

          <div style={{ marginTop: 'var(--esp-6)' }}>
            <Link className="pa-boton pa-boton--primario" to="/entrar">
              Entrar
            </Link>
          </div>
        </Tarjeta>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '28rem', marginInline: 'auto' }}>
      <h1>Restablecer contrasena</h1>
      <p className="pa-tarjeta__meta" style={{ marginBottom: 'var(--esp-6)' }}>
        Elija la contrasena que usara desde ahora en adelante.
      </p>

      <Tarjeta>
        {general !== null && <Aviso tono="error">{general}</Aviso>}

        <form onSubmit={(ev) => void enviar(ev)} noValidate>
          <Campo
            etiqueta="Contrasena nueva"
            name="contrasena"
            type="password"
            autoComplete="new-password"
            requerido
            ayuda={`Al menos ${MINIMO_CONTRASENA} caracteres.`}
            error={errores['contrasena']}
            value={datos.contrasena}
            onChange={cambiar('contrasena')}
          />
          <Campo
            etiqueta="Repita la contrasena"
            name="confirmacion"
            type="password"
            autoComplete="new-password"
            requerido
            error={errores['confirmacion']}
            value={datos.confirmacion}
            onChange={cambiar('confirmacion')}
          />

          <Boton type="submit" completo cargando={restablecer.isPending}>
            Cambiar contrasena
          </Boton>
        </form>
      </Tarjeta>

      <p style={{ marginTop: 'var(--esp-4)', textAlign: 'center' }}>
        Cambio de opinion? <Link to="/entrar">Volver a entrar</Link>
      </p>
    </div>
  );
}
