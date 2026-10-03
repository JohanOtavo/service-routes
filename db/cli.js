#!/usr/bin/env node
/**
 * CLI de base de datos: aplica migraciones, revierte y carga seeds sobre los
 * siete esquemas, cada uno con sus propias credenciales.
 *
 *   node db/cli.js migrate            todos los esquemas
 *   node db/cli.js migrate auth       solo uno
 *   node db/cli.js rollback request   revierte el ultimo lote de uno
 *   node db/cli.js seed               seeds de desarrollo
 *   node db/cli.js status             que migraciones faltan
 *   node db/cli.js reset              revierte todo y vuelve a migrar (solo dev)
 *
 * Sustituye al SQL suelto: toda evolucion del esquema queda versionada en
 * db/migrations/<servicio>/ y es reversible.
 */
'use strict';

const knexLib = require('knex');
const configs = require('./knexfile');

const { SERVICES } = configs;
const ALL_KEYS = SERVICES.map((s) => s.key);

const COMMANDS = new Set(['migrate', 'rollback', 'seed', 'status', 'reset']);

async function withConnection(key, fn) {
  const db = knexLib(configs[key]);
  try {
    return await fn(db);
  } finally {
    await db.destroy();
  }
}

async function migrate(key) {
  return withConnection(key, async (db) => {
    const [batch, applied] = await db.migrate.latest();
    if (applied.length === 0) return `${key}: al dia`;
    return `${key}: lote ${batch}, ${applied.length} migracion(es)\n${applied
      .map((m) => `    + ${m}`)
      .join('\n')}`;
  });
}

async function rollback(key) {
  return withConnection(key, async (db) => {
    const [batch, reverted] = await db.migrate.rollback();
    if (reverted.length === 0) return `${key}: nada que revertir`;
    return `${key}: lote ${batch} revertido, ${reverted.length} migracion(es)`;
  });
}

/**
 * Entornos donde se permiten operaciones destructivas o con datos de prueba.
 *
 * Es una lista BLANCA a proposito. Comprobar `!== 'production'` deja pasar
 * staging, qa, demo y —lo mas peligroso— un NODE_ENV sin definir, que es
 * exactamente lo que ocurre en un servidor recien aprovisionado. Un seed que
 * corre ahi crea una cuenta de administrador con una contrasena conocida.
 */
const ENTORNOS_PERMITIDOS = new Set(['development', 'test']);

function exigirEntornoSeguro(operacion) {
  const entorno = process.env.NODE_ENV;
  if (!ENTORNOS_PERMITIDOS.has(entorno)) {
    throw new Error(
      `${operacion} solo se permite con NODE_ENV=development o test. ` +
        `Valor actual: ${entorno === undefined ? '(sin definir)' : entorno}.`
    );
  }
}

async function seed(key) {
  exigirEntornoSeguro('Cargar seeds');
  return withConnection(key, async (db) => {
    let files;
    try {
      [files] = await db.seed.run();
    } catch (error) {
      // Un servicio sin seeds no tiene directorio, y knex lanza ENOENT al
      // listarlo. Git no versiona directorios vacios, asi que en un clon
      // limpio `db/seeds/<servicio>` simplemente no existe para los cinco
      // servicios todavia sin seed, y esto solo se rompia fuera de la
      // maquina de quien los creo. Cualquier otro error se propaga.
      if (error && error.code === 'ENOENT') return `${key}: sin seeds`;
      throw error;
    }
    return files.length === 0 ? `${key}: sin seeds` : `${key}: ${files.length} seed(s)`;
  });
}

async function status(key) {
  return withConnection(key, async (db) => {
    const [completed, pending] = await db.migrate.list();
    return `${key}: ${completed.length} aplicadas, ${pending.length} pendientes`;
  });
}

async function reset(key) {
  exigirEntornoSeguro('Reconstruir el esquema (reset destruye datos)');
  return withConnection(key, async (db) => {
    await db.migrate.rollback(undefined, true); // revierte todos los lotes
    const [, applied] = await db.migrate.latest();
    return `${key}: reconstruido, ${applied.length} migracion(es)`;
  });
}

const HANDLERS = { migrate, rollback, seed, status, reset };

async function main() {
  const [command, only] = process.argv.slice(2);

  if (!COMMANDS.has(command)) {
    console.error(`Uso: node db/cli.js <${[...COMMANDS].join('|')}> [servicio]`);
    console.error(`Servicios: ${ALL_KEYS.join(', ')}`);
    process.exit(1);
  }

  if (only && !ALL_KEYS.includes(only)) {
    console.error(`Servicio desconocido: ${only}. Opciones: ${ALL_KEYS.join(', ')}`);
    process.exit(1);
  }

  // Orden fijo: auth primero porque el resto replica sus usuarios, y el
  // seed lo necesita poblado para tener identificadores coherentes.
  const targets = only ? [only] : ALL_KEYS;
  const handler = HANDLERS[command];
  let failed = false;

  for (const key of targets) {
    try {
      console.log(`  ${await handler(key)}`);
    } catch (error) {
      failed = true;
      console.error(`  ${key}: FALLO — ${error.message}`);
    }
  }

  if (failed) process.exit(1);
  console.log(`[db] ${command} completado`);
}

main().catch((error) => {
  console.error(`[db] error no controlado: ${error.message}`);
  process.exit(1);
});
