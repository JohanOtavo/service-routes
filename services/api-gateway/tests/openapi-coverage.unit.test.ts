import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type { Express } from 'express';

/**
 * La documentacion OpenAPI se comprueba contra las rutas que el codigo registra
 * de verdad.
 *
 * Un contrato escrito a mano envejece el dia que alguien anade un endpoint y no
 * se acuerda de documentarlo, y nadie se entera hasta que un cliente llama a
 * algo que el documento no menciona —o peor, implementa algo que el documento
 * promete y no existe—. Esta prueba lee el router de Express de cada servicio y
 * exige que las dos listas coincidan EXACTAMENTE, en los dos sentidos.
 *
 * Vive con el gateway porque el gateway es la cara publica del sistema: si algo
 * no esta documentado, es su contrato el que miente.
 */

const RAIZ = join(__dirname, '..', '..', '..');

/** Entorno minimo: `buildContainer` no abre conexiones, solo arma el pool. */
const BASE = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  CORS_ORIGIN: 'http://localhost:5173',
  MYSQL_HOST: '127.0.0.1',
  MYSQL_PORT: '3306',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6379',
  INTERNAL_SERVICE_SECRET: 'secreto-solo-para-esta-prueba',
  RABBITMQ_HOST: '127.0.0.1',
  RABBITMQ_PORT: '5672',
  RABBITMQ_USER: 'u',
  RABBITMQ_PASSWORD: 'p',
};

interface Servicio {
  nombre: string;
  modulo: string;
  spec: string;
  env: Record<string, string>;
}

const SERVICIOS: Servicio[] = [
  {
    nombre: 'auth-service',
    modulo: '../../auth-service/src/main',
    spec: 'auth-service.yaml',
    env: { DB_AUTH_USER: 'u', DB_AUTH_PASSWORD: 'p', JWT_PRIVATE_KEY: 'k', JWT_PUBLIC_KEY: 'k' },
  },
  {
    nombre: 'provider-service',
    modulo: '../../provider-service/src/main',
    spec: 'provider-service.yaml',
    env: { DB_PROVIDER_USER: 'u', DB_PROVIDER_PASSWORD: 'p' },
  },
  {
    nombre: 'catalog-service',
    modulo: '../../catalog-service/src/main',
    spec: 'catalog-service.yaml',
    env: { DB_CATALOG_USER: 'u', DB_CATALOG_PASSWORD: 'p' },
  },
  {
    nombre: 'request-service',
    modulo: '../../request-service/src/main',
    spec: 'request-service.yaml',
    env: { DB_REQUEST_USER: 'u', DB_REQUEST_PASSWORD: 'p' },
  },
  {
    nombre: 'rating-service',
    modulo: '../../rating-service/src/main',
    spec: 'rating-service.yaml',
    env: { DB_RATING_USER: 'u', DB_RATING_PASSWORD: 'p' },
  },
  {
    nombre: 'notification-service',
    modulo: '../../notification-service/src/main',
    spec: 'notification-service.yaml',
    env: { DB_NOTIFICATION_USER: 'u', DB_NOTIFICATION_PASSWORD: 'p' },
  },
  {
    nombre: 'admin-reporting-service',
    modulo: '../../admin-reporting-service/src/main',
    spec: 'admin-reporting-service.yaml',
    env: { DB_ADMIN_USER: 'u', DB_ADMIN_PASSWORD: 'p' },
  },
];

/** Rutas que el router de Express tiene registradas, como "METODO /ruta". */
function rutasDelCodigo(app: Express): string[] {
  const pila = (
    app as unknown as {
      _router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
    }
  )._router.stack;

  const salida: string[] = [];
  for (const capa of pila) {
    if (capa.route === undefined) continue;
    for (const metodo of Object.keys(capa.route.methods)) {
      if (metodo === '_all') continue;
      /**
       * `/health` y `/metrics` quedan fuera del contrato a proposito.
       *
       * El primero lo consulta el orquestador y el segundo Prometheus; ninguno
       * es un cliente del API, y ninguno de los dos se alcanza desde fuera de
       * la red interna. Documentarlos en el contrato publico anunciaria dos
       * rutas que ningun consumidor del API puede usar.
       */
      if (capa.route.path === '/health' || capa.route.path === '/metrics') continue;
      salida.push(`${metodo.toUpperCase()} ${capa.route.path}`);
    }
  }
  return [...new Set(salida)].sort();
}

/** Rutas que declara el documento OpenAPI, en el mismo formato. */
function rutasDelContrato(archivo: string): string[] {
  const doc = load(readFileSync(join(RAIZ, 'contracts', 'openapi', archivo), 'utf8')) as {
    paths: Record<string, Record<string, unknown>>;
  };

  const salida: string[] = [];
  for (const [ruta, operaciones] of Object.entries(doc.paths)) {
    for (const metodo of Object.keys(operaciones)) {
      if (metodo === 'parameters') continue;
      // OpenAPI escribe `{id}` donde Express escribe `:id`.
      salida.push(`${metodo.toUpperCase()} ${ruta.replace(/\{(\w+)\}/gu, ':$1')}`);
    }
  }
  return salida.sort();
}

describe.each(SERVICIOS)('contrato OpenAPI de $nombre', ({ modulo, spec, env }) => {
  // Requerido en dinamico porque el modulo es una de las variables de esta
  // tabla: no se puede importar de forma estatica sin nombrar los siete
  // servicios, y nombrar uno que no exista —porque su dist no se compilo— lo
  // convertiria en un fallo de este archivo en lugar de una omision.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const m = require(modulo) as {
    envSchema: { parse: (e: unknown) => never };
    buildContainer: (e: never) => { app: Express; knex: { destroy: () => Promise<void> } };
  };

  const contenedor = m.buildContainer(m.envSchema.parse({ ...BASE, ...env }));

  afterAll(async () => {
    await contenedor.knex.destroy();
  });

  it('documenta TODO lo que el codigo expone', () => {
    const codigo = rutasDelCodigo(contenedor.app);
    const contrato = rutasDelContrato(spec);

    const sinDocumentar = codigo.filter((r) => !contrato.includes(r));
    expect(sinDocumentar).toEqual([]);
  });

  /**
   * Y al reves. Un contrato que promete un endpoint que no existe es peor que
   * uno incompleto: quien lo lea escribira un cliente contra algo que siempre
   * va a devolver 404.
   */
  it('no promete nada que el codigo no tenga', () => {
    const codigo = rutasDelCodigo(contenedor.app);
    const contrato = rutasDelContrato(spec);

    const inventadas = contrato.filter((r) => !codigo.includes(r));
    expect(inventadas).toEqual([]);
  });
});
