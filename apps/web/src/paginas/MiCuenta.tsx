import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useCalificacionesRecibidas, useReputacion } from '../api/hooks';
import { useSesion } from '../autenticacion/ContextoSesion';
import { Aviso, Cargando, Sello, Tarjeta, formatearFecha } from '../ui';

interface DatosFaceta {
  puntuacionMedia: number;
  totalCalificaciones: number;
  tasaCancelacion?: number | undefined;
  umbralAlcanzado?: number | undefined;
}

function Faceta({
  titulo,
  datos,
  calificaciones,
}: {
  titulo: string;
  datos: DatosFaceta;
  calificaciones: readonly {
    id: number;
    puntuacion: number;
    comentario: string | null;
    fecha: string;
  }[];
}): ReactElement {
  return (
    <Tarjeta>
      <h3 className="pa-tarjeta__titulo">{titulo}</h3>

      {datos.totalCalificaciones === 0 ? (
        <p className="pa-tarjeta__meta">
          Sin calificaciones todavia. Aparecen cuando las dos partes de una contratacion han
          calificado.
        </p>
      ) : (
        <>
          <p style={{ fontSize: 'var(--texto-2xl)', fontWeight: 'var(--peso-semi)' }}>
            {datos.puntuacionMedia.toFixed(1)}
            <span className="pa-tarjeta__meta" style={{ fontSize: 'var(--texto-base)' }}>
              {' de 5 · '}
              {datos.totalCalificaciones}{' '}
              {datos.totalCalificaciones === 1 ? 'opinion' : 'opiniones'}
            </span>
          </p>

          <div className="pa-pila pa-pila--2" style={{ marginTop: 'var(--esp-4)' }}>
            {calificaciones.map((c) => (
              <div key={c.id}>
                <div className="pa-fila">
                  <Sello tono={c.puntuacion >= 4 ? 'exito' : c.puntuacion >= 3 ? 'aviso' : 'error'}>
                    {c.puntuacion} de 5
                  </Sello>
                  <span className="pa-tarjeta__meta">{formatearFecha(c.fecha)}</span>
                </div>
                {c.comentario !== null && (
                  <p style={{ marginTop: 'var(--esp-1)' }}>{c.comentario}</p>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {/*
       * La tasa solo llega del servidor a partir del primer umbral (RF192). Si
       * el campo no viene, no se dibuja: no es lo mismo "no hay dato" que "cero
       * cancelaciones", y pintar un 0 % donde el servidor callo seria
       * inventarse una cifra.
       */}
      {datos.tasaCancelacion !== undefined && (
        <Aviso tono="aviso" titulo="Su tasa de cancelacion es visible en su perfil">
          {(datos.tasaCancelacion * 100).toFixed(0)}% en los ultimos 90 dias. Las contrataciones que
          complete la haran bajar.
        </Aviso>
      )}
    </Tarjeta>
  );
}

/**
 * Mi cuenta: roles y reputacion en las dos facetas.
 *
 * Van separadas porque ser buen oferente y ser buen solicitante son cosas
 * distintas (SRS RF165). Promediarlas destruiria informacion: alguien impecable
 * atendiendo y desastroso contratando quedaria "normal".
 */
export default function MiCuenta(): ReactElement {
  const { sesion, tieneRol } = useSesion();
  const idUsuario = sesion?.usuario.id ?? 0;
  const reputacion = useReputacion(idUsuario);
  const comoOferente = useCalificacionesRecibidas(idUsuario, 'COMO_OFERENTE');
  const comoSolicitante = useCalificacionesRecibidas(idUsuario, 'COMO_SOLICITANTE');

  return (
    <div style={{ maxWidth: '44rem' }}>
      <h1>Mi cuenta</h1>

      <Tarjeta>
        <h2 className="pa-tarjeta__titulo">
          {sesion === null || sesion.usuario.nombre === '' ? 'Su cuenta' : sesion.usuario.nombre}
        </h2>
        <div className="pa-fila" style={{ marginTop: 'var(--esp-2)' }}>
          {(sesion?.usuario.roles ?? []).map((rol) => (
            <Sello key={rol} tono="neutro">
              {rol.toLowerCase()}
            </Sello>
          ))}
        </div>

        {!tieneRol('OFERENTE') && (
          <Aviso tono="info" titulo="Tambien puede ofrecer servicios">
            Si quiere trabajar en la plataforma, pida el rol de oferente a quien la administra.
            Despues podra crear su perfil y publicar lo que sabe hacer.
          </Aviso>
        )}

        {tieneRol('OFERENTE') && (
          <p style={{ marginTop: 'var(--esp-4)' }}>
            <Link to="/mi-perfil-prestador">Ver mi perfil de prestador</Link>
          </p>
        )}
      </Tarjeta>

      {reputacion.isPending && <Cargando que="su reputacion" />}

      {reputacion.data !== undefined && (
        <div className="pa-rejilla">
          <Faceta
            titulo="Como quien atiende"
            datos={reputacion.data.facetas.COMO_OFERENTE}
            calificaciones={comoOferente.data?.elementos ?? []}
          />
          <Faceta
            titulo="Como quien contrata"
            datos={reputacion.data.facetas.COMO_SOLICITANTE}
            calificaciones={comoSolicitante.data?.elementos ?? []}
          />
        </div>
      )}
    </div>
  );
}
