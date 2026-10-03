import { useState, type ReactElement } from 'react';
import { ErrorApi } from '../api/cliente';
import {
  useAdjudicar,
  useCategorias,
  useCerrarNecesidad,
  useMisNecesidades,
  usePropuestasDe,
  usePublicarNecesidad,
} from '../api/hooks';
import {
  Aviso,
  AreaTexto,
  Boton,
  Campo,
  Cargando,
  Selector,
  SelloEstado,
  Tarjeta,
  Vacio,
  formatearDinero,
  formatearFecha,
} from '../ui';

/**
 * El lado de la demanda: publicar necesidades y adjudicar propuestas.
 *
 * Es la mitad del negocio que faltaba. Antes solo el oferente podia publicar, y
 * eso dejaba fuera a quien tiene el problema y no sabe a quien buscar.
 */
export default function MisNecesidades(): ReactElement {
  const necesidades = useMisNecesidades();
  const categorias = useCategorias();
  const publicar = usePublicarNecesidad();
  const cerrar = useCerrarNecesidad();

  const [abierto, setAbierto] = useState(false);
  const [verPropuestasDe, setVerPropuestasDe] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [datos, setDatos] = useState({
    titulo: '',
    descripcion: '',
    idCategoria: '',
    presupuestoEstimado: '',
    ubicacionAproximada: '',
  });

  const enviar = async (evento: React.FormEvent): Promise<void> => {
    evento.preventDefault();
    setError(null);

    try {
      await publicar.mutateAsync({
        titulo: datos.titulo.trim(),
        descripcion: datos.descripcion.trim(),
        idCategoria: Number(datos.idCategoria),
        presupuestoEstimado:
          datos.presupuestoEstimado.trim() === '' ? null : datos.presupuestoEstimado.trim(),
        ubicacionAproximada:
          datos.ubicacionAproximada.trim() === '' ? null : datos.ubicacionAproximada.trim(),
      });

      setAbierto(false);
      setDatos({
        titulo: '',
        descripcion: '',
        idCategoria: '',
        presupuestoEstimado: '',
        ubicacionAproximada: '',
      });
    } catch (fallo) {
      if (fallo instanceof ErrorApi) {
        setError(
          fallo.estado === 409
            ? fallo.message
            : fallo.detalles.length > 0
              ? fallo.detalles.map((d) => d.message).join(' ')
              : fallo.message
        );
      } else {
        setError('No se pudo publicar. Intentelo de nuevo.');
      }
    }
  };

  return (
    <>
      <div className="pa-fila pa-fila--separada">
        <h1>Mis necesidades</h1>
        {!abierto && (
          <Boton variante="acento" onClick={() => setAbierto(true)}>
            Publicar una necesidad
          </Boton>
        )}
      </div>

      {abierto && (
        <Tarjeta>
          <h2 className="pa-tarjeta__titulo">Publicar una necesidad</h2>
          {error !== null && <Aviso tono="error">{error}</Aviso>}

          <form onSubmit={(ev) => void enviar(ev)} noValidate>
            <Campo
              etiqueta="En una linea, que necesita"
              name="titulo"
              requerido
              ayuda="Entre 5 y 150 caracteres."
              value={datos.titulo}
              onChange={(ev) => setDatos((p) => ({ ...p, titulo: ev.target.value }))}
            />
            <AreaTexto
              etiqueta="Cuentelo con detalle"
              name="descripcion"
              requerido
              ayuda="Al menos 20 caracteres. Cuanto mas claro, mejores propuestas recibira."
              value={datos.descripcion}
              onChange={(ev) => setDatos((p) => ({ ...p, descripcion: ev.target.value }))}
            />
            <Selector
              etiqueta="Oficio"
              name="idCategoria"
              requerido
              vacio="Elija un oficio"
              value={datos.idCategoria}
              onChange={(ev) => setDatos((p) => ({ ...p, idCategoria: ev.target.value }))}
              opciones={(categorias.data?.elementos ?? []).map((c) => ({
                valor: String(c.id),
                texto: c.nombre,
              }))}
            />
            <Campo
              etiqueta="Presupuesto aproximado"
              name="presupuestoEstimado"
              inputMode="decimal"
              ayuda="Opcional. En pesos. Ayuda a que las propuestas vengan ajustadas."
              value={datos.presupuestoEstimado}
              onChange={(ev) => setDatos((p) => ({ ...p, presupuestoEstimado: ev.target.value }))}
            />
            <Campo
              etiqueta="Zona"
              name="ubicacionAproximada"
              ayuda="El barrio o el sector, NO la direccion exacta. La direccion se comparte cuando ya acordaron el trabajo."
              value={datos.ubicacionAproximada}
              onChange={(ev) => setDatos((p) => ({ ...p, ubicacionAproximada: ev.target.value }))}
            />

            <div className="pa-fila">
              <Boton type="submit" variante="acento" cargando={publicar.isPending}>
                Publicar
              </Boton>
              <Boton variante="fantasma" onClick={() => setAbierto(false)}>
                Cancelar
              </Boton>
            </div>
          </form>
        </Tarjeta>
      )}

      {necesidades.isPending && <Cargando que="sus necesidades" />}

      {necesidades.data !== undefined && necesidades.data.elementos.length === 0 && !abierto && (
        <Vacio
          titulo="Todavia no ha publicado nada"
          accion={
            <Boton variante="acento" onClick={() => setAbierto(true)}>
              Publicar una necesidad
            </Boton>
          }
        >
          Publique lo que necesita y los oferentes le enviaran propuestas con precio y plazo. Usted
          elige.
        </Vacio>
      )}

      <div className="pa-pila pa-pila--4" style={{ marginTop: 'var(--esp-6)' }}>
        {(necesidades.data?.elementos ?? []).map((n) => (
          <Tarjeta key={n.id}>
            <div className="pa-fila pa-fila--separada">
              <h2 className="pa-tarjeta__titulo">{n.titulo}</h2>
              <SelloEstado estado={n.estado} />
            </div>
            <p className="pa-tarjeta__meta">
              Publicada el {formatearFecha(n.fechaPublicacion)} · vigente hasta el{' '}
              {formatearFecha(n.fechaVigencia)}
              {n.presupuestoEstimado !== null && ` · ${formatearDinero(n.presupuestoEstimado)}`}
            </p>
            <p style={{ marginTop: 'var(--esp-2)', whiteSpace: 'pre-wrap' }}>{n.descripcion}</p>

            <div className="pa-fila" style={{ marginTop: 'var(--esp-4)' }}>
              <Boton
                variante="secundario"
                onClick={() => setVerPropuestasDe(verPropuestasDe === n.id ? null : n.id)}
              >
                {verPropuestasDe === n.id ? 'Ocultar propuestas' : 'Ver propuestas'}
              </Boton>

              {n.estado === 'ABIERTA' && (
                <Boton
                  variante="peligro"
                  cargando={cerrar.isPending}
                  onClick={() => {
                    void cerrar.mutateAsync({ id: n.id, estado: 'CERRADA' });
                  }}
                >
                  Ya no la necesito
                </Boton>
              )}
            </div>

            {verPropuestasDe === n.id && <Propuestas idNecesidad={n.id} estado={n.estado} />}
          </Tarjeta>
        ))}
      </div>
    </>
  );
}

