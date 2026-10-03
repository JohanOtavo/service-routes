import { useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useBuscarServicios, useCategorias } from '../api/hooks';
import { Aviso, Boton, Campo, Cargando, Selector, Sello, Tarjeta, Vacio } from '../ui';

/**
 * Busqueda del catalogo. Es la unica pantalla abierta sin sesion.
 *
 * Los filtros viven en la URL y no en el estado del componente, para que un
 * resultado se pueda compartir por enlace y el boton de atras funcione como la
 * gente espera.
 */
export default function Servicios(): ReactElement {
  const [parametros, setParametros] = useSearchParams();
  const categorias = useCategorias();

  const texto = parametros.get('texto') ?? '';
  const idCategoria = parametros.get('idCategoria');
  const pagina = Number(parametros.get('pagina') ?? '1');

  // Lo que se esta escribiendo, aparte de lo que se esta buscando: cambiar la
  // URL en cada tecla llenaria el historial y lanzaria una peticion por letra.
  const [borrador, setBorrador] = useState(texto);

  const resultados = useBuscarServicios({
    ...(texto === '' ? {} : { texto }),
    ...(idCategoria === null ? {} : { idCategoria: Number(idCategoria) }),
    pagina,
  });

  const buscar = (evento: React.FormEvent): void => {
    evento.preventDefault();
    const nuevos = new URLSearchParams(parametros);
    if (borrador.trim() === '') nuevos.delete('texto');
    else nuevos.set('texto', borrador.trim());
    nuevos.delete('pagina');
    setParametros(nuevos);
  };

  const cambiarCategoria = (valor: string): void => {
    const nuevos = new URLSearchParams(parametros);
    if (valor === '') nuevos.delete('idCategoria');
    else nuevos.set('idCategoria', valor);
    nuevos.delete('pagina');
    setParametros(nuevos);
  };

  const irAPagina = (destino: number): void => {
    const nuevos = new URLSearchParams(parametros);
    nuevos.set('pagina', String(destino));
    setParametros(nuevos);
    window.scrollTo({ top: 0 });
  };

  const total = resultados.data?.total ?? 0;
  const tamano = resultados.data?.tamano ?? 20;
  const paginas = Math.max(1, Math.ceil(total / tamano));

  return (
    <>
      <h1>Buscar servicios</h1>

      <form onSubmit={buscar} className="pa-fila" style={{ margin: 'var(--esp-4) 0 var(--esp-6)' }}>
        <div style={{ flex: '1 1 16rem', marginBottom: 0 }}>
          <Campo
            etiqueta="Que necesita"
            name="texto"
            type="search"
            // `search` da el teclado con lupa en el movil.
            inputMode="search"
            placeholder="Fuga de agua, clases de matematicas…"
            ayuda="Busque por palabras del nombre o la descripcion."
            value={borrador}
            onChange={(ev) => setBorrador(ev.target.value)}
          />
        </div>

        <div style={{ flex: '0 1 14rem', marginBottom: 0 }}>
          <Selector
            etiqueta="Oficio"
            name="idCategoria"
            vacio="Todos los oficios"
            value={idCategoria ?? ''}
            onChange={(ev) => cambiarCategoria(ev.target.value)}
            opciones={(categorias.data?.elementos ?? []).map((c) => ({
              valor: String(c.id),
              texto: c.nombre,
            }))}
          />
        </div>

        <Boton type="submit">Buscar</Boton>
      </form>

      {resultados.isPending && <Cargando que="los servicios" />}

      {resultados.isError && (
        <Aviso tono="error" titulo="No se pudo cargar el catalogo">
          Intentelo de nuevo en unos momentos.
        </Aviso>
      )}

      {resultados.data !== undefined && resultados.data.elementos.length === 0 && (
        <Vacio
          titulo="No hay servicios que coincidan"
          accion={
            <Link to="/mis-necesidades" className="pa-boton pa-boton--acento">
              Publicar lo que necesito
            </Link>
          }
        >
          Pruebe con otras palabras o con otro oficio. Tambien puede publicar su necesidad y dejar
          que los oferentes le propongan.
        </Vacio>
      )}

      {resultados.data !== undefined && resultados.data.elementos.length > 0 && (
        <>
          <p className="pa-tarjeta__meta" role="status">
            {total} {total === 1 ? 'servicio' : 'servicios'}
          </p>

          <div className="pa-rejilla" style={{ marginTop: 'var(--esp-4)' }}>
            {resultados.data.elementos.map((s) => (
              <Link
                key={s.id}
                to={`/servicios/${s.id}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <Tarjeta pulsable>
                  <h2 className="pa-tarjeta__titulo">{s.nombre}</h2>
                  {s.prestador !== undefined && (
                    <p className="pa-tarjeta__meta">
                      {s.prestador.nombre}
                      {s.prestador.especialidad !== null && ` · ${s.prestador.especialidad}`}
                    </p>
                  )}
                  <p style={{ marginTop: 'var(--esp-2)' }}>
                    {/* Recortado: una descripcion larga rompe la rejilla. */}
                    {s.descripcion.length > 140 ? `${s.descripcion.slice(0, 140)}…` : s.descripcion}
                  </p>
                  {s.reputacion !== undefined && (
                    <div className="pa-fila" style={{ marginTop: 'var(--esp-3)' }}>
                      {s.reputacion.totalCalificaciones === 0 ? (
                        <Sello tono="neutro">Sin calificaciones</Sello>
                      ) : (
                        <Sello tono="exito">
                          {s.reputacion.puntuacionMedia.toFixed(1)} de 5 ·{' '}
                          {s.reputacion.totalCalificaciones}
                        </Sello>
                      )}
                    </div>
                  )}
                </Tarjeta>
              </Link>
            ))}
          </div>

          {paginas > 1 && (
            <nav
              className="pa-fila"
              style={{ justifyContent: 'center', marginTop: 'var(--esp-8)' }}
              aria-label="Paginas de resultados"
            >
              <Boton
                variante="secundario"
                disabled={pagina <= 1}
                onClick={() => irAPagina(pagina - 1)}
              >
                Anterior
              </Boton>
              <span className="pa-tarjeta__meta">
                Pagina {pagina} de {paginas}
              </span>
              <Boton
                variante="secundario"
                disabled={pagina >= paginas}
                onClick={() => irAPagina(pagina + 1)}
              >
                Siguiente
              </Boton>
            </nav>
          )}
        </>
      )}
    </>
  );
}
