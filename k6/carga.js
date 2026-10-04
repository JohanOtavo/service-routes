/**
 * Prueba de carga del recorrido de lectura (deuda AT-007).
 *
 * El umbral no se elige aqui: lo fija `11-quality/testing-strategy.md`, que pide
 * P95 < 300 ms y una tasa de error por debajo del 1 %. Estan declarados como
 * `thresholds`, asi que k6 devuelve codigo distinto de cero cuando no se
 * cumplen: la prueba falla sola, sin que nadie tenga que leer un informe.
 *
 * Se mide contra el GATEWAY y no contra un servicio: es el unico punto que
 * incluye el salto a los servicios, la verificacion del token y el
 * cortacircuitos, que es lo que de verdad espera un cliente.
 *
 * Como se ejecuta:
 *   npm run carga
 *
 * El paso de escritura se queda fuera a proposito. Publicar necesidades en
 * bucle llena la base y deja el entorno distinto al que empezo; medir la
 * latencia de escritura con carga sostenida merece su propio escenario y su
 * propia base desechable.
 */
import http from 'k6/http';
import { check, fail } from 'k6';

const BASE = __ENV.BASE_URL || 'http://api-gateway:8080';
const CORREO = __ENV.CARGA_CORREO || 'solicitante@puntoamigo.local';
const CONTRASENA = __ENV.SEED_DEV_PASSWORD;

export const options = {
  scenarios: {
    lectura: {
      /**
       * Llegadas por segundo, no usuarios virtuales.
       *
       * Con `ramping-vus` cada VU lanza la siguiente peticion en cuanto recibe
       * la anterior: diez VU produjeron 2.531 peticiones por segundo, que no es
       * una carga realista sino un martillo. Un ritmo fijo describe algo que se
       * puede comparar entre ejecuciones y contra un objetivo.
       *
       * 30 iteraciones/s x 3 peticiones = ~90 peticiones/s.
       */
      executor: 'constant-arrival-rate',
      rate: 30,
      timeUnit: '1s',
      duration: '60s',
      preAllocatedVUs: 20,
      // Si hiciera falta subir de aqui para mantener el ritmo, es que el
      // sistema no da la tasa pedida: k6 lo avisa en la salida.
      maxVUs: 60,
    },
  },
  thresholds: {
    // El umbral de la estrategia de pruebas, tal cual.
    http_req_duration: ['p(95)<300'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  if (!CONTRASENA) {
    fail('Falta SEED_DEV_PASSWORD. Es la contrasena de las cuentas sembradas.');
  }

  const r = http.post(
    `${BASE}/api/v1/auth/login`,
    JSON.stringify({ correo: CORREO, contrasena: CONTRASENA }),
    { headers: { 'content-type': 'application/json' } }
  );

  if (r.status !== 200) {
    fail(`El inicio de sesion fallo con ${r.status}: ${String(r.body).slice(0, 200)}`);
  }

  // Un solo token para todos los VU: la prueba mide las rutas de lectura, no
  // cuanto aguanta el inicio de sesion, que ademas tiene su propio limitador
  // mas estricto (SRS RNF31) y lo agotaria en segundos.
  return { token: r.json('accessToken') };
}

export default function (datos) {
  const conToken = {
    headers: { authorization: `Bearer ${datos.token}` },
    tags: { name: 'autenticada' },
  };

  check(http.get(`${BASE}/api/v1/categories`, { tags: { name: 'categorias' } }), {
    'categorias 200': (r) => r.status === 200,
  });

  check(http.get(`${BASE}/api/v1/services`, { tags: { name: 'servicios' } }), {
    'servicios 200': (r) => r.status === 200,
  });

  check(http.get(`${BASE}/api/v1/needs/mine`, conToken), {
    'mis necesidades 200': (r) => r.status === 200,
  });
}
