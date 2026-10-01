import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/**
 * Escena de portada: herramientas flotando sobre una superficie calida.
 *
 * Esta en 3D porque es lo primero que ve alguien que no sabe que es Punto
 * Amigo, y una imagen plana no transmite oficio. El resto de la aplicacion NO
 * lleva 3D: en una lista de contrataciones solo estorbaria.
 *
 * Todo son primitivas de three.js, sin modelos descargados. Tres razones: no
 * hay archivos que bajar en una conexion lenta, no hay licencias de terceros
 * que rastrear, y el aspecto depende de la luz y el material, que es de donde
 * sale el realismo de verdad.
 *
 * El modulo entero va en carga diferida y en su propio trozo del paquete:
 * three.js pesa mas que toda la aplicacion junta.
 */

const TERRACOTA = '#c2571f';
const ACERO = '#b8bcc0';
const MADERA = '#9c6b45';

/** Una llave inglesa simplificada: mango, cabeza y boca. */
function Llave({ posicion, rotacion }: { posicion: [number, number, number]; rotacion: number }) {
  return (
    <group position={posicion} rotation={[0.3, rotacion, 0.6]}>
      <mesh castShadow receiveShadow>
        <capsuleGeometry args={[0.09, 1.5, 4, 12]} />
        {/* `metalness` alto y `roughness` medio: acero usado, no cromado de
            catalogo. Un metal perfecto se ve falso. */}
        <meshStandardMaterial color={ACERO} metalness={0.85} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.9, 0]} castShadow>
        <torusGeometry args={[0.26, 0.08, 10, 20, Math.PI * 1.45]} />
        <meshStandardMaterial color={ACERO} metalness={0.85} roughness={0.3} />
      </mesh>
      <mesh position={[0, -0.9, 0]} castShadow>
        <boxGeometry args={[0.5, 0.22, 0.2]} />
        <meshStandardMaterial color={ACERO} metalness={0.8} roughness={0.4} />
      </mesh>
    </group>
  );
}

/** Un destornillador: mango de plastico y punta de acero. */
function Destornillador({
  posicion,
  rotacion,
}: {
  posicion: [number, number, number];
  rotacion: number;
}) {
  return (
    <group position={posicion} rotation={[0.5, rotacion, -0.4]}>
      <mesh castShadow>
        <capsuleGeometry args={[0.17, 0.75, 4, 14]} />
        <meshStandardMaterial color={TERRACOTA} roughness={0.55} metalness={0.05} />
      </mesh>
      <mesh position={[0, -0.75, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.045, 0.9, 10]} />
        <meshStandardMaterial color={ACERO} metalness={0.9} roughness={0.25} />
      </mesh>
      <mesh position={[0, -1.22, 0]} castShadow>
        <boxGeometry args={[0.16, 0.1, 0.03]} />
        <meshStandardMaterial color={ACERO} metalness={0.9} roughness={0.3} />
      </mesh>
    </group>
  );
}

/** Una brocha: mango de madera, virola y cerdas. */
function Brocha({ posicion, rotacion }: { posicion: [number, number, number]; rotacion: number }) {
  return (
    <group position={posicion} rotation={[-0.35, rotacion, 0.45]}>
      <mesh castShadow>
        <capsuleGeometry args={[0.12, 0.85, 4, 12]} />
        <meshStandardMaterial color={MADERA} roughness={0.75} metalness={0} />
      </mesh>
      <mesh position={[0, -0.62, 0]} castShadow>
        <cylinderGeometry args={[0.2, 0.17, 0.26, 12]} />
        <meshStandardMaterial color={ACERO} metalness={0.7} roughness={0.45} />
      </mesh>
      <mesh position={[0, -0.95, 0]} castShadow>
        <boxGeometry args={[0.42, 0.45, 0.14]} />
        {/* Cerdas: muy rugoso y sin metal, para que la luz no rebote. */}
        <meshStandardMaterial color="#d9c9a8" roughness={0.95} metalness={0} />
      </mesh>
    </group>
  );
}

