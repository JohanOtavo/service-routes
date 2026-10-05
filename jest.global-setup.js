/**
 * Prepara el entorno de las pruebas de integracion antes de que empiece ninguna.
 *
 * Sin esto, `npm run test:integration` dependedia de que alguien hubiera
 * exportado las variables a mano, y el fallo se disfrazaba de exito: cuando la
 * base no esta disponible, la suite hace `if (saltar()) return;` y Jest cuenta
 * esa prueba como aprobada. Ciento treinta y tres pruebas pueden no haber hecho
 * nada y el gate seguir en verde. Este archivo evita las dos cosas.
 *
 * Tres decisiones, en orden:
 *
 * 1. Se carga `.env` SIN sobreescribir lo que ya este definido, porque en CI
 *    todas las variables llegan del workflow y mandan sobre el fichero.
 *
 * 2. Los nombres de servicio de Docker Compose (`mysql`, `redis`, `rabbitmq`)
 *    solo resuelven dentro de la red de Compose. Este proceso corre en el host,
 *    donde no resuelven, asi que se traducen a loopback. Es lo mismo que hace
 *    `.github/workflows/ci.yml` a mano; aqui es automatico y funciona igual en
 *    Windows, macOS y Linux.
 *
 * 3. `REQUIRE_INTEGRATION=1` por defecto. El flag ya existia en las ocho suites
 *    y lo que hacia era convertir el salto silencioso en un fallo, pero habia
 *    que activarlo a mano. Ahora es lo normal y el silencio es lo que hay que
 *    pedir explicitamente.
 */
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const raiz = __dirname;

// Los nombres exactos de los servicios de infraestructura en docker-compose.yml.
// Si alguien los renombra, hay que actualizar esta lista.
const SERVICIOS_COMPOSE = ['mysql', 'redis', 'rabbitmq'];
const VARIABLES_HOST = ['MYSQL_HOST', 'REDIS_HOST', 'RABBITMQ_HOST'];

function cargarEnv() {
  const fichero = path.join(raiz, '.env');
  if (!fs.existsSync(fichero)) return false;
  // override:false es lo que hace que el workflow de CI gane.
  dotenv.config({ path: fichero, override: false });
  return true;
}

function traducirHosts() {
  const traducidos = [];
  for (const variable of VARIABLES_HOST) {
    const valor = process.env[variable];
    if (valor !== undefined && SERVICIOS_COMPOSE.includes(valor)) {
      process.env[variable] = '127.0.0.1';
      traducidos.push(`${variable}: ${valor} -> 127.0.0.1`);
    }
  }
  return traducidos;
}

module.exports = async function prepararEntorno() {
  const hayEnv = cargarEnv();
  const traducidos = traducirHosts();

  // Integracion exigida salvo que se pida lo contrario de forma explicita.
  if (process.env.SKIP_INTEGRATION !== '1' && process.env.REQUIRE_INTEGRATION === undefined) {
    process.env.REQUIRE_INTEGRATION = '1';
  }

  const detalle = [];
  if (!hayEnv) detalle.push('sin .env');
  if (traducidos.length > 0) detalle.push(traducidos.join(', '));
  detalle.push(`REQUIRE_INTEGRATION=${process.env.REQUIRE_INTEGRATION ?? '(sin definir)'}`);

  // A proposito en stderr y no en silencio: si las pruebas se van a omitir, que
  // se lea en la consola y no haya que abiertas el primer fallo para saberlo.
  console.warn(`[integracion] ${detalle.join(' · ')}`);
};
