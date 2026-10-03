#!/usr/bin/env node
/**
 * Compila cada migracion al DDL de MySQL que generaria, SIN conectarse.
 *
 * Sirve para revisar el esquema resultante y para detectar errores de sintaxis
 * en un entorno donde no hay un MySQL levantado. No sustituye a aplicar las
 * migraciones de verdad: no valida claves foraneas ni CHECK contra datos.
 *
 *   node db/compile-sql.js            imprime el DDL de los 7 esquemas
 *   node db/compile-sql.js request    solo uno
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const knexLib = require('knex');

const SERVICES = ['auth', 'provider', 'catalog', 'request', 'rating', 'notification', 'admin'];

/**
 * Knex real como compilador, pero con la ejecucion interceptada: cada builder
 * se convierte en un thenable que devuelve su SQL en vez de abrir una conexion.
 */
function makeCollector() {
  const statements = [];
  const knex = knexLib({ client: 'mysql2', useNullAsDefault: true });

  const capture = (builder) => {
    // Un builder de datos (insert, update) no expone toSQL como el de esquema.
    // Aqui solo interesa el DDL, asi que lo que no sea esquema se descarta en
    // silencio en lugar de abortar la compilacion del servicio entero.
    if (typeof builder?.toSQL !== 'function') return Promise.resolve([]);
    const parts = builder.toSQL();
    for (const part of Array.isArray(parts) ? parts : [parts]) {
      if (part?.sql) statements.push(part.sql);
    }
    return Promise.resolve([]);
  };

  // knex.schema devuelve un builder nuevo cada vez; hay que envolver ese getter.
  const schemaProxy = () => {
    const builder = knex.schema;
    return new Proxy(builder, {
      get(target, prop) {
        if (prop === 'then') {
          return (resolve, reject) => capture(target).then(resolve, reject);
        }
        const value = target[prop];
        if (typeof value !== 'function') return value;
        return (...args) => {
          const result = value.apply(target, args);
          // Los metodos encadenables devuelven el builder: se reenvuelve.
          return result === target || (result && typeof result.toSQL === 'function')
            ? wrapBuilder(result)
            : result;
        };
      },
    });
  };

  const wrapBuilder = (builder) =>
    new Proxy(builder, {
      get(target, prop) {
        if (prop === 'then') {
          return (resolve, reject) => capture(target).then(resolve, reject);
        }
        const value = target[prop];
        if (typeof value !== 'function') return value;
        return (...args) => {
          const result = value.apply(target, args);
          return result && typeof result.toSQL === 'function' ? wrapBuilder(result) : result;
        };
      },
    });

  const fakeKnex = new Proxy(knex, {
    // Una migracion tambien puede insertar datos —un catalogo inicial, por
    // ejemplo— llamando a knex('tabla').insert(...). Aqui solo interesa el DDL,
    // asi que esas llamadas se capturan y se descartan en lugar de reventar.
    apply(target, _thisArg, argumentsList) {
      const builder = target(...argumentsList);
      return new Proxy(builder, {
        get(t, p) {
          if (p === 'then') {
            return (resolve, reject) => Promise.resolve([]).then(resolve, reject);
          }
          const v = t[p];
          if (typeof v !== 'function') return v;
          return (...a) => {
            const r = v.apply(t, a);
            return r && typeof r.toSQL === 'function' ? wrapBuilder(r) : r;
          };
        },
      });
    },
    get(target, prop) {
      if (prop === 'schema') return schemaProxy();
      if (prop === 'raw') {
        return (sql, bindings) => {
          const built = target.raw(sql, bindings);
          // `raw` se usa de dos formas y hay que distinguirlas:
          //   - como VALOR, dentro de defaultTo(): knex lee sus propiedades y
          //     debe recibir el objeto Raw intacto;
          //   - como SENTENCIA, al hacer await: ahi se captura el SQL.
          // Interceptar solo `then` permite ambas sin ejecutar nada.
          return new Proxy(built, {
            get(rawTarget, rawProp) {
              if (rawProp === 'then') {
                return (resolve, reject) => {
                  statements.push(rawTarget.toString());
                  return Promise.resolve([]).then(resolve, reject);
                };
              }
              const value = rawTarget[rawProp];
              return typeof value === 'function' ? value.bind(rawTarget) : value;
            },
          });
        };
      }
      return target[prop];
    },
  });

  return { fakeKnex, statements, destroy: () => knex.destroy() };
}

async function compileService(service) {
  const dir = path.join(__dirname, 'migrations', service);
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .sort();
  const { fakeKnex, statements, destroy } = makeCollector();

  for (const file of files) {
    // Requerido en dinamico a proposito: los archivos a compilar se descubren
    // leyendo el directorio, asi que no hay ningun modulo que se pueda
    // importar de forma estatica. Ademas no se ejecuta en produccion, y el
    // `require` dentro del bucle es lo que permite informar el nombre del
    // archivo que falla.
    const migration = require(path.join(dir, file));
    await migration.up(fakeKnex);
  }

  await destroy();
  return { service, files, statements };
}

async function main() {
  const only = process.argv[2];
  const targets = only ? [only] : SERVICES;
  let total = 0;
  let failed = false;

  for (const service of targets) {
    try {
      const { files, statements } = await compileService(service);
      total += statements.length;
      console.log(`\n${'='.repeat(78)}`);
      console.log(
        `-- esquema pa_${service}  (${files.length} migracion(es), ${statements.length} sentencias)`
      );
      console.log('='.repeat(78));
      for (const sql of statements) console.log(`${sql};`);
    } catch (error) {
      failed = true;
      console.error(`\n[${service}] FALLO AL COMPILAR: ${error.message}`);
      console.error(error.stack.split('\n').slice(1, 4).join('\n'));
    }
  }

  console.log(`\n-- total: ${total} sentencias DDL`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
