import { useState, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorApi } from '../api/cliente';
import { useEnviarPropuesta, useMisServicios, useNecesidad } from '../api/hooks';
import {
  Aviso,
  AreaTexto,
  Boton,
  Campo,
  Cargando,
  Selector,
  Tarjeta,
  Vacio,
  formatearDinero,
  formatearFecha,
} from '../ui';

/** Detalle de una necesidad y envio de propuesta (SRS RF137, RF138). */
export default function Necesidad(): ReactElement {
  const { id } = useParams();
  const idNecesidad = Number(id);
  const navegar = useNavigate();

  const necesidad = useNecesidad(idNecesidad);
  const misServicios = useMisServicios();
  const enviar = useEnviarPropuesta();

  const [datos, setDatos] = useState({
    precio: '',
    tiempoEstimado: '',
    mensaje: '',
    idServicio: '',
  });
  const [error, setError] = useState<string | null>(null);

  const proponer = async (evento: React.FormEvent): Promise<void> => {
    evento.preventDefault();
    setError(null);

    try {
      await enviar.mutateAsync({
        idNecesidad,
        precio: datos.precio.trim(),
        tiempoEstimado: Number(datos.tiempoEstimado),
        mensaje: datos.mensaje.trim(),
        idServicio: datos.idServicio === '' ? null : Number(datos.idServicio),
      });
      navegar('/mis-propuestas');
    } catch (fallo) {
      if (fallo instanceof ErrorApi) {
        setError(
          fallo.detalles.length > 0 ? fallo.detalles.map((d) => d.message).join(' ') : fallo.message
        );
      } else {
        setError('No se pudo enviar la propuesta. Intentelo de nuevo.');
      }
    }
  };

  if (necesidad.isPending) return <Cargando que="la necesidad" />;

  if (necesidad.isError) {
    return (
      <Vacio
        titulo="Esta necesidad ya no esta abierta"
        accion={
          <Link to="/necesidades" className="pa-boton pa-boton--primario">
            Ver otras necesidades
          </Link>
        }
      >
        Puede que su autor la haya cerrado, que ya haya elegido una propuesta o que se le haya
        vencido el plazo.
      </Vacio>
    );
  }

  const n = necesidad.data;

  return (
    <div style={{ maxWidth: '48rem' }}>
      <p className="pa-tarjeta__meta">
        <Link to="/necesidades">Necesidades</Link>
      </p>
      <h1 style={{ marginTop: 'var(--esp-2)' }}>{n.titulo}</h1>
      <p className="pa-tarjeta__meta">
        {n.ubicacionAproximada !== null && `${n.ubicacionAproximada} · `}
        vigente hasta el {formatearFecha(n.fechaVigencia)}
        {n.fechaDeseada !== null && ` · la quieren para el ${formatearFecha(n.fechaDeseada)}`}
      </p>

      <Tarjeta>
        <h2 className="pa-tarjeta__titulo">Que piden</h2>
        <p style={{ whiteSpace: 'pre-wrap' }}>{n.descripcion}</p>
        {n.presupuestoEstimado !== null && (
          <p className="pa-tarjeta__meta" style={{ marginTop: 'var(--esp-3)' }}>
            Presupuesto aproximado: {formatearDinero(n.presupuestoEstimado)}
          </p>
        )}
      </Tarjeta>

      <Tarjeta>
        <h2 className="pa-tarjeta__titulo">Enviar una propuesta</h2>
        <p className="pa-tarjeta__meta">
          Solo el autor de la necesidad vera su propuesta. Los demas oferentes no saben que precio
          puso.
        </p>

        {error !== null && <Aviso tono="error">{error}</Aviso>}

        <form onSubmit={(ev) => void proponer(ev)} noValidate style={{ marginTop: 'var(--esp-4)' }}>
          <Campo
            etiqueta="Su precio"
            name="precio"
            inputMode="decimal"
            requerido
            ayuda="En pesos, sin puntos. Por ejemplo: 150000"
            value={datos.precio}
            onChange={(ev) => setDatos((p) => ({ ...p, precio: ev.target.value }))}
          />
          <Campo
            etiqueta="En cuantos dias"
            name="tiempoEstimado"
            type="number"
            inputMode="numeric"
            min={1}
            requerido
            value={datos.tiempoEstimado}
            onChange={(ev) => setDatos((p) => ({ ...p, tiempoEstimado: ev.target.value }))}
          />
          <AreaTexto
            etiqueta="Como lo haria"
            name="mensaje"
            requerido
            ayuda="Al menos 10 caracteres. Explique que incluye y como lo resolveria."
            value={datos.mensaje}
            onChange={(ev) => setDatos((p) => ({ ...p, mensaje: ev.target.value }))}
          />

          {(misServicios.data?.elementos ?? []).length > 0 && (
            <Selector
              etiqueta="Adjuntar uno de sus servicios"
              name="idServicio"
              vacio="Sin adjuntar"
              ayuda="Opcional. Le deja ver su trabajo publicado y sus calificaciones."
              value={datos.idServicio}
              onChange={(ev) => setDatos((p) => ({ ...p, idServicio: ev.target.value }))}
              opciones={(misServicios.data?.elementos ?? []).map((s) => ({
                valor: String(s.id),
                texto: s.nombre,
              }))}
            />
          )}

          <Boton type="submit" variante="acento" cargando={enviar.isPending}>
            Enviar propuesta
          </Boton>
        </form>
      </Tarjeta>
    </div>
  );
}
