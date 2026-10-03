import { useId, useState, type ReactElement } from 'react';
import { Boton } from './index';

/**
 * Conmutador de modo de uso (SRS 3.3.3, "Selector de modo de uso").
 *
 * Quien tiene los dos roles a la vez necesita saber de que lado esta mirando:
 * el mismo menu, con la misma persona al otro lado, ofrece acciones que no se
 * parecen en nada. Sin el conmutador, ver las dos listas a la vez obliga a
 * deducir de cada enlace en que papel se esta uno, y esa deduccion es la que se
 * equivoca.
 *
 * ── Por que DOS botones con `aria-pressed` y no un `switch` ───────────────────
 *
 * Un `switch` tiene UN nombre estable y un estado de dos valores. Eso obliga a
 * que el nombre no describa el estado, y entonces el lector anuncia "Modo de
 * uso: activado", que no dice si esta mirando como quien busca o como quien
 * presta: hay que acordarse de cual era cual. El nombre se convierte en una
 * etiqueta y el estado en un adivinar.
 *
 * Con dos botones pulsables, el nombre y el estado juntos son la frase entera:
 * "Busco un servicio, boton, pulsado" ya significa "esta viendo la vista de
 * quien busca". No hay memoria que hacer. Y es de paso el caso de uso que
 * corresponde a una eleccion entre dos opciones con nombre, que no es el de un
 * interruptor de encendido y apagado.
 *
 * Descartado `tablist` tambien: no hay dos paneles con los que associate cada
 * pestaña, solo cambia que enlaces hay, y prometer una relacion de panel que no
 * existe es peor que no prometerla.
 *
 * ── El foco NO se mueve ─────────────────────────────────────────────────────
 *
 * Quien pulsa un boton tiene el foco en el. Llevarselo a otro sitio es lo que
 * hace que un conmutador parezca roto: parece que el tabulador ha saltado.
 *
 * Lo que si hace falta es decir QUE cambio, porque los enlaces del menu se
 * acaban de rehacer y un lector de pantalla no se entera solo. De eso se ocupa
 * la region `status` de abajo: cortés —no interrumpe— y solo habla si hubo un
 * cambio de verdad, no al cargar la pagina.
 *
 * El estado activo no se marca solo con color: el relleno cambia de tono Y el
 * peso de la letra, y el `aria-pressed` lo dice en voz alta. Quien no distingue
 * ese verde y quien no usa lector de pantalla se quedan con lo mismo.
 */

/** De que lado esta mirando la persona. Vive aqui y no en el contexto. */
export type Modo = 'solicitante' | 'oferente';

interface Opcion {
  valor: Modo;
  texto: string;
  /** Lo que se anuncia al cambiar a este modo. */
  anuncio: string;
}

/**
 * Las dos vistas, con el texto de cada boton.
 *
 * Van en primera persona porque es la unica forma de que la etiqueta diga quien
 * esta haciendo la accion. "Solicitante" / "Oferente" son los nombres internos
 * de los roles (SRS RNF23) y no le dicen nada a quien todavia no los conoce.
 */
export const MODOS: readonly Opcion[] = [
  {
    valor: 'solicitante',
    texto: 'Busco un servicio',
    anuncio: 'la vista de quien busca un servicio',
  },
  {
    valor: 'oferente',
    texto: 'Ofrezco un servicio',
    anuncio: 'la vista de quien ofrece un servicio',
  },
];

export interface PropsConmutadorModo {
  modo: Modo;
  alCambiar: (modo: Modo) => void;
  /** Nombre del grupo. Se-annuncia antes que los botones. */
  etiqueta?: string;
}

export function ConmutadorModo({
  modo,
  alCambiar,
  etiqueta = 'Modo de uso',
}: PropsConmutadorModo): ReactElement {
  const id = useId();
  const idAyuda = `${id}-ayuda`;

  /**
   * Ultimo modo elegido por la persona, no el modo actual.
   *
   * Se guardan por separado a proposito: al cargar la pagina el modo ya puede
   * venir en la URL o guardado, y eso NO es un cambio que haya que anunciar.
   * Solo hay algo que decir cuando alguien pulsa.
   */
  const [elegido, setElegido] = useState<Modo | null>(null);

  const elegir = (destino: Modo): void => {
    // Pulsar lo que ya esta activo no es un cambio: no se anuncia ni se navega.
    if (destino === modo) return;
    setElegido(destino);
    alCambiar(destino);
  };

  /**
   * Opcion elegida, o `null` si no hubo eleccion.
   *
   * Sin eleccion devuelve `null` y no una cadena vacia: el texto de la region
   * `status` se escribe una sola vez y con `''` dentro, que es distinto de
   * vacio, un lector de pantalla lo anunciaria como si hubiera un cambio.
   */
  const anuncio = elegido === null ? null : (MODOS.find((m) => m.valor === elegido) ?? null);

  return (
    <div
      // El grupo da nombre al conjunto: sin el, el lector anuncia dos botones
      // sueltos sin decir de que son. `role="group"` no tiene equivalente nativo
      // que sirva aqui, porque no hay un `fieldset` que poner alrededor.
      role="group"
      aria-labelledby={`${id}-etiqueta`}
    >
      <span id={`${id}-etiqueta`} className="solo-lectores">
        {etiqueta}
      </span>

      <div className="pa-conmutador">
        {MODOS.map((opcion) => (
          <Boton
            key={opcion.valor}
            variante="fantasma"
            className="pa-conmutador__opcion"
            // El estado, en voz alta y sin depender del color.
            aria-pressed={opcion.valor === modo}
            onClick={() => elegir(opcion.valor)}
          >
            {opcion.texto}
          </Boton>
        ))}
      </div>

      {/*
        La region vive siempre en el DOM, tambien vacia.
        Si se montara solo cuando hay algo que decir, el lector no tendria nada
        que observar en el momento del cambio: es el nodo ya presente el que
        detecta el cambio de contenido.
      */}
      <p id={idAyuda} className="solo-lectores" role="status">
        {anuncio === null ? '' : `Ahora ve ${anuncio.anuncio}. El menu muestra sus enlaces.`}
      </p>
    </div>
  );
}
