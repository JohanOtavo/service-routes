import { useState } from 'react';
import { ErrorApi } from '../api/cliente';
import {
  useCategorias,
  useCrearPerfil,
  useDesactivarServicio,
  useMiPerfil,
  useMisServicios,
  usePublicarServicio,
} from '../api/hooks';
import {
  Aviso,
  AreaTexto,
  Boton,
  Campo,
  Cargando,
  Selector,
  Sello,
  SelloEstado,
  Tarjeta,
} from '../ui';

const vacioANulo = (valor: string): string | null => (valor.trim() === '' ? null : valor.trim());

function mensaje(fallo: unknown, porDefecto: string): string {
  if (!(fallo instanceof ErrorApi)) return porDefecto;
  return fallo.detalles.length > 0
    ? fallo.detalles.map((d) => d.message).join(' ')
    : fallo.message;
}

/** Perfil de prestador y catalogo propio (SRS RF22 a RF28, RF50 a RF52). */
export default function MiPerfilPrestador() {
  const perfil = useMiPerfil();
  const servicios = useMisServicios();
  const categorias = useCategorias();
  const crear = useCrearPerfil();
  const publicar = usePublicarServicio();
  const desactivar = useDesactivarServicio();

  const [error, setError] = useState<string | null>(null);
  const [nuevoServicio, setNuevoServicio] = useState(false);
  const [perfilDatos, setPerfilDatos] = useState({
    nombre: '',
    especialidad: '',
    experiencia: '',
    telefono: '',
    correo: '',
    disponibilidad: '',
  });
  const [servicioDatos, setServicioDatos] = useState({
    nombre: '',
    descripcion: '',
    idCategoria: '',
  });

  /** Un 404 aqui es el estado normal de quien acaba de registrarse. */
  const sinPerfil =
    perfil.isError && perfil.error instanceof ErrorApi && perfil.error.noEncontrado;

  const crearPerfil = async (evento: React.FormEvent): Promise<void> => {
    evento.preventDefault();
    setError(null);
    try {
      await crear.mutateAsync({
        nombre: perfilDatos.nombre.trim(),
        especialidad: perfilDatos.especialidad.trim(),
        experiencia: vacioANulo(perfilDatos.experiencia),
        telefono: vacioANulo(perfilDatos.telefono),
        correo: vacioANulo(perfilDatos.correo),
        disponibilidad: vacioANulo(perfilDatos.disponibilidad),
      });
    } catch (fallo) {
      setError(mensaje(fallo, 'No se pudo crear el perfil.'));
    }
  };

  const crearServicio = async (evento: React.FormEvent): Promise<void> => {
    evento.preventDefault();
    setError(null);
    try {
      await publicar.mutateAsync({
        nombre: servicioDatos.nombre.trim(),
        descripcion: servicioDatos.descripcion.trim(),
        idCategoria: Number(servicioDatos.idCategoria),
      });
      setNuevoServicio(false);
      setServicioDatos({ nombre: '', descripcion: '', idCategoria: '' });
    } catch (fallo) {
      setError(mensaje(fallo, 'No se pudo publicar el servicio.'));
    }
  };

  if (perfil.isPending) return <Cargando que="su perfil" />;

  return (
    <div style={{ maxWidth: '48rem' }}>
      <h1>Mi perfil de prestador</h1>
      {error !== null && <Aviso tono="error">{error}</Aviso>}

      {sinPerfil && (
        <Tarjeta>
          <h2 className="pa-tarjeta__titulo">Cree su perfil</h2>
          <p className="pa-tarjeta__meta">
            Un administrador lo revisara antes de que aparezca en el catalogo.
            Mientras tanto nadie lo ve.
          </p>

          <form onSubmit={(ev) => void crearPerfil(ev)} noValidate style={{ marginTop: 'var(--esp-4)' }}>
            <Campo
              etiqueta="Nombre con el que trabaja"
              name="nombre"
              requerido
              ayuda="Puede ser su nombre o el de su taller."
              value={perfilDatos.nombre}
              onChange={(ev) => setPerfilDatos((p) => ({ ...p, nombre: ev.target.value }))}
            />
            <Campo
              etiqueta="Su oficio"
              name="especialidad"
              requerido
              ayuda="Por ejemplo: plomeria y redes de agua."
              value={perfilDatos.especialidad}
              onChange={(ev) => setPerfilDatos((p) => ({ ...p, especialidad: ev.target.value }))}
            />
            <AreaTexto
              etiqueta="Su experiencia"
              name="experiencia"
              ayuda="Opcional. Cuente cuanto lleva y que trabajos hace."
              value={perfilDatos.experiencia}
              onChange={(ev) => setPerfilDatos((p) => ({ ...p, experiencia: ev.target.value }))}
            />
            <Campo
              etiqueta="Telefono de contacto"
              name="telefono"
              type="tel"
              inputMode="tel"
              ayuda="Solo se le muestra a quien ya acordo un trabajo con usted. Nunca aparece en el catalogo."
              value={perfilDatos.telefono}
              onChange={(ev) => setPerfilDatos((p) => ({ ...p, telefono: ev.target.value }))}
            />
            <Campo
              etiqueta="Correo de contacto"
              name="correo"
              type="email"
              inputMode="email"
              ayuda="Igual que el telefono: solo tras el acuerdo."
              value={perfilDatos.correo}
              onChange={(ev) => setPerfilDatos((p) => ({ ...p, correo: ev.target.value }))}
            />
            <Campo
              etiqueta="Cuando puede atender"
              name="disponibilidad"
              ayuda="Opcional. Por ejemplo: lunes a viernes, 8am a 6pm."
              value={perfilDatos.disponibilidad}
              onChange={(ev) => setPerfilDatos((p) => ({ ...p, disponibilidad: ev.target.value }))}
            />

            <Boton type="submit" variante="acento" cargando={crear.isPending}>
              Crear perfil
            </Boton>
          </form>
        </Tarjeta>
      )}

      {perfil.data !== undefined && (
        <>
          <Tarjeta>
            <div className="pa-fila pa-fila--separada">
              <h2 className="pa-tarjeta__titulo">{perfil.data.nombre}</h2>
              <div className="pa-fila">
                <SelloEstado estado={perfil.data.estado} />
                {perfil.data.validado && <Sello tono="validado">Validado</Sello>}
              </div>
            </div>
            <p>{perfil.data.especialidad}</p>
            {perfil.data.experiencia !== null && (
              <p style={{ marginTop: 'var(--esp-2)', whiteSpace: 'pre-wrap' }}>
                {perfil.data.experiencia}
              </p>
            )}

            {!perfil.data.validado && (
              <Aviso tono="aviso" titulo="Su perfil esta en revision">
                Mientras un administrador no lo valide, no aparece en el catalogo
                y no puede publicar servicios ni enviar propuestas.
              </Aviso>
            )}
          </Tarjeta>

          <Tarjeta>
            <div className="pa-fila pa-fila--separada">
              <h2 className="pa-tarjeta__titulo">Mis servicios</h2>
              {/* El boton solo aparece si el perfil esta validado: el servidor
                  lo rechazaria igualmente, y ofrecerlo seria prometer algo que
                  va a fallar. */}
              {perfil.data.validado && !nuevoServicio && (
                <Boton variante="acento" onClick={() => setNuevoServicio(true)}>
                  Publicar un servicio
                </Boton>
              )}
            </div>

            {nuevoServicio && (
              <form onSubmit={(ev) => void crearServicio(ev)} noValidate>
                <Campo
                  etiqueta="Nombre del servicio"
                  name="nombreServicio"
                  requerido
                  value={servicioDatos.nombre}
                  onChange={(ev) => setServicioDatos((p) => ({ ...p, nombre: ev.target.value }))}
                />
                <AreaTexto
                  etiqueta="Que incluye"
                  name="descripcionServicio"
                  requerido
                  ayuda="Al menos 10 caracteres. Diga que hace, que materiales pone y que NO incluye."
                  value={servicioDatos.descripcion}
                  onChange={(ev) =>
                    setServicioDatos((p) => ({ ...p, descripcion: ev.target.value }))
                  }
                />
                <Selector
                  etiqueta="Oficio"
                  name="idCategoriaServicio"
                  requerido
                  vacio="Elija un oficio"
                  value={servicioDatos.idCategoria}
                  onChange={(ev) =>
                    setServicioDatos((p) => ({ ...p, idCategoria: ev.target.value }))
                  }
                  opciones={(categorias.data?.elementos ?? []).map((c) => ({
                    valor: String(c.id),
                    texto: c.nombre,
                  }))}
                />
                <div className="pa-fila">
                  <Boton type="submit" variante="acento" cargando={publicar.isPending}>
                    Publicar
                  </Boton>
                  <Boton variante="fantasma" onClick={() => setNuevoServicio(false)}>
                    Cancelar
                  </Boton>
                </div>
              </form>
            )}

            {(servicios.data?.elementos ?? []).length === 0 && !nuevoServicio && (
              <p className="pa-tarjeta__meta">Todavia no ha publicado servicios.</p>
            )}

            <div className="pa-pila pa-pila--2" style={{ marginTop: 'var(--esp-3)' }}>
              {(servicios.data?.elementos ?? []).map((s) => (
                <div key={s.id} className="pa-fila pa-fila--separada">
                  <div>
                    <strong>{s.nombre}</strong>
                    <p className="pa-tarjeta__meta">{s.descripcion.slice(0, 90)}</p>
                  </div>
                  <div className="pa-fila">
                    <SelloEstado estado={s.estado} />
                    {s.estado === 'ACTIVE' && (
                      <Boton
                        variante="peligro"
                        cargando={desactivar.isPending}
                        onClick={() => void desactivar.mutateAsync(s.id)}
                      >
                        Retirar
                      </Boton>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Tarjeta>
        </>
      )}

      {perfil.isError && !sinPerfil && (
        <Aviso tono="error">No se pudo cargar su perfil. Intentelo de nuevo.</Aviso>
      )}
    </div>
  );
}
