import { expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Utilidades compartidas por los recorridos de extremo a extremo.
 *
 * Todo lo que hay aqui atraviesa la interfaz salvo `iniciarSesion`, que si entra
 * por la pantalla de acceso a proposito: es el unico momento del recorrido en
 * que la sesion se crea de verdad, y hacerlo por API dejaria sin comprobar la
 * pantalla de entrada, que es donde el usuario se equivoca.
 */

/** Cuentas sembradas por `db/seeds/auth`, con la contrasena de SEED_DEV_PASSWORD. */
export const CUENTAS = {
  admin: 'admin@puntoamigo.local',
  solicitante: 'solicitante@puntoamigo.local',
  oferente: 'oferente@puntoamigo.local',
} as const;

/**
 * El gateway limita las peticiones de autenticacion a 10 por minuto y por IP
 * (SRS RNF31). Un E2E que iniciara sesion en cada prueba consumiria esa cuota
 * con dos o tres tests y empezaria a fallar por el limite y no por el producto.
 * Por eso las pruebas inician sesion una vez por cuenta y reutilizan el
 * contexto.
 */
export function contrasenaDePrueba(): string {
  const valor = process.env['SEED_DEV_PASSWORD'];
  if (valor === undefined || valor === '') {
    throw new Error(
      'Falta SEED_DEV_PASSWORD. Las pruebas E2E usan las cuentas sembradas y su contrasena viene de esa variable.'
    );
  }
  return valor;
}

function cabeceras(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function tokenDe(request: APIRequestContext, correo: string): Promise<string> {
  const respuesta = await request.post('/api/v1/auth/login', {
    data: { correo, contrasena: contrasenaDePrueba() },
  });
  expect(
    respuesta.ok(),
    `No se pudo iniciar sesion con ${correo}: ${respuesta.status()} ${await respuesta.text()}`
  ).toBeTruthy();
  const cuerpo = (await respuesta.json()) as { accessToken: string };
  return cuerpo.accessToken;
}

/**
 * Deja al oferente con un perfil de prestador validado.
 *
 * Sin perfil `ACTIVE` el dominio rechaza la propuesta
 * (services/request-service/src/domain, `crearPropuesta`), y los seeds no crean
 * prestadores: la validacion es una tarea de administracion, no de alta de
 * cuenta. Asi que el recorrido la ejecuta por API como lo haria un
 * administrador, en lugar de saltarse la regla. Es idempotente: si el perfil ya
 * esta `ACTIVE` no toca nada.
 */
export async function asegurarPrestadorValidad(request: APIRequestContext): Promise<void> {
  const oferente = await tokenDe(request, CUENTAS.oferente);
  const actual = await request.get('/api/v1/providers/me', { headers: cabeceras(oferente) });

  if (actual.ok()) {
    const perfil = (await actual.json()) as { id: number; estado: string };
    if (perfil.estado === 'ACTIVE') return;
    await validar(request, perfil.id);
    return;
  }

  const creado = await request.post('/api/v1/providers', {
    headers: cabeceras(oferente),
    data: { nombre: 'Pedro E2E', especialidad: 'Mantenimiento general' },
  });
  expect(
    creado.ok(),
    `No se pudo crear el perfil de prestador: ${creado.status()} ${await creado.text()}`
  ).toBeTruthy();
  const perfil = (await creado.json()) as { id: number };
  await validar(request, perfil.id);
}

/** Valida un prestador con la cuenta de administracion sembrada. */
async function validar(request: APIRequestContext, idPrestador: number): Promise<void> {
  const admin = await tokenDe(request, CUENTAS.admin);
  const respuesta = await request.post(`/api/v1/providers/${idPrestador}/validate`, {
    headers: cabeceras(admin),
  });
  expect(
    respuesta.ok(),
    `No se pudo validar el prestador ${idPrestador}: ${respuesta.status()} ${await respuesta.text()}`
  ).toBeTruthy();
}

/**
 * Inicia sesion por la pantalla de acceso.
 *
 * Espera a que el formulario desaparezca en lugar de a una URL concreta porque
 * la pantalla devuelve a donde el usuario queria ir, que no siempre es la
 * portada.
 */
export async function iniciarSesion(page: Page, correo: string): Promise<void> {
  await page.goto('/entrar');
  await page.locator('#correo').fill(correo);
  await page.locator('#contrasena').fill(contrasenaDePrueba());
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.locator('#contrasena')).toHaveCount(0, { timeout: 20_000 });
}
