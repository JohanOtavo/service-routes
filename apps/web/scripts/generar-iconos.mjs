/*
 * Genera los iconos de la PWA: el SVG y los PNG.
 *
 *   npm run iconos --workspace @punto-amigo/web
 *
 * Una sola geometria alimenta los cuatro ficheros. El icono dibujado a mano
 * en un SVG y luego rasterizado a mano en otro sitio acaba siendo DOS iconos
 * que se diferencian en un detalle, y ese detalle es lo que se nota al
 * compararlos en la rejilla de la pantalla de inicio.
 *
 * Se versionan los ficheros, no solo el script: `git clone` + `npm ci` +
 * `npm run build` tiene que dar un sitio instalable, y eso no puede depender
 * de que quienclone tenga sharp disponible.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const aqui = dirname(fileURLToPath(import.meta.url));
const publico = resolve(aqui, '..', 'public');

const VERDE = '#1f6f5c';
const VERDE_CLARO = '#a6d7c9';
const VERDE_ARCO = '#71bca8';
const TERRACOTA = '#d9712f';

/**
 * El dibujo, sobre un lienzo de 512.
 *
 * Dos puntos claros en los extremos --quien busca y quien ofrece--, el arco que
 * los une, y el encuentro en terracota. Sin degradados: el color ya lleva el
 * estado de una solicitud en el resto de la aplicacion, asi que aqui no puede
 * hacer de adorno; y un icono que se lee a 44 px no admite sutilezas.
 *
 * @param escala  1 = tamano natural. Menos de 1 aparta el dibujo del borde.
 * @param esquinas  radio del lienzo. 0 = a sangre.
 *
 * El `escala` de 0.78 es lo que hace falta para "maskable": Android recorta con
 * una mascara del sistema que puede comerse hasta el 20% de cada lado, y sin ese
 * margen el punto central cae justo en la linea de corte.
 */
function lienzo(escala, esquinas) {
  const d = (v) => (256 + (v - 256) * escala).toFixed(2);
  const fondo =
    esquinas === 0
      ? `<rect width="512" height="512" fill="${VERDE}" />`
      : `<rect width="512" height="512" rx="${esquinas}" fill="${VERDE}" />`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  ${fondo}
  <path d="M${d(164)} ${d(256)} A ${(92 * escala).toFixed(2)} ${(92 * escala).toFixed(2)} 0 0 1 ${d(348)} ${d(256)}"
        fill="none" stroke="${VERDE_ARCO}" stroke-width="${(18 * escala).toFixed(2)}" stroke-linecap="round" />
  <circle cx="${d(164)}" cy="${d(256)}" r="${(46 * escala).toFixed(2)}" fill="${VERDE_CLARO}" />
  <circle cx="${d(348)}" cy="${d(256)}" r="${(46 * escala).toFixed(2)}" fill="${VERDE_CLARO}" />
  <circle cx="256" cy="${d(256)}" r="${(62 * escala).toFixed(2)}" fill="${TERRACOTA}" />
</svg>`;
}

await mkdir(publico, { recursive: true });

/**
 * El SVG sale del mismo sitio que los PNG, y lleva esquinas: es lo que se ve
 * dentro de la aplicacion y en la pestana del navegador.
 */
const svg = lienzo(0.78, 112);
await writeFile(resolve(publico, 'icono.svg'), svg);
console.log(`icono.svg`);

const salidas = [
  // A sangre, sin esquinas: de las esquinas se encarga la mascara del sistema.
  { archivo: 'icono-maskable-512.png', tam: 512, svg: lienzo(1, 0) },
  { archivo: 'icono-512.png', tam: 512, svg: lienzo(0.78, 112) },
  { archivo: 'icono-192.png', tam: 192, svg: lienzo(0.78, 112) },
];

for (const { archivo, tam, svg: fuente } of salidas) {
  // El `resize` no es opcional: el SVG de arriba siempre mide 512x512, asi que
  // sin esto el icono de 192 salia tambien a 512 y los dos ficheros acababan
  // byte a byte identicos.
  const png = await sharp(Buffer.from(fuente))
    .resize(tam, tam)
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(resolve(publico, archivo), png);
  console.log(`${archivo}  ${tam}x${tam}  ${(png.length / 1024).toFixed(1)} KB`);
}