/**
 * Propuestas recibidas, con la decision de adjudicar.
 *
 * Ningun otro oferente ve esta lista: el servidor comprueba que quien pregunta
 * es el autor de la necesidad. Si la vieran, sabrian contra que precios compiten
 * y bastaria rebajar un peso la mas barata para ganar siempre.
 */
function Propuestas({
  idNecesidad,
  estado,
}: {
  idNecesidad: number;
  estado: string;
}): ReactElement {
  const propuestas = usePropuestasDe(idNecesidad);
  const adjudicar = useAdjudicar();
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<number | null>(null);

  const elegir = async (idPropuesta: number): Promise<void> => {
    setError(null);
    try {
      await adjudicar.mutateAsync({ idNecesidad, idPropuesta });
      setConfirmando(null);
    } catch (fallo) {
      setError(
        fallo instanceof ErrorApi ? fallo.message : 'No se pudo adjudicar. Intentelo de nuevo.'
      );
    }
  };

  if (propuestas.isPending) {
    return (
      <div style={{ marginTop: 'var(--esp-4)' }}>
        <Cargando que="las propuestas" />
      </div>
    );
  }

  if (propuestas.isError) {
    return (
      <div style={{ marginTop: 'var(--esp-4)' }}>
        <Aviso tono="error">No se pudieron cargar las propuestas.</Aviso>
      </div>
    );
  }

  const vigentes = propuestas.data.filter((p) => p.estado === 'ENVIADA');
  const decididas = propuestas.data.filter((p) => p.estado !== 'ENVIADA');

  return (
    <div style={{ marginTop: 'var(--esp-4)' }}>
      {error !== null && <Aviso tono="error">{error}</Aviso>}

      {propuestas.data.length === 0 && (
        <p className="pa-tarjeta__meta">
          Todavia no hay propuestas. Los oferentes del oficio que eligio ya pueden verla.
        </p>
      )}

      <div className="pa-pila pa-pila--2">
        {vigentes.map((p) => (
          <div
            key={p.id}
            style={{
              padding: 'var(--esp-3)',
              background: 'var(--color-fondo-hundido)',
              borderRadius: 'var(--radio-md)',
            }}
          >
            <div className="pa-fila pa-fila--separada">
              <strong>{formatearDinero(p.precio)}</strong>
              <span className="pa-tarjeta__meta">
                {p.tiempoEstimado} {p.tiempoEstimado === 1 ? 'dia' : 'dias'}
              </span>
            </div>
            <p style={{ marginTop: 'var(--esp-2)', whiteSpace: 'pre-wrap' }}>{p.mensaje}</p>

            {estado === 'ABIERTA' && (
              <div style={{ marginTop: 'var(--esp-3)' }}>
                {confirmando === p.id ? (
                  /**
                   * Adjudicar se confirma, porque es irreversible: descarta
                   * TODAS las demas propuestas. Quien pulsa tiene que saberlo
                   * antes y no descubrirlo despues.
                   */
                  <Aviso tono="aviso" titulo="Esto cierra la necesidad">
                    Al elegir esta propuesta, las demas quedan descartadas y se crea la
                    contratacion. No se puede deshacer.
                    <div className="pa-fila" style={{ marginTop: 'var(--esp-3)' }}>
                      <Boton
                        variante="acento"
                        cargando={adjudicar.isPending}
                        onClick={() => void elegir(p.id)}
                      >
                        Si, elegir esta
                      </Boton>
                      <Boton variante="fantasma" onClick={() => setConfirmando(null)}>
                        No, volver
                      </Boton>
                    </div>
                  </Aviso>
                ) : (
                  <Boton variante="primario" onClick={() => setConfirmando(p.id)}>
                    Elegir esta propuesta
                  </Boton>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {decididas.length > 0 && (
        <details style={{ marginTop: 'var(--esp-4)' }}>
          <summary className="pa-tarjeta__meta">
            {decididas.length}{' '}
            {decididas.length === 1 ? 'propuesta ya decidida' : 'propuestas ya decididas'}
          </summary>
          <div className="pa-pila pa-pila--2" style={{ marginTop: 'var(--esp-2)' }}>
            {decididas.map((p) => (
              <div key={p.id} className="pa-fila pa-fila--separada">
                <span className="pa-tarjeta__meta">
                  {formatearDinero(p.precio)} · {p.tiempoEstimado} dias
                </span>
                <SelloEstado estado={p.estado} />
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
