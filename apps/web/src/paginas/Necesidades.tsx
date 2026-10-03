import { useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useCategorias, useNecesidadesAbiertas } from '../api/hooks';
import {
  Aviso,
  Boton,
  Campo,
  Cargando,
  Selector,
  Tarjeta,
  Vacio,
  formatearDinero,
  formatearFecha,
} from '../ui';

/**
 * Necesidades abiertas, para oferentes.
 *
 * NO es publica. Una necesidad describe un problema concreto en una zona
 * concreta, y abrirla sin sesion la convertiria en material para quien busque
 * casas vacias. Tampoco dice quien la publico: para contactar se envia una
 * propuesta, que es toda la gracia de la intermediacion.
 */
export default function Necesidades(): ReactElement {
  const [parametros, setParametros] = useSearchParams();
  const categorias = useCategorias();

  const texto = parametros.get('texto') ?? '';
  const idCategoria = parametros.get('idCategoria');
  const pagina = Number(parametros.get('pagina') ?? '1');
  const [borrador, setBorrador] = useState(texto);

  const resultados = useNecesidadesAbiertas({
    ...(texto === '' ? {} : { texto }),
    ...(idCategoria === null ? {} : { idCategoria: Number(idCategoria) }),
    pagina,
  });

  const actualizar = (clave: string, valor: string): void => {
    const nuevos = new URLSearchParams(parametros);
    if (valor === '') nuevos.delete(clave);
    else nuevos.set(clave, valor);
    nuevos.delete('pagina');
    setParametros(nuevos);
  };

  return (
    <>
      <h1>Necesidades abiertas</h1>
      <p className="pa-tarjeta__meta">
        Gente que esta buscando a alguien. Envie su propuesta con precio y plazo.
      </p>

      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          actualizar('texto', borrador.trim());
        }}
        className="pa-fila"
        style={{ margin: 'var(--esp-4) 0 var(--esp-6)' }}
      >
        <div style={{ flex: '1 1 16rem', marginBottom: 0 }}>
          <Campo
            etiqueta="Buscar"
            name="texto"
            type="search"
            inputMode="search"
            placeholder="Fuga, pintura, clases…"
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
            onChange={(ev) => actualizar('idCategoria', ev.target.value)}
            opciones={(categorias.data?.elementos ?? []).map((c) => ({
              valor: String(c.id),
              texto: c.nombre,
            }))}
          />
        </div>
        <Boton type="submit">Buscar</Boton>
      </form>

      {resultados.isPending && <Cargando que="las necesidades" />}

      {resultados.isError && (
        <Aviso tono="error" titulo="No se pudieron cargar las necesidades">
          Si acaba de crear su perfil de prestador, espere a que un administrador lo valide.
        </Aviso>
      )}

      {resultados.data !== undefined && resultados.data.elementos.length === 0 && (
        <Vacio titulo="No hay necesidades abiertas ahora mismo">
          Vuelva en un rato, o publique sus propios servicios en el catalogo.
        </Vacio>
      )}

      <div className="pa-pila pa-pila--4">
        {(resultados.data?.elementos ?? []).map((n) => (
          <Link
            key={n.id}
            to={`/necesidades/${n.id}`}
            style={{ textDecoration: 'none', color: 'inherit' }}
          >
            <Tarjeta pulsable>
              <h2 className="pa-tarjeta__titulo">{n.titulo}</h2>
              <p className="pa-tarjeta__meta">
                {n.ubicacionAproximada !== null && `${n.ubicacionAproximada} · `}
                vigente hasta el {formatearFecha(n.fechaVigencia)}
                {n.presupuestoEstimado !== null &&
                  ` · presupuesto ${formatearDinero(n.presupuestoEstimado)}`}
              </p>
              <p style={{ marginTop: 'var(--esp-2)' }}>
                {n.descripcion.length > 180 ? `${n.descripcion.slice(0, 180)}…` : n.descripcion}
              </p>
            </Tarjeta>
          </Link>
        ))}
      </div>
    </>
  );
}
