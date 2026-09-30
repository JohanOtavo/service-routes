/**
 * Configuracion de Knex: una conexion por microservicio, cada una apuntando a
 * su propio esquema con sus propias credenciales.
 *
 * No hay una conexion "compartida" a proposito: si un servicio pudiera abrir el
 * esquema de otro, la propiedad de datos que define el SRS (§3.4) dejaria de
 * estar garantizada por la infraestructura y pasaria a depender de la disciplina
 * de quien escribe el codigo.
 */
'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const HOST = process.env.MYSQL_HOST || '127.0.0.1';
const PORT = Number(process.env.MYSQL_PORT || 3306);

/** Servicios que poseen un esquema. El api-gateway no aparece: solo usa Redis. */
const SERVICES = [
  { key: 'auth', schema: 'pa_auth', userVar: 'DB_AUTH_USER', passVar: 'DB_AUTH_PASSWORD' },
  { key: 'provider', schema: 'pa_provider', userVar: 'DB_PROVIDER_USER', passVar: 'DB_PROVIDER_PASSWORD' },
  { key: 'catalog', schema: 'pa_catalog', userVar: 'DB_CATALOG_USER', passVar: 'DB_CATALOG_PASSWORD' },
  { key: 'request', schema: 'pa_request', userVar: 'DB_REQUEST_USER', passVar: 'DB_REQUEST_PASSWORD' },
  { key: 'rating', schema: 'pa_rating', userVar: 'DB_RATING_USER', passVar: 'DB_RATING_PASSWORD' },
  { key: 'notification', schema: 'pa_notification', userVar: 'DB_NOTIFICATION_USER', passVar: 'DB_NOTIFICATION_PASSWORD' },
  { key: 'admin', schema: 'pa_admin', userVar: 'DB_ADMIN_USER', passVar: 'DB_ADMIN_PASSWORD' },
];

function configFor(service) {
  const user = process.env[service.userVar] || `${service.schema}_svc`;
  const password = process.env[service.passVar];

  if (!password) {
    throw new Error(
      `Falta ${service.passVar} en el entorno. Copia .env.example a .env antes de migrar.`
    );
  }

  return {
    client: 'mysql2',
    connection: {
      host: HOST,
      port: PORT,
      user,
      password,
      database: service.schema,
      timezone: 'Z',
      charset: 'utf8mb4',
      // Devuelve DECIMAL como string para no perder precision en dinero.
      decimalNumbers: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
    },
    pool: { min: 0, max: 10 },
    migrations: {
      directory: path.join(__dirname, 'migrations', service.key),
      tableName: 'knex_migrations',
      disableTransactions: false,
    },
    seeds: {
      directory: path.join(__dirname, 'seeds', service.key),
    },
  };
}

const configs = {};
for (const service of SERVICES) {
  // La configuracion se construye de forma perezosa: pedir un servicio no debe
  // fallar porque falte la contrasena de otro.
  Object.defineProperty(configs, service.key, {
    enumerable: true,
    get: () => configFor(service),
  });
}

module.exports = configs;
module.exports.SERVICES = SERVICES;
