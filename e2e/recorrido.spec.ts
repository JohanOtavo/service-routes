/**
 * El recorrido critico del negocio, de extremo a extremo (C-3).
 *
 *   docker compose --profile apps up -d
 *   npm run e2e
 *
 * Publicar una necesidad, recibir una propuesta, adjudicarla, ver el contacto y
 * cancelar. Es el recorrido que `11-quality/testing-strategy.md` §E2E pide para
 * el Go/No-Go, y el que estaba cubierto solo por partes: cada servicio probaba
 * su trozo contra su propio esquema y ninguna prueba cruzaba el gateway.
 *
 * Cruza DOS roles: publicar y adjudicar exigen SOLICITANTE, proponer exige
 * OFERENTE. Se usan dos contextos de navegador y no uno, porque el token de
 * sesion vive en memoria del modulo y compartir pestana mezclaria las sesiones.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  USUARIOS,
  asegurarContrasenaSembrada,
  contrasenaSembrada,
  esperarPrestadorReplicado,
  limpiarNecesidadesDePrueba,
  prepararPrestadorActivo,
} from './apoyo';

/** Teléfono del PERFIL de prestador. Es el que B-1 debe revelar. */
const TELEFONO_PERFIL = '3005557788';
/** Marca para distinguir lo que publica esta prueba de los datos sembrados. */
const MARCA = 'E2E-RECORRIDO';

async function entrar(page: Page, correo: string): Promise<void> {
  await page.goto('/entrar');
  await page.getByLabel('Correo', { exact: false }).fill(correo);
  // Anclado: el nombre accesible lleva " (obligatorio)", y hay que distinguirlo
  // de "Repita la contrasena" en otras pantallas.
  await page.getByLabel(/^Contrasena/u).fill(contrasenaSembrada());
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('button', { name: 'Salir' })).toBeVisible();
}

