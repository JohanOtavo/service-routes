import { useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ErrorApi } from '../api/cliente';
import { useCambiarEstado, useContratacion } from '../api/hooks';
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
import { Cancelar } from './partes/Cancelar';
import { Calificar } from './partes/Calificar';

/**
 * Detalle de una contratacion.
 *
 * Es la unica pantalla donde aparecen datos de contacto, y solo cuando el
 * estado paso de PENDIENTE. Esa frontera es lo que sostiene la intermediacion:
 * si el contacto se viera antes, las dos partes se irian por fuera y la
 * plataforma se quedaria sin razon de ser.
 */
export default function Contratacion(): ReactElement {
  const { id } = useParams();
  const idSolicitud = Number(id);
  const { sesion } = useSesion();

  const contratacion = useContratacion(idSolicitud);
  const cambiar = useCambiarEstado();
  const [error, setError] = useState<string | null>(null);

  if (contratacion.isPending) return <Cargando que="la contratacion" />;

  if (contratacion.isError) {
    return (
      <Vacio
        titulo="Esta contratacion no existe"
        accion={
          <Link to="/contrataciones" className="pa-boton pa-boton--primario">
            Ver mis contrataciones
          </Link>
        }
      >
        O no es suya. Si cree que es un error, revise el enlace.
      </Vacio>
    );
  }

  const s = contratacion.data;
  const soySolicitante = s.idUsuario === sesion?.usuario.id;
  const hayAcuerdo = s.estado === 'ACEPTADA' || s.estado === 'COMPLETADA';

  const mover = async (destino: 'ACEPTADA' | 'RECHAZADA' | 'COMPLETADA'): Promise<void> => {
    setError(null);
    try {
      await cambiar.mutateAsync({ id: idSolicitud, destino });
    } catch (fallo) {
      setError(fallo instanceof ErrorApi ? fallo.message : 'No se pudo cambiar el estado.');
    }
  };

  return (
    <div style={{ maxWidth: '48rem' }}>
      <p className="pa-tarjeta__meta">
        <Link to="/contrataciones">Mis contrataciones</Link>
      </p>

      <div className="pa-fila pa-fila--separada" style={{ marginTop: 'var(--esp-2)' }}>
        <h1>Contratacion #{s.id}</h1>
        <SelloEstado estado={s.estado} />
      </div>

      <p className="pa-tarjeta__meta">
        Solicitada el {formatearFecha(s.fechaSolicitud)} ·{' '}
        {s.origen === 'ADJUDICACION' ? 'nacio de una propuesta adjudicada' : 'nacio del catalogo'}
      </p>

      {error !== null && <Aviso tono="error">{error}</Aviso>}

      <Tarjeta>
        <h2 className="pa-tarjeta__titulo">Que se pidio</h2>
        <p style={{ whiteSpace: 'pre-wrap' }}>{s.descripcionProblema}</p>

        {(s.valorAcordado !== null || s.plazoAcordado !== null) && (
          <p className="pa-tarjeta__meta" style={{ marginTop: 'var(--esp-3)' }}>
            {s.valorAcordado !== null && `Acordado: ${formatearDinero(s.valorAcordado)}`}
            {s.plazoAcordado !== null && ` · ${s.plazoAcordado} dias`}
            {/* El precio y el plazo son el acuerdo, no una preferencia: el
                servidor no los deja cambiar despues de pactarlos. */}
          </p>
        )}
      </Tarjeta>

      {/* ─── Contacto ─────────────────────────────────────────────────────*/}
      {hayAcuerdo && s.contacto !== null ? (
        <Tarjeta>
          <h2 className="pa-tarjeta__titulo">Como contactar</h2>
          <p className="pa-tarjeta__meta">
            Ya acordaron el trabajo, asi que pueden coordinarse directamente.
          </p>
          <div className="pa-pila pa-pila--2" style={{ marginTop: 'var(--esp-3)' }}>
            {s.contacto.nombre !== null && (
              <p>
                <strong>{s.contacto.nombre}</strong>
              </p>
            )}
            {s.contacto.telefono !== null ? (
              <p>
                Telefono: <a href={`tel:${s.contacto.telefono}`}>{s.contacto.telefono}</a>
              </p>
            ) : (
              <p className="pa-tarjeta__meta">No hay telefono registrado para esta persona.</p>
            )}
            {s.contacto.correo !== null && (
              <p>
                Correo: <a href={`mailto:${s.contacto.correo}`}>{s.contacto.correo}</a>
              </p>
            )}
          </div>
        </Tarjeta>
      ) : (
        <Tarjeta>
          <h2 className="pa-tarjeta__titulo">Como contactar</h2>
          <p className="pa-tarjeta__meta">
            Los datos de contacto aparecen aqui cuando la contratacion esta aceptada. Antes del
            acuerdo no hay nada que coordinar.
          </p>
        </Tarjeta>
      )}

      {/* ─── Acciones ─────────────────────────────────────────────────────*/}
      <Tarjeta>
        <h2 className="pa-tarjeta__titulo">Que puede hacer</h2>

        {/*
         * Los botones salen del estado Y del papel.
         *
         * El servidor decide igual: la tabla de transiciones dice que actor
         * puede hacer cada cosa. Esto solo evita ofrecer un boton que va a
         * devolver 409.
         */}
        <div className="pa-fila" style={{ marginTop: 'var(--esp-2)' }}>
          {s.estado === 'PENDIENTE' && !soySolicitante && (
            <>
              <Boton
                variante="primario"
                cargando={cambiar.isPending}
                onClick={() => void mover('ACEPTADA')}
              >
                Aceptar el trabajo
              </Boton>
              <Boton
                variante="secundario"
                cargando={cambiar.isPending}
                onClick={() => void mover('RECHAZADA')}
              >
                No puedo atenderlo
              </Boton>
            </>
          )}

          {s.estado === 'ACEPTADA' && !soySolicitante && (
            <Boton
              variante="primario"
              cargando={cambiar.isPending}
              onClick={() => void mover('COMPLETADA')}
            >
              Marcar como terminado
            </Boton>
          )}

          {s.estado === 'PENDIENTE' && soySolicitante && (
            <p className="pa-tarjeta__meta">Esperando que el oferente acepte o rechace.</p>
          )}

          {s.estado === 'ACEPTADA' && soySolicitante && (
            <p className="pa-tarjeta__meta">
              El trabajo esta en curso. El oferente lo marcara como terminado.
            </p>
          )}
        </div>

        {(s.estado === 'PENDIENTE' || s.estado === 'ACEPTADA') && (
          <div style={{ marginTop: 'var(--esp-4)' }}>
            <Cancelar idSolicitud={s.id} />
          </div>
        )}
      </Tarjeta>

      {s.estado === 'COMPLETADA' && <Calificar idSolicitud={s.id} />}
    </div>
  );
}
