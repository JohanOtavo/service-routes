import { useState, type ReactElement } from 'react';
import { ErrorApi } from '../../api/cliente';
import { useCalificar } from '../../api/hooks';
import { Aviso, AreaTexto, Boton, Tarjeta } from '../../ui';

/**
 * Calificar, con el periodo ciego explicado.
 *
 * Hay que decir que la calificacion queda oculta hasta que la otra parte
 * tambien escriba. Sin esa explicacion, quien califica cree que su nota ya se
 * ve y no entiende por que el perfil del otro no cambia; y lo que es peor,
 * puede moderar lo que escribe por miedo a una represalia que esta regla existe
 * precisamente para impedir.
 */
export function Calificar({ idSolicitud }: { idSolicitud: number }): ReactElement {
  const calificar = useCalificar();
  const [puntuacion, setPuntuacion] = useState(0);
  const [comentario, setComentario] = useState('');
  const [error, setError] = useState<string | null>(null);

  const enviar = async (evento: React.FormEvent): Promise<void> => {
    evento.preventDefault();
    setError(null);

    try {
      await calificar.mutateAsync({
        idSolicitud,
        puntuacion,
        comentario: comentario.trim() === '' ? null : comentario.trim(),
      });
    } catch (fallo) {
      if (fallo instanceof ErrorApi) {
        setError(
          fallo.estado === 409
            ? 'Ya califico esta contratacion. Cada parte califica una sola vez.'
            : fallo.message
        );
      } else {
        setError('No se pudo enviar la calificacion. Intentelo de nuevo.');
      }
    }
  };

  if (calificar.isSuccess) {
    return (
      <Tarjeta>
        <h2 className="pa-tarjeta__titulo">Gracias por calificar</h2>
        <Aviso tono="info" titulo="Su calificacion esta guardada y todavia oculta">
          Se publicara cuando la otra parte tambien califique, o cuando venza el plazo. Las dos se
          revelan a la vez para que nadie pueda responder en represalia.
        </Aviso>
      </Tarjeta>
    );
  }

  return (
    <Tarjeta>
      <h2 className="pa-tarjeta__titulo">Califique esta contratacion</h2>
      <p className="pa-tarjeta__meta">
        Lo que escriba queda oculto hasta que la otra parte califique tambien. Puede ser sincero:
        nadie va a leer su nota y responder a ella.
      </p>

      {error !== null && <Aviso tono="error">{error}</Aviso>}

      <form onSubmit={(ev) => void enviar(ev)} noValidate style={{ marginTop: 'var(--esp-4)' }}>
        {/*
         * Las estrellas son botones de verdad dentro de un grupo con nombre.
         *
         * Hechas con iconos y un `onClick` en un `div` quedarian invisibles para
         * un lector de pantalla y no se podrian recorrer con el tabulador.
         */}
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 var(--esp-4)' }}>
          <legend className="pa-campo__etiqueta" style={{ marginBottom: 'var(--esp-2)' }}>
            Como estuvo, de 1 a 5
          </legend>
          <div className="pa-fila" role="radiogroup" aria-label="Puntuacion">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={puntuacion === n}
                aria-label={`${n} de 5`}
                onClick={() => setPuntuacion(n)}
                className={`pa-boton ${
                  puntuacion >= n ? 'pa-boton--primario' : 'pa-boton--secundario'
                }`}
                style={{ minWidth: 'var(--toque-min)' }}
              >
                {n}
              </button>
            ))}
          </div>
        </fieldset>

        <AreaTexto
          etiqueta="Quiere contar algo mas"
          name="comentario"
          ayuda="Opcional. Hasta 1000 caracteres."
          maxLength={1000}
          value={comentario}
          onChange={(ev) => setComentario(ev.target.value)}
        />

        <Boton
          type="submit"
          variante="acento"
          cargando={calificar.isPending}
          disabled={puntuacion === 0}
        >
          Enviar calificacion
        </Boton>
      </form>
    </Tarjeta>
  );
}
