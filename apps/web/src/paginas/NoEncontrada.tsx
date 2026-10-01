import { Link } from 'react-router-dom';
import { Vacio } from '../ui';

export default function NoEncontrada() {
  return (
    <Vacio
      titulo="Esta pagina no existe"
      accion={
        <Link to="/" className="pa-boton pa-boton--primario">
          Volver al inicio
        </Link>
      }
    >
      Puede que el enlace este mal escrito, o que lo que buscaba ya no este
      disponible.
    </Vacio>
  );
}
