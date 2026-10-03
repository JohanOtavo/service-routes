import { useState, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorApi } from '../api/cliente';
import { useContratarServicio, usePerfilPublico, useServicio } from '../api/hooks';
import { useSesion } from '../autenticacion/ContextoSesion';
import { Aviso, AreaTexto, Boton, Cargando, Sello, Tarjeta, Vacio } from '../ui';

const MINIMO_DESCRIPCION = 10;

/**
 * Ficha de un servicio y contratacion.
 *
 * Esta pantalla NO muestra telefono ni correo del oferente, ni los tiene: el
 * backend no los envia. El contacto aparece en el detalle de la contratacion y
 * solo cuando el oferente ha aceptado.
 */
export default function Servicio(): ReactElement {
  const { id } = useParams();
  const idServicio = Number(id);
  const navegar = useNavigate();
  const { sesion } = useSesion();

  const servicio = useServicio(idServicio);
  const prestador = usePerfilPublico(servicio.data?.idPrestador ?? 0);
  const contratar = useContratarServicio();

  const [descripcion, setDescripcion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState(false);

  const enviar = async (evento: React.FormEvent): Promise<void> => {
    evento.preventDefault();
    setError(null);

    if (descripcion.trim().length < MINIMO_DESCRIPCION) {
      setError(`Cuente el problema con al menos ${MINIMO_DESCRIPCION} caracteres.`);
      return;
    }

    try {
      const creada = await contratar.mutateAsync({
        idServicio,
        descripcionProblema: descripcion.trim(),
      });
      // Se va al detalle: es donde vera si el oferente acepta y, entonces, el
      // contacto.
      navegar(`/contrataciones/${creada.id}`);
    } catch (fallo) {
      if (fallo instanceof ErrorApi) {
        setError(
          fallo.estado === 409 ? 'Ese servicio ya no esta disponible, o es suyo.' : fallo.message
        );
      } else {
        setError('No se pudo enviar la solicitud. Intentelo de nuevo.');
      }
    }
  };

  if (servicio.isPending) return <Cargando que="el servicio" />;

  if (servicio.isError) {
    const noExiste = servicio.error instanceof ErrorApi && servicio.error.noEncontrado;
    return (
      <Vacio
        titulo={noExiste ? 'Este servicio no esta disponible' : 'No se pudo cargar el servicio'}
        accion={
          <Link to="/servicios" className="pa-boton pa-boton--primario">
            Ver otros servicios
          </Link>
        }
      >
        {noExiste
          ? 'Puede que el oferente lo haya retirado, o que su perfil ya no este activo.'
          : 'Intentelo de nuevo en unos momentos.'}
      </Vacio>
    );
  }

  const s = servicio.data;

  return (
    <div style={{ maxWidth: '48rem' }}>
      <p className="pa-tarjeta__meta">
        <Link to="/servicios">Servicios</Link>
      </p>
      <h1 style={{ marginTop: 'var(--esp-2)' }}>{s.nombre}</h1>

      <div className="pa-fila" style={{ marginTop: 'var(--esp-3)' }}>
        {s.reputacion !== undefined &&
          (s.reputacion.totalCalificaciones === 0 ? (
            <Sello tono="neutro">Sin calificaciones todavia</Sello>
          ) : (
            <Sello tono="exito">
              {s.reputacion.puntuacionMedia.toFixed(1)} de 5 · {s.reputacion.totalCalificaciones}{' '}
              {s.reputacion.totalCalificaciones === 1 ? 'opinion' : 'opiniones'}
            </Sello>
          ))}
        {prestador.data?.validado === true && <Sello tono="validado">Perfil validado</Sello>}
      </div>

      <Tarjeta>
        <h2 className="pa-tarjeta__titulo">Que incluye</h2>
        {/* Texto de una persona, pintado como texto. React lo escapa, y en esta
            aplicacion no existe ninguna via para inyectar HTML. */}
        <p style={{ whiteSpace: 'pre-wrap' }}>{s.descripcion}</p>
      </Tarjeta>

      {prestador.data !== undefined && (
        <Tarjeta>
          <h2 className="pa-tarjeta__titulo">Quien lo ofrece</h2>
          <p>
            <strong>{prestador.data.nombre}</strong>
            {' · '}
            {prestador.data.especialidad}
          </p>
          {prestador.data.experiencia !== null && (
            <p style={{ marginTop: 'var(--esp-2)', whiteSpace: 'pre-wrap' }}>
              {prestador.data.experiencia}
            </p>
          )}
          {prestador.data.disponibilidad !== null && (
            <p className="pa-tarjeta__meta" style={{ marginTop: 'var(--esp-2)' }}>
              Disponibilidad: {prestador.data.disponibilidad}
            </p>
          )}
          <p className="pa-tarjeta__meta" style={{ marginTop: 'var(--esp-3)' }}>
            Podra contactarle cuando acepte su solicitud.
          </p>
        </Tarjeta>
      )}

      <Tarjeta>
        <h2 className="pa-tarjeta__titulo">Solicitar este servicio</h2>

        {sesion === null ? (
          <>
            <p className="pa-tarjeta__meta">
              Necesita una cuenta para solicitar. Es gratis y toma un minuto.
            </p>
            <div className="pa-fila" style={{ marginTop: 'var(--esp-4)' }}>
              <Link to="/registro" className="pa-boton pa-boton--primario">
                Crear cuenta
              </Link>
              <Link to="/entrar" className="pa-boton pa-boton--secundario">
                Entrar
              </Link>
            </div>
          </>
        ) : !abierto ? (
          <Boton variante="acento" onClick={() => setAbierto(true)}>
            Solicitar este servicio
          </Boton>
        ) : (
          <form onSubmit={(ev) => void enviar(ev)} noValidate>
            {error !== null && <Aviso tono="error">{error}</Aviso>}

            <AreaTexto
              etiqueta="Cuente que necesita"
              name="descripcionProblema"
              requerido
              ayuda="Describa el problema. Cuanto mas claro, mejor sabra el oferente si puede ayudarle."
              value={descripcion}
              onChange={(ev) => setDescripcion(ev.target.value)}
            />

            <div className="pa-fila">
              <Boton type="submit" variante="acento" cargando={contratar.isPending}>
                Enviar solicitud
              </Boton>
              <Boton variante="fantasma" onClick={() => setAbierto(false)}>
                Cancelar
              </Boton>
            </div>
          </form>
        )}
      </Tarjeta>
    </div>
  );
}
