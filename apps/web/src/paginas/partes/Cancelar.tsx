import { useState, type ReactElement } from 'react';
import { ErrorApi } from '../../api/cliente';
import { useCancelar, useMotivosCancelacion } from '../../api/hooks';
import { Aviso, AreaTexto, Boton, Campo, Selector } from '../../ui';

/**
 * Cancelacion, con su politica a la vista.
 *
 * Lo que mas importa de esta pantalla es que NO esconde el efecto. Se dice de
 * antemano que el motivo elegido puede abrir revision, se pide la fecha
 * acordada porque de ella depende la franja, y al terminar se muestra el peso
 * que la cancelacion tuvo. Como no hay cobro, la reputacion y la visibilidad
 * son el unico instrumento disuasorio, y un instrumento que no se ve no
 * disuade: lo que no se sabe no corrige el comportamiento.
 */
export function Cancelar({
  idSolicitud,
  estado,
}: {
  idSolicitud: number;
  estado: string;
}): ReactElement | null {
  const motivos = useMotivosCancelacion();
  const cancelar = useCancelar();

  const [abierto, setAbierto] = useState(false);
  const [codigo, setCodigo] = useState('');
  const [detalle, setDetalle] = useState('');
  const [fechaAcordada, setFechaAcordada] = useState('');
  const [error, setError] = useState<string | null>(null);

  const elegido = (motivos.data?.elementos ?? []).find((m) => m.codigo === codigo);

  const enviar = async (evento: React.FormEvent): Promise<void> => {
    evento.preventDefault();
    setError(null);

    try {
      await cancelar.mutateAsync({
        id: idSolicitud,
        codigoMotivo: codigo,
        detalle: detalle.trim() === '' ? null : detalle.trim(),
        // Se envia como instante: el servidor mide la franja contra el.
        fechaAcordada:
          fechaAcordada === '' ? null : new Date(`${fechaAcordada}T12:00:00`).toISOString(),
      });
    } catch (fallo) {
      if (fallo instanceof ErrorApi) {
        setError(
          fallo.detalles.length > 0 ? fallo.detalles.map((d) => d.message).join(' ') : fallo.message
        );
      } else {
        setError('No se pudo cancelar. Intentelo de nuevo.');
      }
    }
  };

  /** Ya se cancelo: se muestra lo que costo. */
  if (cancelar.isSuccess) {
    const r = cancelar.data;
    return (
      <Aviso
        tono={r.enRevision ? 'aviso' : r.computa ? 'aviso' : 'exito'}
        titulo="La contratacion quedo cancelada"
      >
        {r.enRevision ? (
          <>
            El motivo que eligio abre una revision. Hasta que se resuelva, esta cancelacion{' '}
            <strong>no cuenta</strong> en su tasa.
          </>
        ) : r.computa ? (
          <>
            Cuenta en su tasa de cancelacion con un peso de{' '}
            <strong>{r.peso.toString().replace('.', ',')}</strong> ({textoFranja(r.franja)}). Las
            contrataciones que complete la haran bajar.
          </>
        ) : (
          <>
            No cuenta en su tasa de cancelacion{' '}
            {r.franja === 'GRACIA'
              ? 'porque aviso muy pronto despues de aceptar.'
              : 'por el motivo que eligio.'}
          </>
        )}
      </Aviso>
    );
  }

  /**
   * Ya estaba cancelada al entrar: no hay nada que cancelar.
   *
   * Va DESPUES del bloque de exito a proposito. La pagina deja montado este
   * componente cuando el estado es `CANCELADA` justamente para que el
   * resultado de arriba sobreviva al cambio de estado; antes lo desmontaba, y
   * el mensaje que explica si la cancelacion cuenta en la tasa y con que peso
   * se iba de la pantalla antes de que nadie lo leyera. Era el unico momento
   * en que se le dice a la persona.
   */
  if (estado === 'CANCELADA') return null;

  if (!abierto) {
    return (
      <Boton variante="peligro" onClick={() => setAbierto(true)}>
        Cancelar la contratacion
      </Boton>
    );
  }

  return (
    <form onSubmit={(ev) => void enviar(ev)} noValidate>
      <Aviso tono="aviso" titulo="Cancelar tiene efecto en su reputacion">
        Cuanto mas tarde avise, mas pesa la cancelacion. Si todavia no ha pasado mucho desde que se
        acepto, no cuenta.
      </Aviso>

      {error !== null && <Aviso tono="error">{error}</Aviso>}

      <Selector
        etiqueta="Por que cancela"
        name="codigoMotivo"
        requerido
        vacio="Elija un motivo"
        value={codigo}
        onChange={(ev) => setCodigo(ev.target.value)}
        opciones={(motivos.data?.elementos ?? []).map((m) => ({
          valor: m.codigo,
          texto: m.descripcion,
        }))}
      />

      {/* Se avisa ANTES de enviar, no despues: elegir "la contraparte no se
          presento" no es un atajo para no cargar con la cancelacion. */}
      {elegido?.abreRevision === true && (
        <Aviso tono="info">
          Este motivo abre una revision. Alguien de la plataforma lo mirara antes de que surta
          efecto, y la otra parte podra responder.
        </Aviso>
      )}

      {elegido?.exigeDetalle === true && (
        <AreaTexto
          etiqueta="Explique que paso"
          name="detalle"
          requerido
          ayuda="Al menos 10 caracteres. Este motivo necesita una explicacion."
          value={detalle}
          onChange={(ev) => setDetalle(ev.target.value)}
        />
      )}

      <Campo
        etiqueta="Fecha en que habian quedado"
        name="fechaAcordada"
        type="date"
        ayuda="Si la acordaron. De lo cerca que este depende cuanto pesa la cancelacion."
        value={fechaAcordada}
        onChange={(ev) => setFechaAcordada(ev.target.value)}
      />

      <div className="pa-fila">
        <Boton
          type="submit"
          variante="peligro"
          cargando={cancelar.isPending}
          disabled={codigo === ''}
        >
          Confirmar la cancelacion
        </Boton>
        <Boton variante="fantasma" onClick={() => setAbierto(false)}>
          No cancelar
        </Boton>
      </div>
    </form>
  );
}

/** Explica la franja en palabras, no con su nombre tecnico. */
function textoFranja(franja: string): string {
  switch (franja) {
    case 'GRACIA':
      return 'aviso inmediato';
    case 'HOLGADA':
      return 'aviso con tiempo';
    case 'AJUSTADA':
      return 'aviso con poco margen';
    case 'TARDIA':
      return 'aviso tarde o fuera de plazo';
    default:
      return franja.toLowerCase();
  }
}
