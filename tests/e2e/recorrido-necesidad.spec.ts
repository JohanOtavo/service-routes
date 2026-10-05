import { expect, test } from '@playwright/test';

import { CUENTAS, asegurarPrestadorValidad, iniciarSesion } from './ayudas';

/**
 * El recorrido critico del negocio, de punta a punta.
 *
 * Es el camino que justifies el producto: alguien que tiene un problema publica
 * lo que necesita, quien tiene el oficio le responde con un precio, el primero
 * elige y de ahi nace una contratacion que se puede cancelar. Todo ese camino
 * atraviesa el cliente web, el gateway y varios servicios con copias propias y
 * un outbox de por medio, y ninguna prueba de integracion existente lo recorre
 * con la interfaz de por medio.
 *
 * Son dos personas, no una: por eso el test abre dos contextos de navegador. La
 * oferta no puede hacerla el mismo que publica (el dominio lo rechaza), y
 * probar el recorrido con una sola sesion probaria un producto que no existe.
 *
 * Todo va en un unico test y no en cuatro porque los pasos se pasan entre si:
 * el identificador de la necesidad lo necesita el paso de la propuesta, el de la
 * propuesta lo necesita la adjudicacion, y el identificador de la contratacion
 * solo existe despues de adjudicar. Separarlos obligaria a compartir estado
 * entre tests -por un fichero, una base de datos o variables de entorno-, que es
 * exactamente la forma en que una suite E2E se vuelve intermitente sin que nadie
 * sepa por que.
 */
test('recorrido critico: publicar necesidad, recibir propuesta, adjudicar y cancelar', async ({
  browser,
  request,
}) => {
  // El perfil del oferente lo valida un administrador: se deja antes de abrir
  // los navegadores para que un fallo aqui se lea como "no se pudo preparar el
  // recorrido" y no como un boton que no responde.
  await asegurarPrestadorValidad(request);

  const contextoSolicitante = await browser.newContext();
  const contextoOferente = await browser.newContext();
  const solicitante = await contextoSolicitante.newPage();
  const oferente = await contextoOferente.newPage();

  // Un titulo unico por ejecucion: el listado de oferentes muestra todas las
  // necesidades abiertas y el recorrido debe Choose la suya, no la primera.
  const titulo = `Ajustar la puerta del patio ${Date.now()}`;
  const descripcion =
    'La puerta del patio no cierra desde hace dias y el viento entra en la cocina. Necesito que alguien la ajuste.';

  await test.step('la solicitante publica una necesidad', async () => {
    await iniciarSesion(solicitante, CUENTAS.solicitante);
    await solicitante.goto('/mis-necesidades');
    await solicitante.getByRole('button', { name: 'Publicar una necesidad' }).click();

    await solicitante.locator('#titulo').fill(titulo);
    await solicitante.locator('#descripcion').fill(descripcion);
    // La primera opcion real del selector de oficios: la categoria la carga el
    // catalogo y su identificador cambia entre entornos.
    await solicitante.locator('#idCategoria').selectOption({ index: 1 });
    await solicitante.locator('#presupuestoEstimado').fill('80000');
    await solicitante.locator('#ubicacionAproximada').fill('Barrio Centro');

    await solicitante.getByRole('button', { name: 'Publicar', exact: true }).click();

    // La necesidad tiene que aparecer en la lista de la solicitante.
    await expect(solicitante.getByRole('heading', { name: titulo })).toBeVisible();
  });

  await test.step('el oferente encuentra la necesidad abierta y le responde', async () => {
    await iniciarSesion(oferente, CUENTAS.oferente);
    await oferente.goto('/necesidades');
    await oferente.getByRole('link').filter({ hasText: titulo }).click();
    await expect(oferente.getByRole('heading', { name: titulo })).toBeVisible();

    await oferente.locator('#precio').fill('75000');
    await oferente.locator('#tiempoEstimado').fill('2');
    await oferente
      .locator('#mensaje')
      .fill('Puedo ajustarla el mismo dia, con la bisagra incluida en el precio.');

    await oferente.getByRole('button', { name: 'Enviar propuesta' }).click();
    // Enviar la propuesta devuelve a la bandeja de propuestas.
    await oferente.waitForURL('**/mis-propuestas');
  });

  await test.step('la solicitante ve la propuesta y adjudica', async () => {
    await solicitante.bringToFront();
    await solicitante.goto('/mis-necesidades');

    // "Ver propuestas" es un boton por necesidad, asi que hay que apuntar al de
    // esta necesidad y no al primero de la pagina.
    const tarjeta = solicitante
      .locator('div.pa-pila--4 > div.pa-tarjeta')
      .filter({ hasText: titulo })
      .first();
    await tarjeta.getByRole('button', { name: 'Ver propuestas' }).click();

    // Adjudicar es irreversible, asi que la interfaz pide confirmacion. El test
    // tiene que pasar por esa confirmacion: saltarsela probaria una pantalla que
    // el usuario nunca ve.
    await tarjeta.getByRole('button', { name: 'Elegir esta propuesta' }).click();
    await tarjeta.getByRole('button', { name: 'Si, elegir esta' }).click();

    // La necesidad deja de estar abierta.
    await expect(tarjeta.getByText('ADJUDICADA')).toBeVisible();
  });

  await test.step('la contratacion aparece y se puede cancelar', async () => {
    await solicitante.goto('/contrataciones');
    const contratacion = solicitante
      .locator('a[href^="/contrataciones/"]')
      // La tarjeta recorta la descripcion a 70 caracteres, asi que se busca por
      // un fragmento: comparar con el texto entero no encontraria nunca nada.
      .filter({ hasText: descripcion.slice(0, 40) })
      .first();
    await expect(contratacion).toBeVisible();
    await contratacion.click();

    await solicitante.getByRole('button', { name: 'Cancelar la contratacion' }).click();
    // "Ya no lo necesito" es un motivo que computa y no pide explicacion, asi
    // que la pantalla muestra el peso de la cancelacion al terminar.
    await solicitante.locator('#codigoMotivo').selectOption('YA_NO_LO_NECESITO');
    await solicitante.getByRole('button', { name: 'Confirmar la cancelacion' }).click();

    await expect(solicitante.getByText('La contratacion quedo cancelada')).toBeVisible();
  });
});
