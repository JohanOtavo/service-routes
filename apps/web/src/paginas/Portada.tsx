import { lazy, Suspense, useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useSesion } from '../autenticacion/ContextoSesion';
import { useCategorias } from '../api/hooks';
import { conviene3d } from '../escenas/conviene3d';
import './portada.css';

/**
 * Escena 3D en carga diferida.
 *
 * `lazy` la saca del paquete principal, asi que la portada se pinta y se puede
 * leer antes de que three.js haya terminado de bajar. Si nunca baja —conexion
 * cortada, navegador antiguo— la pagina sigue funcionando: el degradado del CSS
 * ocupa su sitio.
 */
const HeroeTaller = lazy(() => import('../escenas/HeroeTaller'));

export default function Portada(): ReactElement {
  const { sesion } = useSesion();
  const categorias = useCategorias();
  const [animar, setAnimar] = useState(false);

  /**
   * El 3D se monta DESPUES del primer pintado, y solo donde conviene.
   *
   * Montarlo junto al texto retrasaria lo unico que la persona necesita leer
   * para entender que es esto. Y `conviene3d` decide si vale la pena bajarlo:
   * en un movil estrecho o con ahorro de datos, el degradado del CSS cuenta la
   * misma historia por cero bytes.
   */
  useEffect(() => {
    if (!conviene3d({ decorativa: true })) return;

    const temporizador = window.setTimeout(() => setAnimar(true), 300);
    return () => window.clearTimeout(temporizador);
  }, []);

  return (
    <>
      <section className="pa-heroe">
        <div className="pa-heroe__texto">
          <h1 className="pa-heroe__titulo">
            Encuentre quien le ayude.
            <br />U ofrezca lo que sabe hacer.
          </h1>
          <p className="pa-heroe__entrada">
            Punto Amigo conecta a quien necesita un servicio con quien sabe hacerlo. Publique lo que
            necesita y reciba propuestas, o busque entre los oficios que ya hay cerca.
          </p>

          <div className="pa-fila" style={{ marginTop: 'var(--esp-6)' }}>
            <Link to="/servicios" className="pa-boton pa-boton--primario">
              Buscar un servicio
            </Link>
            {sesion === null ? (
              <Link to="/registro" className="pa-boton pa-boton--secundario">
                Crear cuenta
              </Link>
            ) : (
              <Link to="/mis-necesidades" className="pa-boton pa-boton--secundario">
                Publicar lo que necesito
              </Link>
            )}
          </div>

          <p className="pa-heroe__nota">
            Los datos de contacto se comparten solo cuando las dos partes han acordado un trabajo.
          </p>
        </div>

        {/* `aria-hidden`: es decoracion. Un lector de pantalla no gana nada
            describiendo unas herramientas que giran, y el texto de al lado ya
            dice todo lo que importa. */}
        <div className="pa-heroe__escena" aria-hidden="true">
          {animar && (
            <Suspense fallback={null}>
              <HeroeTaller animar />
            </Suspense>
          )}
        </div>
      </section>

      <section className="pa-seccion">
        <h2>Como funciona</h2>
        <div className="pa-rejilla" style={{ marginTop: 'var(--esp-4)' }}>
          <article className="pa-tarjeta">
            <h3 className="pa-tarjeta__titulo">1. Diga que necesita</h3>
            <p className="pa-tarjeta__meta">
              Busque un servicio publicado, o publique su necesidad y deje que los oferentes le
              propongan precio y plazo.
            </p>
          </article>
          <article className="pa-tarjeta">
            <h3 className="pa-tarjeta__titulo">2. Elija con informacion</h3>
            <p className="pa-tarjeta__meta">
              Cada oferente tiene su perfil validado y sus calificaciones, en dos facetas separadas:
              como quien atiende y como quien contrata.
            </p>
          </article>
          <article className="pa-tarjeta">
            <h3 className="pa-tarjeta__titulo">3. Acuerden y califiquen</h3>
            <p className="pa-tarjeta__meta">
              Al aceptar, las dos partes ven como contactarse. Al terminar, las dos califican, y
              ninguna ve la del otro hasta que ambas esten escritas.
            </p>
          </article>
        </div>
      </section>

      {categorias.data !== undefined && categorias.data.elementos.length > 0 && (
        <section className="pa-seccion">
          <h2>Oficios disponibles</h2>
          <div className="pa-fila" style={{ marginTop: 'var(--esp-4)' }}>
            {categorias.data.elementos.map((c) => (
              <Link
                key={c.id}
                to={`/servicios?idCategoria=${c.id}`}
                className="pa-sello pa-sello--neutro pa-oficio"
              >
                {c.nombre}
              </Link>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
