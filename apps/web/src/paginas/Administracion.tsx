import { lazy, Suspense, useEffect, useState } from 'react';
import { ErrorApi } from '../api/cliente';
import {
  useActividad,
  useAuditoria,
  useGuardarParametro,
  useParametros,
  usePrestadoresPendientes,
  useRechazarPrestador,
  useValidarPrestador,
} from '../api/hooks';
import {
  Aviso,
  AreaTexto,
  Boton,
  Campo,
  Cargando,
  Selector,
  Sello,
  Tarjeta,
  Vacio,
  formatearFecha,
} from '../ui';
import { conviene3d } from '../escenas/conviene3d';
import './administracion.css';

const RelieveActividad = lazy(() => import('../escenas/RelieveActividad'));

type Pestana = 'pendientes' | 'actividad' | 'parametros' | 'auditoria';

/**
 * Panel de administracion.
 *
 * Cuatro secciones en pestanas y no cuatro rutas, porque un administrador salta
 * entre ellas continuamente: validar un perfil y mirar la bitacora de lo que
 * acaba de hacer es un mismo gesto.
 */
export default function Administracion() {
  const [pestana, setPestana] = useState<Pestana>('pendientes');

  return (
    <>
      <h1>Administracion</h1>

      <div className="pa-fila" role="tablist" aria-label="Secciones" style={{ margin: 'var(--esp-4) 0 var(--esp-6)' }}>
        {(
          [
            ['pendientes', 'Perfiles por revisar'],
            ['actividad', 'Actividad'],
            ['parametros', 'Parametros'],
            ['auditoria', 'Bitacora'],
          ] as const
        ).map(([clave, texto]) => (
          <Boton
            key={clave}
            role="tab"
            aria-selected={pestana === clave}
            variante={pestana === clave ? 'primario' : 'secundario'}
            onClick={() => setPestana(clave)}
          >
            {texto}
          </Boton>
        ))}
      </div>

      {pestana === 'pendientes' && <Pendientes />}
      {pestana === 'actividad' && <Actividad />}
      {pestana === 'parametros' && <Parametros />}
      {pestana === 'auditoria' && <Bitacora />}
    </>
  );
}

/** Cola de revision de perfiles (SRS RF26, RF27). */
function Pendientes() {
  const pendientes = usePrestadoresPendientes();
  const validar = useValidarPrestador();
  const rechazar = useRechazarPrestador();

  const [rechazando, setRechazando] = useState<number | null>(null);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (pendientes.isPending) return <Cargando que="los perfiles pendientes" />;

  if (pendientes.data !== undefined && pendientes.data.elementos.length === 0) {
    return <Vacio titulo="No hay perfiles por revisar">Todo al dia.</Vacio>;
  }

  return (
    <div className="pa-pila pa-pila--4">
      {error !== null && <Aviso tono="error">{error}</Aviso>}

      {(pendientes.data?.elementos ?? []).map((p) => (
        <Tarjeta key={p.id}>
          <div className="pa-fila pa-fila--separada">
            <h2 className="pa-tarjeta__titulo">{p.nombre}</h2>
            <Sello tono="aviso">En revision</Sello>
          </div>
          <p>{p.especialidad}</p>
          {p.experiencia !== null && (
            <p style={{ marginTop: 'var(--esp-2)', whiteSpace: 'pre-wrap' }}>{p.experiencia}</p>
          )}

          {/* El contacto se muestra porque revisar ES comprobar lo que el perfil
              afirma. Esta pantalla solo la ve un administrador. */}
          <p className="pa-tarjeta__meta" style={{ marginTop: 'var(--esp-3)' }}>
            {p.telefono ?? 'sin telefono'} · {p.correo ?? 'sin correo'}
          </p>

          {rechazando === p.id ? (
            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                setError(null);
                rechazar
                  .mutateAsync({ id: p.id, motivo: motivo.trim() })
                  .then(() => {
                    setRechazando(null);
                    setMotivo('');
                  })
                  .catch((fallo: unknown) => {
                    setError(
                      fallo instanceof ErrorApi ? fallo.message : 'No se pudo rechazar.'
                    );
                  });
              }}
            >
              <AreaTexto
                etiqueta="Por que se rechaza"
                name={`motivo-${p.id}`}
                requerido
                ayuda="Entre 10 y 500 caracteres. El oferente lo necesita para corregir y volver a intentarlo."
                value={motivo}
                onChange={(ev) => setMotivo(ev.target.value)}
              />
              <div className="pa-fila">
                <Boton type="submit" variante="peligro" cargando={rechazar.isPending}>
                  Confirmar rechazo
                </Boton>
                <Boton variante="fantasma" onClick={() => setRechazando(null)}>
                  Volver
                </Boton>
              </div>
            </form>
          ) : (
            <div className="pa-fila" style={{ marginTop: 'var(--esp-4)' }}>
              <Boton
                variante="primario"
                cargando={validar.isPending}
                onClick={() => void validar.mutateAsync(p.id)}
              >
                Validar
              </Boton>
              <Boton variante="peligro" onClick={() => setRechazando(p.id)}>
                Rechazar
              </Boton>
            </div>
          )}
        </Tarjeta>
      ))}
    </div>
  );
}