test.describe('recorrido critico', () => {
  test.beforeAll(async () => {
    // Establece la precondicion en lugar de suponerla: la suite de integracion
    // puede haber dejado otra contrasena en las cuentas sembradas.
    asegurarContrasenaSembrada();
    limpiarNecesidadesDePrueba(MARCA);
  });

  test('publica, recibe propuesta, adjudica, ve el contacto y cancela', async ({ browser }) => {
    const titulo = `${MARCA} fuga en la cocina ${Date.now()}`;

    const comoSolicitante = await browser.newContext();
    const comoOferente = await browser.newContext();
    const solicitante = await comoSolicitante.newPage();
    const oferente = await comoOferente.newPage();

    try {
      // ── 1. El solicitante publica una necesidad ──────────────────────────
      await entrar(solicitante, USUARIOS.solicitante);
      await solicitante.goto('/mis-necesidades');
      await expect(solicitante.getByRole('heading', { name: 'Mis necesidades' })).toBeVisible();

      await solicitante.getByRole('button', { name: 'Publicar una necesidad' }).first().click();
      await solicitante.getByLabel('En una linea, que necesita', { exact: false }).fill(titulo);
      await solicitante
        .getByLabel('Cuentelo con detalle', { exact: false })
        .fill(
          'Hay una fuga bajo el lavaplatos y el agua moja el mueble. Necesito que la revisen y la arreglen.'
        );
      await solicitante.getByLabel('Oficio', { exact: false }).selectOption({ label: 'Plomeria' });
      await solicitante.getByRole('button', { name: 'Publicar' }).click();

      await expect(solicitante.getByRole('heading', { name: titulo })).toBeVisible();

      // ── 2. El oferente la encuentra y propone ────────────────────────────
      await entrar(oferente, USUARIOS.oferente);

      /**
       * El perfil de prestador se prepara AQUI, no en el `beforeAll`.
       *
       * Se siembra en `pa_provider` y se propaga con `db:reemit` en lugar de
       * conducir las pantallas de administracion: validar un perfil es otro
       * recorrido, con otro rol, y meterlo aqui probaria dos cosas a la vez.
       *
       * Por que despues de iniciar sesion y no antes: el perfil se ata al
       * `id_usuario` que se lee de `pa_auth` por correo, y el seed puede volver
       * a crear las cuentas con identificadores nuevos. Hacerlo en el
       * `beforeAll` dejaba una ventana en la que el perfil quedaba atado a un
       * identificador viejo mientras el token llevaba el nuevo: el perfil
       * existia, el oferente no lo tenia, y la propuesta moria con un 409
       * "Necesita un perfil de prestador" que no explicaba nada.
       */
      const idOferente = prepararPrestadorActivo(USUARIOS.oferente, TELEFONO_PERFIL);
      await esperarPrestadorReplicado(idOferente);

      await oferente.goto('/necesidades');
      await expect(oferente.getByRole('heading', { name: 'Necesidades abiertas' })).toBeVisible();

      await oferente
        .getByRole('link', { name: new RegExp(MARCA, 'u') })
        .first()
        .click();
      await expect(oferente.getByRole('heading', { name: 'Enviar una propuesta' })).toBeVisible();

      await oferente.getByLabel('Su precio', { exact: false }).fill('180000');
      await oferente.getByLabel('En cuantos dias', { exact: false }).fill('2');
      await oferente
        .getByLabel('Como lo haria', { exact: false })
        .fill('Reviso el sifon y el empaque, y cambio lo que este dañado. Llevo repuestos.');
      await oferente.getByRole('button', { name: 'Enviar propuesta' }).click();

      // Enviarla lleva a "Mis propuestas".
      await expect(oferente.getByRole('heading', { name: 'Mis propuestas' })).toBeVisible();

      // ── 3. El solicitante la adjudica ────────────────────────────────────
      await solicitante.reload();
      await solicitante.getByRole('button', { name: 'Ver propuestas' }).first().click();

      await solicitante.getByRole('button', { name: 'Elegir esta propuesta' }).first().click();
      /**
       * La confirmacion no es un adorno: adjudicar descarta las demas
       * propuestas y crea la contratacion, y no se puede deshacer. La pantalla
       * lo dice antes de dejar seguir.
       */
      await expect(solicitante.getByText('Esto cierra la necesidad')).toBeVisible();
      await solicitante.getByRole('button', { name: 'Si, elegir esta' }).click();

      // ── 4. El contacto aparece, con el telefono del PERFIL (B-1) ─────────
      await solicitante.goto('/contrataciones');
      await expect(solicitante.getByRole('heading', { name: 'Mis contrataciones' })).toBeVisible();
      await solicitante
        .getByRole('link', { name: /fuga bajo el lavaplatos/u })
        .first()
        .click();

      await expect(solicitante.getByRole('heading', { name: 'Como contactar' })).toBeVisible();
      /**
       * El telefono del perfil de prestador, no el de la cuenta.
       *
       * Es la decision B-1 comprobada de punta a punta: el dato sale de
       * `pa_provider.prestador.telefono`, viaja en el evento, llega a la
       * replica de `pa_request` y se revela solo tras el acuerdo.
       */
      await expect(solicitante.getByRole('link', { name: TELEFONO_PERFIL })).toBeVisible();

      // ── 5. Y se puede cancelar ───────────────────────────────────────────
      await solicitante.getByRole('button', { name: 'Cancelar la contratacion' }).click();
      await expect(solicitante.getByText('Cancelar tiene efecto en su reputacion')).toBeVisible();

      // Sin motivo elegido, confirmar esta deshabilitado: la tasa de
      // cancelacion depende del motivo, asi que no hay un valor por omision.
      const confirmar = solicitante.getByRole('button', { name: 'Confirmar la cancelacion' });
      await expect(confirmar).toBeDisabled();

      const motivos = solicitante.getByLabel('Por que cancela', { exact: false });
      // El primer valor no vacio: los motivos los sirve el API y fijar uno
      // concreto ataria la prueba al catalogo de motivos.
      const valores = await motivos
        .locator('option')
        .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter((v) => v !== ''));
      expect(valores.length).toBeGreaterThan(0);
      await motivos.selectOption(valores[0] as string);

      // Algunos motivos exigen explicacion; se rellena si aparece.
      const detalle = solicitante.getByLabel('Explique que paso', { exact: false });
      if ((await detalle.count()) > 0) {
        await detalle.fill('La fuga la resolvio el administrador del edificio antes de la visita.');
      }

      await expect(confirmar).toBeEnabled();
      await confirmar.click();

      /**
       * Se comprueba el ESTADO, no el mensaje de exito del formulario.
       *
       * `Contratacion.tsx` monta `<Cancelar>` solo mientras el estado es
       * PENDIENTE o ACEPTADA, asi que al pasar a CANCELADA el formulario
       * —y con el su mensaje— se desmontan antes de que nadie los lea. El
       * resultado observable es el sello de estado y que ya no se ofrezca
       * cancelar.
       *
       * Ese mensaje explicaba si la cancelacion cuenta en la tasa y con que
       * peso, y hoy no llega a verse. Queda anotado en el backlog; arreglarlo
       * es trabajo de interfaz, no de esta prueba.
       */
      await expect(solicitante.getByText('cancelada', { exact: false }).first()).toBeVisible();
      await expect(
        solicitante.getByRole('button', { name: 'Cancelar la contratacion' })
      ).toHaveCount(0);
    } finally {
      await comoSolicitante.close();
      await comoOferente.close();
      limpiarNecesidadesDePrueba(MARCA);
    }
  });
});
