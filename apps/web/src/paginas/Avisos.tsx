import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useAvisos, useMarcarLeida, useMarcarTodasLeidas } from '../api/hooks';
import { Boton, Cargando, Sello, Tarjeta, Vacio, formatearFecha } from '../ui';

/** A donde lleva cada aviso, segun el recurso que menciona. */
function enlaceDe(recursoTipo: string | null, recursoId: number | null): string | null {
  if (recursoTipo === null || recursoId === null) return null;
  switch (recursoTipo) {
    case 'SOLICITUD':
      return `/contrataciones/${recursoId}`;
    case 'NECESIDAD':
      return `/necesidades/${recursoId}`;
    case 'PRESTADOR':
      return '/mi-perfil-prestador';
    default:
      return null;
  }
}

/**
 * La bandeja propia (SRS RF93 a RF95).
 *
 * Cada aviso lleva a su recurso. Un aviso que cuenta que algo paso y no deja ir
 * a verlo obliga a buscarlo a mano, y entonces no ha ahorrado nada.
 */
export default function Avisos(): ReactElement {
  const avisos = useAvisos();
  const marcar = useMarcarLeida();
  const marcarTodas = useMarcarTodasLeidas();

  const hayNoLeidas = (avisos.data?.noLeidas ?? 0) > 0;

  return (
    <div style={{ maxWidth: '44rem' }}>
      <div className="pa-fila pa-fila--separada">
        <h1>Avisos</h1>
        {hayNoLeidas && (
          <Boton
            variante="secundario"
            cargando={marcarTodas.isPending}
            onClick={() => void marcarTodas.mutateAsync()}
          >
            Marcar todas como leidas
          </Boton>
        )}
      </div>

      {avisos.isPending && <Cargando que="sus avisos" />}

      {avisos.data !== undefined && avisos.data.elementos.length === 0 && (
        <Vacio titulo="No tiene avisos">
          Aqui le avisaremos cuando reciba una propuesta, cuando alguien acepte un trabajo o cuando
          pueda calificar.
        </Vacio>
      )}

      <div className="pa-pila pa-pila--2">
        {(avisos.data?.elementos ?? []).map((a) => {
          const enlace = enlaceDe(a.recursoTipo, a.recursoId);
          const noLeida = a.estado === 'NO_LEIDA';

          const cuerpo = (
            <Tarjeta pulsable={enlace !== null}>
              <div className="pa-fila pa-fila--separada">
                <strong>{a.titulo}</strong>
                {noLeida && <Sello tono="info">Nueva</Sello>}
              </div>
              <p style={{ marginTop: 'var(--esp-1)' }}>{a.mensaje}</p>
              <p className="pa-tarjeta__meta" style={{ marginTop: 'var(--esp-2)' }}>
                {formatearFecha(a.fecha)}
              </p>
            </Tarjeta>
          );

          return (
            <div key={a.id}>
              {enlace === null ? (
                cuerpo
              ) : (
                <Link
                  to={enlace}
                  style={{ textDecoration: 'none', color: 'inherit' }}
                  // Abrirlo lo marca leido: pulsar aparte "marcar leida" despues
                  // de haberlo leido es trabajo de mas.
                  onClick={() => {
                    if (noLeida) void marcar.mutateAsync(a.id);
                  }}
                >
                  {cuerpo}
                </Link>
              )}

              {noLeida && enlace === null && (
                <div style={{ marginTop: 'var(--esp-2)' }}>
                  <Boton variante="fantasma" onClick={() => void marcar.mutateAsync(a.id)}>
                    Marcar como leida
                  </Boton>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
