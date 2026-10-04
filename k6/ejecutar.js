/**
 * Lanza la prueba de carga dentro de la red de Docker.
 *
 * k6 corre en un contenedor y no en el anfitrion por dos razones: no hace falta
 * instalarlo, y desde dentro de la red llega al gateway por su nombre, con lo
 * que la medicion no incluye el salto por el puerto publicado de Docker
 * Desktop, que en Windows anade decenas de milisegundos y falsearia el P95.
 */
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const RED = process.env.CARGA_RED || 'punto-amigo_punto-amigo';
const clave = process.env.SEED_DEV_PASSWORD;

if (clave === undefined || clave === '') {
  console.error('Falta SEED_DEV_PASSWORD en el .env.');
  process.exit(1);
}

const r = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '-i',
    '--network',
    RED,
    '-e',
    `SEED_DEV_PASSWORD=${clave}`,
    '-e',
    `BASE_URL=${process.env.CARGA_BASE_URL || 'http://api-gateway:8080'}`,
    'grafana/k6:0.57.0',
    'run',
    '-',
  ],
  {
    input: require('node:fs').readFileSync(path.join(__dirname, 'carga.js')),
    stdio: ['pipe', 'inherit', 'inherit'],
  }
);

process.exit(r.status === null ? 1 : r.status);
