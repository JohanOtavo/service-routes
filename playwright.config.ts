import 'dotenv/config';

import { defineConfig, devices } from '@playwright/test';

/**
 * Configuracion de las pruebas de extremo a extremo.
 *
 * Estas pruebas no son unitarias disfrazadas: mueven un navegador de verdad
 * contra el cliente web y, por detras, contra el gateway y los ocho servicios.
 * Lo que comprueban es el recorrido que describe el SRS -publicar una
 * necesidad, recibir propuestas, adjudicar una y cancelar la contratacion- y ese
 * recorrido atraviesa gateway, request-service, catalog-service, replicas y
 * outbox. Ninguna prueba de integracion existente cubre el camino entero con la
 * interfaz de por medio, y los fallos mas caros de este producto (un formulario
 * que no envia, una pantalla que no refleja el estado, un 403 que el usuario no
 * puede explicar) solo aparecen cuando se junta todo.
 *
 * Decisiones que conviene no deshacer sin pensarlo:
 *
 * - El cliente web lo levanta Playwright (`webServer`) en lugar de asumir que ya
 *   esta en marcha. Es un servidor de desarrollo y tarda unos segundos; que lo
 *   inicie el propio runner hace que `npm run test:e2e` funcione con un solo
 *   comando y que CI no dependa de un servicio que alguien dejo olvidado.
 * - El gateway NO lo levanta Playwright: son ocho contenedores de Docker que
 *  olvedran dias, y arrancarlos desde aqui taparia los fallos de arranque de las
 *   migraciones y del relevo de eventos, que son justo los que el recorrido
 *   necesita. Se levanta antes con `docker compose --profile apps up -d` y el
 *   CI lo hace igual. Si el gateway no responde, la prueba debe fallar con un
 *   mensaje claro, no con un error de red.
 * - Un solo worker. Las pruebas comparten el estado real de una base de datos
 *   con las mismas cuentas sembradas, asi que ejecutarlas en paralelo produce
 *   interferencias que no son fallos del producto. El paralelismo se gana dentro
 *   del recorrido, no entre recorridos.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // El E2E depende del estado sembrado y del gateway; sin reintentos, un arranque
  // lento se lee como un producto roto.
  retries: process.env['CI'] === undefined ? 0 : 1,
  forbidOnly: process.env['CI'] !== undefined,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },

  reporter:
    process.env['CI'] === undefined ? [['list']] : [['github'], ['html', { open: 'never' }]],

  use: {
    // `localhost` y no `127.0.0.1`: Vite enlaza el puerto que le pides tal cual y
    // en Windows resuelve `localhost` a `::1`, de modo que un servidor ya
    // arrancado en IPv6 no responde en IPv4 y Playwright no lo reutiliza.
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: 'npm run dev --workspace apps/web -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: process.env['CI'] === undefined,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
