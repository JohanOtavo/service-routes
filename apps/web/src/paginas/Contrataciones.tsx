import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMisContrataciones } from '../api/hooks';
import { useSesion } from '../autenticacion/ContextoSesion';
import {
  Aviso,
  Boton,
  Cargando,
  SelloEstado,
  Tarjeta,
  Vacio,
  formatearDinero,
  formatearFecha,
} from '../ui';

/**
 * Las contrataciones propias, en el papel que se elija.
 *
 * El papel es una pestana y no algo deducido del rol, porque la MISMA persona
 * puede ser las dos cosas (SRS RF165): deducirlo del rol dejaria a quien tiene
 * ambos viendo solo una de sus dos bandejas sin saber que falta la otra.
 */
export default function Contrataciones() {
  const { tieneRol } = useSesion();
  const [como, setComo] = useState<'SOLICITANTE' | 'OFERENTE'>('SOLICITANTE');
  const contrataciones = useMisContrataciones(como);

  const esOferente = tieneRol('OFERENTE');

  return (
    <>
      <h1>Mis contrataciones</h1>

      {esOferente && (
        <div
          className="pa-fila"
          role="tablist"
          aria-label="Ver como"
          style={{ margin: 'var(--esp-4) 0' }}
        >
          <Boton
            variante={como === 'SOLICITANTE' ? 'primario' : 'secundario'}
            role="tab"
            aria-selected={como === 'SOLICITANTE'}
            onClick={() => setComo('SOLICITANTE')}
          >
            Lo que contrate
          </Boton>
          <Boton
            variante={como === 'OFERENTE' ? 'primario' : 'secundario'}
            role="tab"
            aria-selected={como === 'OFERENTE'}
            onClick={() => setComo('OFERENTE')}
          >
            Lo que me pidieron
          </Boton>
        </div>
      )}

      {contrataciones.isPending && <Cargando que="sus contrataciones" />}

      {contrataciones.isError && (
        <Aviso tono="error" titulo="No se pudieron cargar">
          Intentelo de nuevo en unos momentos.
        </Aviso>
      )}

      {contrataciones.data !== undefined && contrataciones.data.elementos.length === 0 && (
        <Vacio
          titulo={
            como === 'SOLICITANTE'
              ? 'Todavia no ha contratado nada'
              : 'Todavia no le han pedido nada'
          }
          accion={
            como === 'SOLICITANTE' ? (
              <Link to="/servicios" className="pa-boton pa-boton--primario">
                Buscar un servicio
              </Link>
            ) : (
              <Link to="/necesidades" className="pa-boton pa-boton--primario">
                Ver necesidades abiertas
              </Link>
            )
          }
        >
          {como === 'SOLICITANTE'
            ? 'Busque un servicio en el catalogo, o publique su necesidad para recibir propuestas.'
            : 'Publique sus servicios y responda a las necesidades abiertas para empezar a recibir trabajos.'}
        </Vacio>
      )}

      <div className="pa-pila pa-pila--4">
        {(contrataciones.data?.elementos ?? []).map((s) => (
          <Link
            key={s.id}
            to={`/contrataciones/${s.id}`}
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <Tarjeta pulsable>
              <div className="pa-fila pa-fila--separada">
                <h2 className="pa-tarjeta__titulo">
                  {s.descripcionProblema.length > 70
                    ? `${s.descripcionProblema.slice(0, 70)}…`
                    : s.descripcionProblema}
                </h2>
                <SelloEstado estado={s.estado} />
              </div>
              <p className="pa-tarjeta__meta">
                {formatearFecha(s.fechaSolicitud)}
                {s.origen === 'ADJUDICACION' ? ' · por adjudicacion' : ' · del catalogo'}
                {s.valorAcordado !== null && ` · ${formatearDinero(s.valorAcordado)}`}
                {s.plazoAcordado !== null && ` · ${s.plazoAcordado} dias`}
              </p>
            </Tarjeta>
          </Link>
        ))}
      </div>
    </>
  );
}
