import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSesion } from './ContextoSesion';
import type { Modo } from '../ui/ConmutadorModo';

/**
 * Modo de uso (SRS 3.3.3, "Selector de modo de uso").
 *
 * ── Donde vive la eleccion ──────────────────────────────────────────────────
 *
 * En DOS sitios a la vez, y el orden entre ellos es lo que importa:
 *
 *   1. `?modo=oferente` en la URL. Es lo que se ve al recargar y lo que se
 *      puede compartir. Un enlace de la vista de oferente que llega a otra
 *      persona abre esa vista, y el boton de atras deshace el cambio como
 *      deshace cualquier otro: no hace falta escribir una maquina de estados
 *      para que "atras" funcione.
 *   2. `localStorage`, para cuando la URL no dice nada.
 *
 * Y la URL manda sobre lo guardado. Si no, un enlace compartido con
 * `?modo=oferente` abriria en la vista de oferente y, en el mismo instante,
 * saltaria al modo que esa persona tenga de la ultima vez. Un enlace tiene que
 * ser un enlace.
 *
 * Se escribe en los dos sitios a la vez al cambiar, para que un enlace normal —
 * que no lleva el parametro y por tanto lo borra al navegar— no pierda la
 * eleccion.
 *
 * ── Por que no basta con `localStorage` ──────────────────────────────────────
 *
 * Sin URL no hay enlace compartible: "mira esto" obliga a describir de palabra
 * en que vista se esta. Y sin `localStorage`, recargar con la URL limpia
 * devuelve el modo por omision, que es perder el estado de una decision que la
 * persona acaba de tomar.
 *
 * ── NO es seguridad ─────────────────────────────────────────────────────────
 *
 * Igual que el menu por roles y que `RutaProtegida`, esto decide QUE SE MUESTRA
 * y no quien puede hacer que. El servidor comprueba el rol en cada endpoint
 * (SRS RNF23): cambiar el modo a mano desde la barra de direcciones no da
 * acceso a nada. Por eso el modo se corrige contra los roles que la persona
 * tiene de verdad, en lugar de fiarse de lo que dice la URL.
 */

/** Clave de `localStorage`. Versionada porque el valor se podria reordenar. */
const LLAVE = 'punto-amigo:modo:v1';

/** Lo que se elige cuando no hay nada guardado ni nada en la URL. */
export const MODO_POR_OMISION: Modo = 'solicitante';

/** Nombre del parametro de la URL. Corto, y el mismo en todo el cliente. */
export const PARAMETRO_MODO = 'modo';

interface Contexto {
  /** Vista desde la que se esta mirando. Siempre definido. */
  modo: Modo;
  /**
   * Si tiene sentido ofrecer el conmutador.
   *
   * Es la condicion del SRS: los dos roles a la vez. Con uno solo no hay nada
   * que alternar, y esconderlo evita un control que solo puede hacer una cosa.
   */
  puedeElegir: boolean;
  cambiarModo: (modo: Modo) => void;
}

const ContextoModo = createContext<Contexto | null>(null);

/**
 * Lee el modo guardado.
 *
 * Va en un `try` porque `localStorage` lanza si el navegador lo tiene
 * bloqueado —modo privado en algunos, o una politica de empresa— y una
 * preferencia no puede ser motivo para que la aplicacion no arranque.
 */
function leerGuardado(): Modo | null {
  try {
    const bruto = window.localStorage.getItem(LLAVE);
    return bruto === 'solicitante' || bruto === 'oferente' ? bruto : null;
  } catch {
    return null;
  }
}

function guardar(modo: Modo): void {
  try {
    window.localStorage.setItem(LLAVE, modo);
  } catch {
    // Sin almacenamiento el modo se pierde al recargar. Es una molestia, no una
    // averia: se sigue funcionando y el aviso no merecia la pena.
  }
}

/** Descarta lo que venga de la URL si no es uno de los dos modos. */
function modoValido(bruto: string | null): Modo | null {
  return bruto === 'solicitante' || bruto === 'oferente' ? bruto : null;
}