/**
 * El conjunto gira muy despacio.
 *
 * Un giro lento se lee como "vivo"; uno rapido marea y distrae del texto que
 * esta al lado, que es lo que la persona tiene que leer. Si pidio menos
 * movimiento, no gira: la rotacion continua es de lo que peor sienta a quien
 * tiene sensibilidad al movimiento.
 */
function Conjunto({ animar }: { animar: boolean }) {
  const grupo = useRef<THREE.Group>(null);

  useFrame((_estado, delta) => {
    if (!animar || grupo.current === null) return;
    // Por delta y no por fotograma: a 120 Hz giraria al doble de velocidad.
    grupo.current.rotation.y += delta * 0.18;
  });

  return (
    <group ref={grupo}>
      <Llave posicion={[-1.5, 0.3, 0]} rotacion={0.2} />
      <Destornillador posicion={[1.4, -0.1, 0.6]} rotacion={-0.6} />
      <Brocha posicion={[0.2, 0.6, -1.1]} rotacion={1.1} />
    </group>
  );
}

/**
 * Entorno para que el metal parezca metal.
 *
 * Un material con `metalness` alto NO tiene color propio: se ve reflejando lo
 * que tiene alrededor. Sin entorno no hay nada que reflejar y el acero sale
 * NEGRO, que es exactamente lo que pasaba antes de esto. `RoomEnvironment` es
 * una habitacion sintetica que viene con three.js: no hay que descargar ningun
 * mapa de mil kilobytes y basta para que se lea como acero.
 *
 * Se genera una vez y se libera al desmontar: una textura PMREM ocupa memoria
 * de video, y dejarla colgando la fuga en cada visita a la portada.
 */
function Entorno() {
  const { scene, gl } = useThree();

  useEffect(() => {
    const generador = new THREE.PMREMGenerator(gl);
    const objetivo = generador.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = objetivo.texture;

    return () => {
      scene.environment = null;
      objetivo.dispose();
      generador.dispose();
    };
  }, [scene, gl]);

  return null;
}

export default function HeroeTaller({ animar }: { animar: boolean }) {
  /** Luz calida arriba a la izquierda, como una ventana. Es lo que da el oficio. */
  const luzClave = useMemo(() => new THREE.Color('#fff2e0'), []);

  return (
    <Canvas
      // `dpr` acotado: en un movil con pantalla de 3x, renderizar a resolucion
      // completa funde la bateria para un adorno.
      dpr={[1, 1.8]}
      shadows
      camera={{ position: [0, 1.2, 5.5], fov: 38 }}
      // Sin transparencia: el fondo lo pone el CSS y asi se ahorra una capa.
      gl={{ antialias: true, alpha: true }}
      style={{ width: '100%', height: '100%' }}
    >
      <Entorno />

      {/* Ambiente bajo: sin el, las sombras quedan negras y se ve de juguete.
          Mas bajo que antes, porque ahora el entorno aporta su propia luz. */}
      <ambientLight intensity={0.3} color="#f6ecdf" />

      <directionalLight
        position={[-3.5, 5, 3]}
        intensity={2.1}
        color={luzClave}
        castShadow
        shadow-mapSize={[1024, 1024]}
        // Sesgo negativo pequeno: corrige el rayado de la sombra propia sin
        // despegarla del objeto.
        shadow-bias={-0.0004}
      />

      {/* Relleno frio y debil por el otro lado: separa los objetos del fondo
          sin aplanar el contraste de la luz principal. */}
      <directionalLight position={[4, 1.5, -2]} intensity={0.35} color="#dfeaf2" />

      <Conjunto animar={animar} />

      {/*
       * Suelo que SOLO recibe sombra.
       *
       * `shadowMaterial` no se pinta a si mismo, asi que da el contacto con el
       * suelo —lo que de verdad hace que algo parezca apoyado y no flotando—
       * sin meter un plano gris en la composicion.
       */}
      <mesh position={[0, -1.9, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[14, 14]} />
        <shadowMaterial transparent opacity={0.18} color="#2e2a25" />
      </mesh>
    </Canvas>
  );
}
