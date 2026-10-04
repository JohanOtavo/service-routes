import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas de extremo a extremo (C-3).
 *
 * `11-quality/testing-strategy.md` §E2E las exige para el Go/No-Go de
 * produccion, y no existian: el recorrido critico —publicar necesidad, recibir
 * propuestas, adjudicar, cancelar— solo estaba cubierto por partes, cada parte
 * en su servicio y ninguna atravesando el gateway.
 *
 * NO forman parte de `npm run verify`, y es deliberado. `verify` tiene que poder
 * correr en cualquier maquina con Docker y una base de datos; esto necesita los
 * ocho servicios levantados, el gateway publicado y el cliente servido. Mezclar
 * las dos cosas haria que la puerta de cada commit dependiera de construir ocho
 * imagenes. Tiene su propio comando y su propio job de CI.
 */
const PUERTO_CLIENTE = Number(process.env['E2E_WEB_PORT'] ?? 5173);
/**
 * `localhost` y no `127.0.0.1`.
 *
 * Vite se ata a `localhost`, y en Windows ese nombre resuelve primero a `::1`.
 * Con `127.0.0.1` la comprobacion de arranque de Playwright no encontraba nada
 * y abortaba con "Timed out waiting 120000ms from config.webServer" aunque el
 * servidor llevaba 371 ms listo.
 */
const BASE = process.env['E2E_BASE_URL'] ?? `http://localhost:${PUERTO_CLIENTE}`;
const enCI = process.env['CI'] === 'true' || process.env['CI'] === '1';

export default defineConfig({
  testDir: './e2e',
  /**
   * En serie, no en paralelo.
   *
   * El recorrido comparte una base de datos con estado: dos pruebas publicando
   * necesidades y adjudicando a la vez se pisarian los contadores de reputacion
   * y la tasa de cancelacion, y el fallo apareceria una vez cada varias
   * ejecuciones. Es la misma leccion que ya dio la suite de integracion.
   */
  workers: 1,
  fullyParallel: false,

  /**
   * Un reintento en CI, ninguno en local.
   *
   * En CI un fallo puede ser un servicio que todavia no habia terminado de
   * arrancar. En local un reintento esconderia justo lo que se quiere ver.
   */
  retries: enCI ? 1 : 0,
  // Un recorrido completo atraviesa el gateway y cinco servicios; 60 s por
  // prueba es holgado sin dejar que una prueba colgada bloquee el job.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: enCI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL: BASE,
    // Rastro y captura SOLO del primer reintento fallido: guardar siempre
    // llena el almacen de artefactos de CI con recorridos que pasaron.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: enCI ? 'retain-on-failure' : 'off',
    // El cliente es una PWA; su service worker cachearia el caparazon entre
    // pruebas y una navegacion podria servirse de disco y no del servidor.
    serviceWorkers: 'block',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /**
   * El cliente lo levanta Playwright; los ocho servicios, NO.
   *
   * `vite dev` y no `vite preview` porque el proxy a `/api` esta declarado en
   * `server.proxy`, que `preview` no lee: con preview, cada llamada al API
   * daria 404 y las pruebas fallarian por una razon que no es del producto.
   *
   * La pila se levanta aparte con `docker compose --profile apps up -d`. Dejar
   * que Playwright la arrancara mezclaria el ciclo de vida de ocho contenedores
   * con el de una prueba, y un fallo de arranque se leeria como un fallo del
   * producto.
   */
  webServer: {
    command: `npm run dev --workspace apps/web -- --port ${PUERTO_CLIENTE} --strictPort`,
    url: BASE,
    reuseExistingServer: !enCI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