/**
 * Modo exclusivo de una pantalla, o `null` si la comparten los dos papeles.
 *
 * "Compartida" significa `/contrataciones`, `/avisos` y `/mi-cuenta`: las ven las
 * dos partes y, al cambiar de modo, no hay motivo para echar a nadie de ellas.
 *
 * ── Por que el catalogo SI es de la vista de solicitante ──────────────────────
 *
 * `/servicios` es publico y lo puede mirar quien sea, y aun asi aqui pertenece a
 * la vista de solicitante. No porque se reserve a nadie —no se reserva— sino
 * porque, con los dos roles a la vez, el menu de oferente NO lo menciona: si al
 * pasar a oferente se dejara a la persona mirando "Buscar servicios", se
 * quedaria en una pantalla que su propio menu ya no nombra, y el conmutador
 * habria roto la promesa de "el menu muestra donde estas".
 *
 * No molesta a quien solo ofrece: no hay conmutador, asi que la funcion no llega
 * a preguntarse nada. Solo se usa al cambiar de modo, que es justo cuando el
 * menu es una de las dos listas.
 *
 * El corte es por segmento, no por prefijo a pelo: `/necesidades` no puede
 * cogerse a `/necesidades-abajo`. Es el mismo cuidado que ponia el gateway en
 * su lista de rutas publicas, y por el mismo motivo.
 */
const PANTALLAS_EXCLUSIVAS: readonly { prefijo: string; modo: Modo }[] = [
  { prefijo: '/necesidades', modo: 'oferente' },
  { prefijo: '/mis-propuestas', modo: 'oferente' },
  { prefijo: '/mi-perfil-prestador', modo: 'oferente' },
  { prefijo: '/mis-necesidades', modo: 'solicitante' },
  { prefijo: '/servicios', modo: 'solicitante' },
];

export function modoDePantalla(ruta: string): Modo | null {
  const camino = ruta.split('?')[0] ?? ruta;

  let mejor: { prefijo: string; modo: Modo } | null = null;
  for (const pantalla of PANTALLAS_EXCLUSIVAS) {
    const coincide = camino === pantalla.prefijo || camino.startsWith(`${pantalla.prefijo}/`);
    if (coincide && (mejor === null || pantalla.prefijo.length > mejor.prefijo.length)) {
      mejor = pantalla;
    }
  }

  return mejor?.modo ?? null;
}

export function ProveedorModo({ children }: { children: ReactNode }): ReactElement {
  const { tieneRol } = useSesion();
  const [consulta, cambiarConsulta] = useSearchParams();

  const enUrl = modoValido(consulta.get(PARAMETRO_MODO));

  /**
   * Se lee UNA vez, al montar.
   *
   * La URL manda sobre esto, de modo que volver a leerla en cada cambio de
   * `enUrl` solo serviria para pisar la preferencia con el mismo valor que ya
   * tiene. Y leer `localStorage` en cada dibujado es trabajo de disco en el
   * camino que dibuja la cabecera, que es lo unico que cambia en cada pantalla.
   */
  const [deAlmacen] = useState(leerGuardado);

  const pedido = enUrl ?? deAlmacen ?? MODO_POR_OMISION;

  /**
   * El modo no puede ser de un rol que no se tiene.
   *
   * Sin esta correccion, un `?modo=oferente` a mano —o un `localStorage` que se
   * quedo de cuando la persona tenia los dos roles— dejaria el menu mostrando
   * enlaces de oferente a quien no es oferente. El menu pasaria a prometer
   * pantallas cuyo unico contenido seria "no es para tu perfil".
   */
  const modo: Modo = pedido === 'oferente' && !tieneRol('OFERENTE') ? 'solicitante' : pedido;

  const cambiarModo = useCallback(
    (destino: Modo) => {
      // Se guarda antes de tocar la URL: si la URL falla, la preferencia por
      // menos sobrevive a la recarga.
      guardar(destino);

      /**
       * `push` y no `replace`: cambiar de modo es un paso que se puede deshacer.
       *
       * Con `replace`, el boton de atras saltaria por encima del cambio de modo
       * en lugar de revertirlo, que es justo lo que se espera de un conmutador
       * en una cabecera que no ha cambiado de sitio.
       */
      cambiarConsulta(
        (anterior) => {
          const siguiente = new URLSearchParams(anterior);
          siguiente.set(PARAMETRO_MODO, destino);
          return siguiente;
        },
        { replace: false }
      );
    },
    [cambiarConsulta]
  );

  /**
   * Los dos roles a la vez, y solo entonces.
   *
   * Administrador no cuenta: es un tercer papel que se superpone a los otros y
   * no es una de las dos vistas que el conmutador alterna.
   */
  const puedeElegir = tieneRol('SOLICITANTE') && tieneRol('OFERENTE');

  const valor = useMemo<Contexto>(
    () => ({ modo, puedeElegir, cambiarModo }),
    [modo, puedeElegir, cambiarModo]
  );

  return <ContextoModo.Provider value={valor}>{children}</ContextoModo.Provider>;
}

export function useModo(): Contexto {
  const contexto = useContext(ContextoModo);
  if (contexto === null) {
    throw new Error('useModo se usa dentro de ProveedorModo.');
  }
  return contexto;
}