/**
 * Actividad, con el relieve 3D y su tabla.
 *
 * La tabla NO es un respaldo del 3D: es la fuente. El relieve ayuda a ver de un
 * golpe que dias hubo mas movimiento, y la tabla da la cifra exacta y es lo que
 * lee un lector de pantalla.
 */
function Actividad() {
  const actividad = useActividad();
  const [dibujar3d, setDibujar3d] = useState(false);

  useEffect(() => {
    // `decorativa: false`: el relieve es una lectura del dato, asi que solo
    // cede ante lo que de verdad lo impide —menos movimiento, ahorro de datos,
    // red muy lenta— y no por tener la pantalla estrecha. La tabla esta debajo
    // de todos modos.
    setDibujar3d(conviene3d({ decorativa: false }));
  }, []);

  if (actividad.isPending) return <Cargando que="la actividad" />;

  if (actividad.isError) {
    return <Aviso tono="error">No se pudo cargar el informe de actividad.</Aviso>;
  }

  const a = actividad.data;

  return (
    <div className="pa-pila pa-pila--6">
      <Tarjeta>
        <h2 className="pa-tarjeta__titulo">Asientos de auditoria</h2>
        <p style={{ fontSize: 'var(--texto-3xl)', fontWeight: 'var(--peso-semi)' }}>
          {a.totalAsientos}
        </p>
        <p className="pa-tarjeta__meta">
          {a.desde === null && a.hasta === null
            ? 'Desde el principio'
            : `Entre ${formatearFecha(a.desde)} y ${formatearFecha(a.hasta)}`}
        </p>
      </Tarjeta>

      <Tarjeta>
        <h2 className="pa-tarjeta__titulo">Actividad por dia</h2>

        {a.porDia.length === 0 ? (
          <p className="pa-tarjeta__meta">Todavia no hay actividad registrada.</p>
        ) : (
          <>
            {dibujar3d && (
              <div className="pa-relieve" aria-hidden="true">
                <Suspense fallback={null}>
                  <RelieveActividad puntos={a.porDia} />
                </Suspense>
              </div>
            )}

            <table className="pa-tabla">
              <caption className="pa-tarjeta__meta">
                Asientos registrados cada dia, del mas reciente al mas antiguo.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Dia</th>
                  <th scope="col">Asientos</th>
                </tr>
              </thead>
              <tbody>
                {a.porDia.map((d) => (
                  <tr key={d.fecha}>
                    <td>{formatearFecha(d.fecha)}</td>
                    <td>{d.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Tarjeta>

      <Tarjeta>
        <h2 className="pa-tarjeta__titulo">Que se hizo</h2>
        {a.porAccion.length === 0 ? (
          <p className="pa-tarjeta__meta">Sin acciones registradas.</p>
        ) : (
          <table className="pa-tabla">
            <thead>
              <tr>
                <th scope="col">Accion</th>
                <th scope="col">Resultado</th>
                <th scope="col">Veces</th>
              </tr>
            </thead>
            <tbody>
              {a.porAccion.map((r) => (
                <tr key={`${r.accion}-${r.resultado}`}>
                  <td>{r.accion.toLowerCase().replace(/_/gu, ' ')}</td>
                  <td>
                    <Sello
                      tono={
                        r.resultado === 'EXITO'
                          ? 'exito'
                          : r.resultado === 'DENEGADO'
                            ? 'aviso'
                            : 'error'
                      }
                    >
                      {r.resultado.toLowerCase()}
                    </Sello>
                  </td>
                  <td>{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tarjeta>
    </div>
  );
}

/**
 * Parametros del sistema (SRS RF105).
 *
 * Son los umbrales y plazos que gobiernan la plataforma: la ventana de gracia
 * de una cancelacion, el periodo ciego, los umbrales de la tasa. Estan aqui y
 * no en el codigo para que se puedan recalibrar con datos reales sin desplegar.
 */
function Parametros() {
  const parametros = useParametros();
  const guardar = useGuardarParametro();

  const [datos, setDatos] = useState({
    clave: '',
    valor: '',
    descripcion: '',
    tipoDato: 'number' as 'string' | 'number' | 'boolean',
  });
  const [error, setError] = useState<string | null>(null);

  const enviar = async (evento: React.FormEvent): Promise<void> => {
    evento.preventDefault();
    setError(null);
    try {
      await guardar.mutateAsync({
        clave: datos.clave.trim(),
        valor: datos.valor.trim(),
        descripcion: datos.descripcion.trim() === '' ? null : datos.descripcion.trim(),
        tipoDato: datos.tipoDato,
      });
      setDatos({ clave: '', valor: '', descripcion: '', tipoDato: 'number' });
    } catch (fallo) {
      setError(
        fallo instanceof ErrorApi
          ? fallo.detalles.length > 0
            ? fallo.detalles.map((d) => d.message).join(' ')
            : fallo.message
          : 'No se pudo guardar el parametro.'
      );
    }
  };

  return (
    <div className="pa-pila pa-pila--6">
      <Tarjeta>
        <h2 className="pa-tarjeta__titulo">Crear o cambiar un parametro</h2>
        {error !== null && <Aviso tono="error">{error}</Aviso>}

        <Aviso tono="info">
          Cada cambio queda en la bitacora con quien lo hizo. Si el nombre del
          parametro suena a secreto, el asiento guarda que hubo un cambio pero no
          los valores.
        </Aviso>

        <form onSubmit={(ev) => void enviar(ev)} noValidate>
          <Campo
            etiqueta="Clave"
            name="clave"
            requerido
            ayuda="Mayusculas, digitos y guion bajo. Por ejemplo: CANCEL_GRACIA_HORAS"
            value={datos.clave}
            onChange={(ev) => setDatos((p) => ({ ...p, clave: ev.target.value.toUpperCase() }))}
          />
          <Selector
            etiqueta="Tipo"
            name="tipoDato"
            requerido
            value={datos.tipoDato}
            onChange={(ev) =>
              setDatos((p) => ({ ...p, tipoDato: ev.target.value as typeof p.tipoDato }))
            }
            opciones={[
              { valor: 'number', texto: 'Numero' },
              { valor: 'string', texto: 'Texto' },
              { valor: 'boolean', texto: 'Si o no' },
            ]}
          />
          <Campo
            etiqueta="Valor"
            name="valor"
            requerido
            ayuda="Se comprueba contra el tipo: un numero que no lo sea se rechaza aqui y no en el servicio que lo lea."
            value={datos.valor}
            onChange={(ev) => setDatos((p) => ({ ...p, valor: ev.target.value }))}
          />
          <Campo
            etiqueta="Para que sirve"
            name="descripcion"
            ayuda="Opcional, pero quien lo lea en seis meses lo agradecera."
            value={datos.descripcion}
            onChange={(ev) => setDatos((p) => ({ ...p, descripcion: ev.target.value }))}
          />

          <Boton type="submit" cargando={guardar.isPending}>
            Guardar
          </Boton>
        </form>
      </Tarjeta>

      <Tarjeta>
        <h2 className="pa-tarjeta__titulo">Parametros actuales</h2>
        {parametros.isPending && <Cargando que="los parametros" />}

        {parametros.data !== undefined && parametros.data.elementos.length === 0 && (
          <p className="pa-tarjeta__meta">
            Ninguno todavia. Los servicios usan sus valores por omision.
          </p>
        )}

        {parametros.data !== undefined && parametros.data.elementos.length > 0 && (
          <table className="pa-tabla">
            <thead>
              <tr>
                <th scope="col">Clave</th>
                <th scope="col">Valor</th>
                <th scope="col">Para que</th>
              </tr>
            </thead>
            <tbody>
              {parametros.data.elementos.map((p) => (
                <tr key={p.clave}>
                  <td>
                    <code>{p.clave}</code>
                  </td>
                  <td>{p.valor}</td>
                  <td className="pa-tarjeta__meta">{p.descripcion ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Tarjeta>
    </div>
  );
}

/**
 * Bitacora de auditoria (SRS RF101 a RF103).
 *
 * Solo se lee. No hay forma de modificar ni de borrar un asiento, ni aqui ni en
 * el servidor: una bitacora corregible no prueba nada.
 */
function Bitacora() {
  const [resultado, setResultado] = useState('');
  const asientos = useAuditoria(resultado === '' ? {} : { resultado });

  return (
    <div className="pa-pila pa-pila--4">
      <div style={{ maxWidth: '16rem' }}>
        <Selector
          etiqueta="Filtrar por resultado"
          name="resultado"
          vacio="Todos"
          value={resultado}
          onChange={(ev) => setResultado(ev.target.value)}
          opciones={[
            { valor: 'EXITO', texto: 'Exito' },
            { valor: 'DENEGADO', texto: 'Denegado' },
            { valor: 'FALLO', texto: 'Fallo' },
          ]}
        />
      </div>

      {asientos.isPending && <Cargando que="la bitacora" />}

      {asientos.data !== undefined && asientos.data.elementos.length === 0 && (
        <Vacio titulo="No hay asientos que coincidan">
          La bitacora se llena con los eventos que los servicios publican.
        </Vacio>
      )}

      {asientos.data !== undefined && asientos.data.elementos.length > 0 && (
        <Tarjeta>
          <p className="pa-tarjeta__meta">{asientos.data.total} asientos</p>
          <table className="pa-tabla">
            <thead>
              <tr>
                <th scope="col">Cuando paso</th>
                <th scope="col">Quien</th>
                <th scope="col">Que</th>
                <th scope="col">Sobre</th>
                <th scope="col">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {asientos.data.elementos.map((a) => (
                <tr key={a.id}>
                  <td>{formatearFecha(a.ocurridoAt)}</td>
                  <td>
                    {a.idActor === null ? 'el sistema' : `#${a.idActor}`}
                    {a.actorRol !== null && (
                      <span className="pa-tarjeta__meta"> · {a.actorRol.toLowerCase()}</span>
                    )}
                  </td>
                  <td>{a.accion.toLowerCase().replace(/_/gu, ' ')}</td>
                  <td className="pa-tarjeta__meta">
                    {a.recursoTipo}
                    {a.recursoId !== null && ` ${a.recursoId}`}
                  </td>
                  <td>
                    <Sello
                      tono={
                        a.resultado === 'EXITO'
                          ? 'exito'
                          : a.resultado === 'DENEGADO'
                            ? 'aviso'
                            : 'error'
                      }
                    >
                      {a.resultado.toLowerCase()}
                    </Sello>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Tarjeta>
      )}
    </div>
  );
}
