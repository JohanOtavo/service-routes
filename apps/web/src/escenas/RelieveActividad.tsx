import { Canvas } from '@react-three/fiber';
import { useMemo, type ReactElement } from 'react';
import * as THREE from 'three';

/**
 * Relieve de actividad: una barra por dia, con la altura del numero de asientos.
 *
 * Es la segunda y ultima escena 3D de la aplicacion. Esta aqui porque la altura
 * se compara de un golpe mejor que un tono de color: en un mapa de calor plano,
 * distinguir 40 de 60 obliga a mirar la leyenda, y en relieve se ve.
 *
 * Lo que NO hace es ser la unica forma de leer el dato. Debajo hay siempre una
 * tabla con las mismas cifras, y este lienzo esta marcado como decorativo para
 * los lectores de pantalla. Un grafico que solo existe en 3D es un dato que
 * alguien no puede consultar.
 */

interface Punto {
  fecha: string;
  total: number;
}

const ALTO_MAXIMO = 2.6;
const ANCHO_BARRA = 0.42;
const SEPARACION = 0.56;

function Barras({ puntos }: { puntos: readonly Punto[] }): ReactElement {
  /**
   * La escala se calcula del maximo de ESTE conjunto, no de un tope fijo.
   *
   * Con un tope fijo, un dia flojo daria barras invisibles y un dia intenso las
   * sacaria del encuadre. Relativo, el relieve siempre llena el espacio.
   */
  const maximo = useMemo(() => Math.max(1, ...puntos.map((p) => p.total)), [puntos]);

  const centro = ((puntos.length - 1) * SEPARACION) / 2;

  return (
    <group>
      {puntos.map((p, i) => {
        const alto = Math.max(0.06, (p.total / maximo) * ALTO_MAXIMO);
        // Del verde de marca al terracota segun la intensidad: el mismo par de
        // colores que el resto de la aplicacion, no una paleta nueva.
        const color = new THREE.Color('#1f6f5c').lerp(new THREE.Color('#c2571f'), p.total / maximo);

        return (
          <mesh
            key={p.fecha}
            position={[i * SEPARACION - centro, alto / 2 - 1, 0]}
            castShadow
            receiveShadow
          >
            <boxGeometry args={[ANCHO_BARRA, alto, ANCHO_BARRA]} />
            <meshStandardMaterial color={color} roughness={0.5} metalness={0.1} />
          </mesh>
        );
      })}
    </group>
  );
}

export default function RelieveActividad({
  puntos,
}: {
  puntos: readonly Punto[];
}): ReactElement | null {
  /**
   * Se dibujan como maximo 30 dias, los mas recientes.
   *
   * Con noventa barras cada una mide dos pixeles y el relieve deja de decir
   * nada. Y se invierten porque el servidor los devuelve de lo mas reciente a
   * lo mas antiguo, mientras que un eje de tiempo se lee al contrario.
   */
  const visibles = useMemo(() => [...puntos].slice(0, 30).reverse(), [puntos]);

  if (visibles.length === 0) return null;

  return (
    <Canvas
      dpr={[1, 1.8]}
      shadows
      camera={{ position: [0, 2.6, 7.5], fov: 34 }}
      gl={{ antialias: true, alpha: true }}
      style={{ width: '100%', height: '100%' }}
    >
      <ambientLight intensity={0.6} color="#f6ecdf" />
      <directionalLight
        position={[-4, 6, 4]}
        intensity={1.8}
        color="#fff2e0"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[4, 2, -3]} intensity={0.3} color="#dfeaf2" />

      {/* Camara fija y ligeramente en angulo. Sin controles de orbita a
          proposito: en un movil, arrastrar para girar un grafico se come el
          gesto de desplazar la pagina. */}
      <group rotation={[0, -0.32, 0]}>
        <Barras puntos={visibles} />

        {/* Suelo que solo recibe sombra: da el apoyo sin meter un plano gris. */}
        <mesh position={[0, -1, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[30, 30]} />
          <shadowMaterial transparent opacity={0.16} color="#2e2a25" />
        </mesh>
      </group>
    </Canvas>
  );
}
