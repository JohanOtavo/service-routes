import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { ErrorApi } from '../api/cliente';
import { usePedirRecuperacion } from '../api/hooks';
import { Aviso, Boton, Campo, Tarjeta } from '../ui';

/**
 * Pedir el enlace para recuperar la contrasena (SRS RF12).
 *
 * Lo que gobierna esta pantalla es una negativa: no se puede decir si el correo
 * esta registrado. El servidor ya responde igual en los dos casos, y una
 * pantalla que anadiera "ese correo no existe" —aunque solo en el error— lo
 * desharia y devolveria el formulario a ser un verificador de cuentas
 * registradas. Por eso el 202 se muestra con la REDACCION DEL SERVIDOR, tal
 * cual, y por eso no se repite el correo escrito: confirmar un dato que la
 * persona acaba de teclear no le aporta nada y empuja a confirmar uno mal.
 *
 * Un 429 si se dice, y no es contradiccion con lo anterior: a esas alturas quien
 * lo ve ya ha enviado varias peticiones y de ellas no se deduce nada sobre la
 * cuenta.
 */
export default function Recuperar(): ReactElement {
  const enviarEnlace = usePedirRecuperacion();

  const [correo, setCorreo] = useState('');
  const [errorCorreo, setErrorCorreo] = useState<string | undefined>(undefined);
  const [fallo, setFallo] = useState<string | null>(null);

  /** Destino del foco cuando el formulario desaparece bajo los dedos. */
  const confirmacion = useRef<HTMLDivElement>(null);

  const enviado = enviarEnlace.isSuccess;

  useEffect(() => {
    // Sin esto, quien navega con teclado se queda con el foco en un boton que ya
    // no existe: el tabulador lo suelta al cuerpo y no hay nada que leer ahi.
    if (enviado) confirmacion.current?.focus();
  }, [enviado]);

  const cambiar = (evento: React.ChangeEvent<HTMLInputElement>): void => {
    setCorreo(evento.target.value);
    // El error se borra al escribir: dejarlo mientras corrigen es reganarle por
    // algo que ya estan arreglando.
    setErrorCorreo(undefined);
  };

  const enviar = async (evento: React.FormEvent): Promise<void> => {
    evento.preventDefault();
    setFallo(null);

    const limpio = correo.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(limpio)) {
      setErrorCorreo('Ese correo no parece valido.');
      return;
    }
    setErrorCorreo(undefined);

    try {
      await enviarEnlace.mutateAsync(limpio);
    } catch (problema) {
      setFallo(mensajeDe(problema));
    }
  };

  if (enviado) {
    return (
      <div style={{ maxWidth: '28rem', marginInline: 'auto' }}>
        <h1>Recuperar contrasena</h1>

        <Tarjeta>
          {/*
            El envoltorio existe solo para recibir el foco: `Aviso` ya avisa por
            si mismo con `role="status"`, y duplicar ese rol dentro haria que un
            lector de pantalla anunciase la misma frase dos veces.
          */}
          <div ref={confirmacion} tabIndex={-1}>
            <Aviso tono="exito" titulo="Revise su correo">
              {/*
                El texto del servidor se pinta tal cual. Reescribirlo para
                "confirmar" el envio convertiria esta pantalla en un oraculo
                de cuentas existentes: quien probara correos sabria cuales
                estan registrados. El servidor responde siempre con la misma
                frase, neutra, precisamente para que esto no se pueda leer.
              */}
              {enviarEnlace.data?.mensaje ??
                'Si el correo esta registrado, recibira instrucciones para continuar.'}
            </Aviso>
          </div>

          <p className="pa-tarjeta__meta" style={{ marginTop: 'var(--esp-4)' }}>
            El enlace caduca pasado un tiempo y se puede usar una sola vez, asi que abra el correo
            mas reciente. Revise tambien la carpeta de correo no deseado. Si no ha pedido este
            cambio, no tiene que hacer nada.
          </p>

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
      <h1>Recuperar contrasena</h1>
      <p className="pa-tarjeta__meta" style={{ marginBottom: 'var(--esp-6)' }}>
        Escriba el correo de su cuenta. Le llegara un enlace para poder cambiarla.
      </p>

      <Tarjeta>
        {fallo !== null && <Aviso tono="error">{fallo}</Aviso>}

        <form onSubmit={(ev) => void enviar(ev)} noValidate>
          <Campo
            etiqueta="Correo"
            name="correo"
            type="email"
            // Aqui no es `username` como en el inicio de sesion: no hay una
            // pareja que guardar con un gestor de contrasenas, es un correo
            // suelto.
            autoComplete="email"
            inputMode="email"
            requerido
            error={errorCorreo}
            value={correo}
            onChange={cambiar}
          />

          <Boton type="submit" completo cargando={enviarEnlace.isPending}>
            Enviar enlace
          </Boton>
        </form>
      </Tarjeta>

      <p style={{ marginTop: 'var(--esp-4)', textAlign: 'center' }}>
        Si ya sabe su contrasena? <Link to="/entrar">Entrar</Link>
      </p>
    </div>
  );
}

/**
 * Traduce el fallo a algo que sirva, sin decir nada sobre la cuenta.
 *
 * Una red caida SI se distingue del resto, y no por el estado —el cliente la
 * reporta como 503, igual que un servicio parado— sino por el codigo que le
 * pone. Sin esa distincion caeria aqui el "No se pudo enviar la solicitud",
 * que no dice si hay que revisar la conexion o esperar un rato. Y el texto
 * generico por omision del cliente ("No se pudo completar la operacion") no
 * orienta a nadie: se nombra la accion que se puede repetir despues.
 */
function mensajeDe(problema: unknown): string {
  if (!(problema instanceof ErrorApi) || problema.codigo === 'RED_NO_DISPONIBLE') {
    return 'No se pudo conectar. Revise su conexion e intentelo de nuevo.';
  }

  return problema.estado === 429
    ? 'Ha pedido demasiadas recuperaciones. Espere unos minutos antes de intentarlo de nuevo.'
    : 'No se pudo enviar la solicitud. Intentelo de nuevo en unos minutos.';
}
