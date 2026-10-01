/**
 * Decide si merece la pena cargar una escena 3D.
 *
 * El trozo de three.js son unos 224 KB comprimidos. En la portada es adorno, y
 * cobrarle eso a alguien con datos contados para que unas herramientas giren no
 * se sostiene: el degradado del CSS cuenta la misma historia por cero bytes.
 *
 * Se descarta cuando:
 *   - pidieron menos movimiento, que es una peticion de salud y no una
 *     preferencia estetica;
 *   - el navegador dice que la persona quiere ahorrar datos;
 *   - la pantalla es estrecha, donde la escena iria debajo del texto y casi no
 *     se ve, ademas de ser donde los datos suelen costar;
 *   - el dispositivo declara pocos nucleos, senal de gama baja donde una escena
 *     con sombras calienta el telefono.
 *
 * `decorativa` distingue los dos casos. La escena de la portada es adorno y se
 * descarta con facilidad; el relieve de actividad es una lectura del dato y solo
 * cede ante lo que de verdad lo impide.
 */
export function conviene3d({ decorativa }: { decorativa: boolean }): boolean {
  if (typeof window === 'undefined') return false;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;

  // `saveData` solo existe en navegadores basados en Chromium; su ausencia no
  // dice nada y no se interpreta como un no.
  const conexion = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  if (conexion?.saveData === true) return false;

  const tipo = conexion?.effectiveType;
  if (tipo === 'slow-2g' || tipo === '2g') return false;

  if (!decorativa) return true;

  // 60rem es el ancho a partir del cual la portada pone la escena al lado del
  // texto. Por debajo, cuesta lo mismo y se ve la mitad.
  if (!window.matchMedia('(min-width: 60rem)').matches) return false;

  const nucleos = navigator.hardwareConcurrency;
  return nucleos === undefined || nucleos >= 4;
}
