import { Link } from 'react-router-dom';
import { useMisPropuestas, useRetirarPropuesta } from '../api/hooks';
import {
  Boton,
  Cargando,
  SelloEstado,
  Tarjeta,
  Vacio,
  formatearDinero,
} from '../ui';

/** Las propuestas que envio el oferente (SRS RF145). */
export default function MisPropuestas() {
  const propuestas = useMisPropuestas();
  const retirar = useRetirarPropuesta();

  return (
    <>
      <h1>Mis propuestas</h1>

      {propuestas.isPending && <Cargando que="sus propuestas" />}

      {propuestas.data !== undefined && propuestas.data.elementos.length === 0 && (
        <Vacio
          titulo="Todavia no ha enviado propuestas"
          accion={
            <Link to="/necesidades" className="pa-boton pa-boton--primario">
              Ver necesidades abiertas
            </Link>
          }
        >
          Revise las necesidades abiertas y envie su propuesta con precio y plazo.
        </Vacio>
      )}

      <div className="pa-pila pa-pila--4">
        {(propuestas.data?.elementos ?? []).map((p) => (
          <Tarjeta key={p.id}>
            <div className="pa-fila pa-fila--separada">
              <strong>{formatearDinero(p.precio)}</strong>
              <SelloEstado estado={p.estado} />
            </div>
            <p className="pa-tarjeta__meta">
              {p.tiempoEstimado} {p.tiempoEstimado === 1 ? 'dia' : 'dias'} · necesidad{' '}
              <Link to={`/necesidades/${p.idNecesidad}`}>#{p.idNecesidad}</Link>
            </p>
            <p style={{ marginTop: 'var(--esp-2)', whiteSpace: 'pre-wrap' }}>{p.mensaje}</p>

            {/* Solo las que siguen ENVIADA se pueden retirar: una ya decidida
                no es retirable y mostrar el boton solo confundiria. */}
            {p.estado === 'ENVIADA' && (
              <div style={{ marginTop: 'var(--esp-3)' }}>
                <Boton
                  variante="peligro"
                  cargando={retirar.isPending}
                  onClick={() => void retirar.mutateAsync(p.id)}
                >
                  Retirar propuesta
                </Boton>
              </div>
            )}
          </Tarjeta>
        ))}
      </div>
    </>
  );
}
