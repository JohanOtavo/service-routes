import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ErrorApi, pedir } from '../api/cliente';
import { useSesion } from '../autenticacion/ContextoSesion';
import { Aviso, Boton, Campo, Tarjeta } from '../ui';
import { z } from 'zod';

const respuestaRegistro = z.object({ id: z.number(), correo: z.string() });

/** Minimo de la contrasena. El servidor manda; esto solo evita un viaje. */
const MINIMO_CONTRASENA = 12;

/**
 * Alta de cuenta.
 *
 * Valida en el cliente lo que el servidor ya valida, y eso no es duplicar por
 * duplicar: ahorra un viaje y da el aviso junto al campo en lugar de en un
 * banner arriba. Lo que NO hace es confiar en esta validacion: el servidor
 * vuelve a comprobarlo todo.
 */
export default function Registro() {
  const navegar = useNavigate();
  const { entrar } = useSesion();

  const [datos, setDatos] = useState({
    nombre: '',
    correo: '',
    telefono: '',
    contrasena: '',
    confirmacion: '',
  });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const cambiar = (campo: keyof typeof datos) => (ev: React.ChangeEvent<HTMLInputElement>) => {
    setDatos((previo) => ({ ...previo, [campo]: ev.target.value }));
    // El error del campo se borra al escribir: dejarlo puesto mientras la
    // persona corrige es regañarla por algo que ya esta arreglando.
    setErrores((previo) => {
      const { [campo]: _, ...resto } = previo;
      return resto;
    });
  };

  const validar = (): boolean => {
    const nuevos: Record<string, string> = {};

    if (datos.nombre.trim().length < 2) nuevos['nombre'] = 'Escriba su nombre.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/u.test(datos.correo.trim())) {
      nuevos['correo'] = 'Ese correo no parece valido.';
    }
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

    setEnviando(true);
    try {
      await pedir('/api/v1/auth/register', respuestaRegistro, {
        metodo: 'POST',
        publica: true,
        cuerpo: {
          nombre: datos.nombre.trim(),
          correo: datos.correo.trim(),
          contrasena: datos.contrasena,
          confirmacionContrasena: datos.confirmacion,
          ...(datos.telefono.trim() === '' ? {} : { telefono: datos.telefono.trim() }),
        },
      });

      // Se entra directo: pedirle iniciar sesion justo despues de registrarse
      // es un paso que no aporta nada.
      await entrar(datos.correo.trim(), datos.contrasena);
      navegar('/', { replace: true });
    } catch (fallo) {
      if (fallo instanceof ErrorApi) {
        if (fallo.estado === 409) {
          setGeneral('Ya existe una cuenta con ese correo. Pruebe a entrar.');
        } else if (fallo.detalles.length > 0) {
          // Los errores por campo del servidor se pintan junto a su campo.
          setErrores(
            Object.fromEntries(fallo.detalles.map((d) => [d.field, d.message]))
          );
        } else {
          setGeneral(fallo.message);
        }
      } else {
        setGeneral('No se pudo conectar. Revise su conexion e intentelo de nuevo.');
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div style={{ maxWidth: '28rem', marginInline: 'auto' }}>
      <h1>Crear cuenta</h1>
      <p className="pa-tarjeta__meta" style={{ marginBottom: 'var(--esp-6)' }}>
        Con una sola cuenta puede contratar servicios y, si quiere, ofrecer los suyos.
      </p>

      <Tarjeta>
        {general !== null && <Aviso tono="error">{general}</Aviso>}

        <form onSubmit={(ev) => void enviar(ev)} noValidate>
          <Campo
            etiqueta="Nombre"
            name="nombre"
            autoComplete="name"
            requerido
            error={errores['nombre']}
            value={datos.nombre}
            onChange={cambiar('nombre')}
          />
          <Campo
            etiqueta="Correo"
            name="correo"
            type="email"
            autoComplete="username"
            inputMode="email"
            requerido
            error={errores['correo']}
            value={datos.correo}
            onChange={cambiar('correo')}
          />
          <Campo
            etiqueta="Telefono"
            name="telefono"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            ayuda="Opcional. Solo se comparte cuando usted acuerda un trabajo."
            error={errores['telefono']}
            value={datos.telefono}
            onChange={cambiar('telefono')}
          />
          <Campo
            etiqueta="Contrasena"
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

          <Boton type="submit" completo cargando={enviando}>
            Crear cuenta
          </Boton>
        </form>
      </Tarjeta>

      <p style={{ marginTop: 'var(--esp-4)', textAlign: 'center' }}>
        Ya tiene cuenta? <Link to="/entrar">Entrar</Link>
      </p>
    </div>
  );
}
