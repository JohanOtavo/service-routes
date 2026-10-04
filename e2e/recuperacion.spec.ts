/**
 * Recuperacion de contrasena, de extremo a extremo en un navegador (C-1, C-3).
 *
 *   docker compose --profile apps up -d
 *   npm run e2e
 *
 * Es el criterio de cierre de C-1: "pedir recuperacion, llegar el correo, abrir
 * el enlace, restablecer, entrar con la contrasena nueva". Las piezas estaban
 * probadas por separado y el recorrido completo nunca se habia ejecutado; de
 * hecho, hasta esta fase el enlace no llegaba a ningun sitio porque nadie
 * consumia el evento que lleva el token.
 *
 * La prueba CAMBIA la contrasena de una cuenta sembrada y la deja cambiada
 * dentro de la misma prueba: el ultimo paso vuelve a dejarla como estaba, para
 * que una segunda ejecucion encuentre el mismo punto de partida. Es la misma
 * disciplina que la suite de integracion tuvo que aprender.
 */
import { spawnSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import {
  USUARIOS,
  asegurarContrasenaSembrada,
  enlaceActualONada,
  esperarEnlaceNuevo,
  rutaDelEnlace,
} from './apoyo';

const NUEVA = 'ContrasenaRecuperadaE2E2026';

test.describe('recuperacion de contrasena', () => {
  /**
   * Falla pronto y con un motivo claro si falta la contrasena sembrada.
   *
   * Sin ella el paso de restauracion revienta a mitad del recorrido, y el
   * mensaje habla de un seed en lugar de decir que falta una variable.
   */
  test.beforeAll(() => {
    asegurarContrasenaSembrada();
  });

  test('pide el enlace, lo abre, cambia la contrasena y entra con la nueva', async ({ page }) => {
    const anterior = enlaceActualONada();

    // ── Pedir la recuperacion ────────────────────────────────────────────
    await page.goto('/recuperar');
    await expect(page.getByRole('heading', { name: 'Recuperar contrasena' })).toBeVisible();

    // `exact: false` porque el nombre accesible de un campo obligatorio lleva
    // " (obligatorio)" para los lectores de pantalla.
    await page.getByLabel('Correo', { exact: false }).fill(USUARIOS.solicitante);
    await page.getByRole('button', { name: 'Enviar enlace' }).click();

    /**
     * La respuesta no dice si la cuenta existe, y eso es lo correcto.
     *
     * El endpoint devuelve 202 siempre para no ser un verificador de correos
     * registrados. La pantalla refleja esa misma prudencia.
     */
    await expect(page.getByText('Revise su correo')).toBeVisible();

    // ── Abrir el enlace del correo ───────────────────────────────────────
    const enlace = await esperarEnlaceNuevo(anterior);
    await page.goto(rutaDelEnlace(enlace));

    await expect(page.getByRole('heading', { name: 'Restablecer contrasena' })).toBeVisible();
    // Si el token no hubiera llegado bien, la pantalla no mostraria formulario.
    await expect(page.getByLabel('Contrasena nueva', { exact: false })).toBeVisible();

    // ── Restablecer ──────────────────────────────────────────────────────
    await page.getByLabel('Contrasena nueva', { exact: false }).fill(NUEVA);
    await page.getByLabel('Repita la contrasena', { exact: false }).fill(NUEVA);
    await page.getByRole('button', { name: 'Cambiar contrasena' }).click();

    await expect(page.getByText('Contrasena cambiada')).toBeVisible();

    // ── Entrar con la nueva ──────────────────────────────────────────────
    await page.goto('/entrar');
    await page.getByLabel('Correo', { exact: false }).fill(USUARIOS.solicitante);
    /**
     * Anclado al principio, no exacto.
     *
     * El nombre accesible de un campo obligatorio es "Contrasena (obligatorio)"
     * —el sufijo lo pinta `ui/index.tsx` para los lectores de pantalla—, asi que
     * `exact: true` no encuentra nada. El ancla `^` lo distingue de "Repita la
     * contrasena" sin depender del sufijo.
     */
    await page.getByLabel(/^Contrasena/u).fill(NUEVA);
    await page.getByRole('button', { name: 'Entrar' }).click();

    // Entrar lleva al inicio y la cabecera deja de ofrecer "Entrar".
    await expect(page.getByRole('button', { name: 'Salir' })).toBeVisible();

    // ── Devolver la cuenta a su estado de partida ────────────────────────
    devolverContrasenaSembrada();
  });

  test('un enlace sin token no ofrece formulario', async ({ page }) => {
    await page.goto('/restablecer');

    await expect(page.getByText('El enlace no sirve')).toBeVisible();
    await expect(page.getByLabel('Contrasena nueva', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Pedir un enlace nuevo' })).toBeVisible();
  });

  test('un token que ya se uso no sirve una segunda vez', async ({ page }) => {
    const anterior = enlaceActualONada();

    await page.goto('/recuperar');
    await page.getByLabel('Correo', { exact: false }).fill(USUARIOS.ambos);
    await page.getByRole('button', { name: 'Enviar enlace' }).click();
    await expect(page.getByText('Revise su correo')).toBeVisible();

    const enlace = await esperarEnlaceNuevo(anterior);
    const ruta = rutaDelEnlace(enlace);

    // Primer uso: funciona.
    await page.goto(ruta);
    await page.getByLabel('Contrasena nueva', { exact: false }).fill(NUEVA);
    await page.getByLabel('Repita la contrasena', { exact: false }).fill(NUEVA);
    await page.getByRole('button', { name: 'Cambiar contrasena' }).click();
    await expect(page.getByText('Contrasena cambiada')).toBeVisible();

    /**
     * Segundo uso del MISMO enlace: el servidor lo rechaza.
     *
     * Es la garantia que hace util un token de un solo uso. Si alguien lee el
     * correo despues, el enlace ya no vale.
     */
    await page.goto(ruta);
    await page.getByLabel('Contrasena nueva', { exact: false }).fill(NUEVA);
    await page.getByLabel('Repita la contrasena', { exact: false }).fill(NUEVA);
    await page.getByRole('button', { name: 'Cambiar contrasena' }).click();

    await expect(page.getByText('El enlace no sirve')).toBeVisible();

    devolverContrasenaSembrada();
  });
});

/**
 * Deja las cuentas con la contrasena sembrada otra vez.
 *
 * Por la semilla y NO por la interfaz, aunque hacerlo por la interfaz pareciera
 * mas fiel. Restaurar por pantalla cuesta una recuperacion mas por prueba, y el
 * limite de `/auth/password-recovery` es de 10 peticiones por minuto: la
 * primera version de este archivo se chocaba con su propio 429 y el recorrido
 * fallaba por un motivo que no era del producto.
 *
 * El seed refresca el hash de las cuatro cuentas por su correo, que es
 * exactamente lo que hace idempotente a la siembra desde A-1.
 */
function devolverContrasenaSembrada(): void {
  /**
   * Orden completa en una cadena, sin array de argumentos.
   *
   * `npm` en Windows necesita `shell: true`, y combinarlo con un array hace que
   * Node avise (DEP0190): los argumentos se concatenan sin escapar. Aqui no hay
   * nada que venga de fuera, pero una orden fija en una cadena no tiene ese
   * problema y no deja un aviso en cada ejecucion.
   */
  const r = spawnSync('npm run db:seed', {
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, NODE_ENV: 'development', MYSQL_HOST: '127.0.0.1' },
  });

  if (r.status !== 0) {
    throw new Error(
      `No se pudo devolver la contrasena sembrada: ${(r.stdout ?? '') + (r.stderr ?? '')}`.slice(
        0,
        400
      )
    );
  }
}
