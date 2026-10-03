import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  ErrorApi,
  capacidadDe,
  esFalloDeServicio,
  mensajeDeCapacidad,
  pedir,
} from '../api/cliente';

/**
 * Pruebas de la degradacion elegante (SRS RNF19 / SRS-NFR-U01).
 *
 * ── Que se protege ───────────────────────────────────────────────────────────
 *
 * RNF19 pide dos cosas a la vez: que se diga QUE capacidad se cae, y que el
 * resto siga funcionando. La segunda se cumple sola si el error es un dato y no
 * una exception que tumba la pantalla; lo que se comprueba aqui es la primera.
 *
 * Y una cosa que es facil de equivocar: un 4xx NO es una caida. Un 422 quiere
 * decir que el servicio esta de pie y ha rechazado la peticion. Anunciar "no se
 * pueden mostrar los avisos" cuando el problema es una contrasena caducada
 * asusta mas de lo que informa, y ademas hace que el reintento automatico de
 * React Query se comporte como si algo se pudiera arreglar.
 */

/** Prefijo de ruta -> microservicio dueno. Copiada de `api-gateway/config/routes`. */
const DUENOS: readonly [string, string][] = [
  ['/api/v1/auth/login', 'auth-service'],
  ['/api/v1/auth/refresh', 'auth-service'],
  ['/api/v1/users/perfil', 'auth-service'],
  ['/api/v1/providers/9', 'provider-service'],
  ['/api/v1/services', 'catalog-service'],
  ['/api/v1/services/12', 'catalog-service'],
  ['/api/v1/categories', 'catalog-service'],
  ['/api/v1/needs', 'request-service'],
  ['/api/v1/needs/4/proposals', 'request-service'],
  ['/api/v1/proposals', 'request-service'],
  ['/api/v1/requests', 'request-service'],
  ['/api/v1/requests/8/cancel', 'request-service'],
  ['/api/v1/ratings', 'rating-service'],
  ['/api/v1/ratings/users/9', 'rating-service'],
  ['/api/v1/notifications', 'notification-service'],
  ['/api/v1/admin/reports', 'admin-reporting-service'],
];

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Un `fetch` que devuelve ese estado, con un cuerpo de error bien formado. */
function respondeCon(estado: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({ code: 'UPSTREAM_UNAVAILABLE', message: 'Servicio no disponible.' }),
          { status: estado, headers: { 'content-type': 'application/json' } }
        )
    )
  );
}

/** Una red que ni siquiera contesta: `fetch` lanza, como cuando no hay cobertura. */
function redCaida(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    })
  );
}

const esquema = z.object({ ok: z.boolean() });

describe('que estados cuentan como caida', () => {
  it('solo 502, 503 y 504: son los que no se pudo ni contestar', () => {
    expect(esFalloDeServicio(502)).toBe(true);
    expect(esFalloDeServicio(503)).toBe(true);
    expect(esFalloDeServicio(504)).toBe(true);
  });

  it('un 500 NO cuenta: el servicio esta de pie y se equivoco', () => {
    // El gateway lo cuenta como fallo del cortacircuitos aunque el servicio
    // responda, y no se sabe que dato se perdio.
    expect(esFalloDeServicio(500)).toBe(false);
  });

  it('ningun 4xx cuenta: el servicio funciono y rechazo la peticion', () => {
    for (const estado of [400, 401, 403, 404, 409, 422, 429]) {
      expect(esFalloDeServicio(estado)).toBe(false);
    }
  });
});

describe('la tabla ruta -> microservicio', () => {
  it.each(DUENOS)('%s es de %s', (ruta, servicio) => {
    expect(capacidadDe(ruta)?.servicio).toBe(servicio);
  });

  it('gana el prefijo mas largo: /needs/4/proposals es de request, no de otro', () => {
    expect(capacidadDe('/api/v1/needs/4/proposals')?.servicio).toBe('request-service');
  });

  it('el corte es por segmento, no por prefijo a pelo', () => {
    expect(capacidadDe('/api/v1/services-extra')).toBeNull();
    expect(capacidadDe('/api/v1/necesidades')).toBeNull();
  });

  it('no se confunde con los parametros de la URL', () => {
    expect(capacidadDe('/api/v1/services?categoria=3')?.servicio).toBe('catalog-service');
  });

  it('una ruta desconocida no inventa un dueno', () => {
    expect(capacidadDe('/api/v1/inventado')).toBeNull();
  });
});

describe('lo que se le dice a la persona', () => {
  it('cada servicio dice lo suyo, y no un texto generico', () => {
    const esperado: readonly [string, string][] = [
      ['/api/v1/services', 'el catalogo de servicios'],
      ['/api/v1/categories', 'las categorias'],
      ['/api/v1/providers/9', 'los perfiles de prestador'],
      ['/api/v1/needs', 'las necesidades'],
      ['/api/v1/proposals', 'las propuestas'],
      ['/api/v1/requests', 'las contrataciones'],
      ['/api/v1/ratings/users/9', 'las calificaciones'],
      ['/api/v1/notifications', 'los avisos'],
      ['/api/v1/admin/reports', 'la administracion'],
    ];

    for (const [ruta, texto] of esperado) {
      const capacidad = capacidadDe(ruta);
      expect(capacidad).not.toBeNull();
      expect(mensajeDeCapacidad(capacidad!)).toContain(texto);
    }
  });

  it('el catalogo se dice en singular y las listas en plural', () => {
    expect(mensajeDeCapacidad(capacidadDe('/api/v1/services')!)).toContain(
      'No se puede mostrar el catalogo de servicios.'
    );
    expect(mensajeDeCapacidad(capacidadDe('/api/v1/notifications')!)).toContain(
      'No se pueden mostrar los avisos.'
    );
  });

  it('la segunda frase es la otra mitad de RNF19: el resto sigue en pie', () => {
    for (const [ruta] of DUENOS) {
      expect(mensajeDeCapacidad(capacidadDe(ruta)!)).toContain(
        'El resto de la aplicacion sigue funcionando.'
      );
    }
  });

  it('una ruta sin dueno habla de la puerta, sin soltar nombres internos', () => {
    const capacidad = new ErrorApi(503, 'X', '', undefined, [], '/api/v1/inventado');

    expect(capacidad.servicio).toBe('api-gateway');
    expect(capacidad.mensajeDegradado).toContain('Punto Amigo');
    expect(capacidad.mensajeDegradado).not.toContain('service');
  });
});

describe('lo que llega al componente', () => {
  it('un 503 nombra la capacidad, aunque el cuerpo del servidor tenga su propio texto', async () => {
    respondeCon(503);

    // El cuerpo del gateway para un servicio caido SI tiene la forma esperada y
    // SI trae un mensaje: "Servicio no disponible", que no dice nada de que se
    // ha perdido. Por eso el texto del servidor se sustituye tambien cuando se
    // pudo leer bien. Alguien lee el mensaje, no el codigo.
    const fallo = await pedir('/api/v1/services', esquema).catch((e: unknown) => e as ErrorApi);

    expect(fallo).toBeInstanceOf(ErrorApi);
    expect((fallo as ErrorApi).estado).toBe(503);
    expect((fallo as ErrorApi).mensajeDegradado).toContain('el catalogo de servicios');
    expect((fallo as ErrorApi).message).toContain('el catalogo de servicios');
    expect((fallo as ErrorApi).message).not.toContain('Servicio no disponible');
  });

  it('una red caida dice lo mismo que un servicio parado', async () => {
    redCaida();

    const fallo = await pedir('/api/v1/notifications', esquema).catch(
      (e: unknown) => e as ErrorApi
    );

    expect(fallo).toBeInstanceOf(ErrorApi);
    // Se reporta como 503 y no como 0: la politica de reintentos decide por
    // estado, y un 0 contaria como "menor de 500", es decir, como algo que NO
    // se reintenta. Con datos contados, quien navega se quedaria sin catalogo
    // ante un corte de un segundo.
    expect((fallo as ErrorApi).estado).toBe(503);
    expect((fallo as ErrorApi).mensajeDegradado).toContain('los avisos');
  });

  it('el error guarda la ruta, que es lo unico que permite nombrar la capacidad', async () => {
    respondeCon(503);

    const fallo = await pedir('/api/v1/needs/4/proposals', esquema).catch(
      (e: unknown) => e as ErrorApi
    );

    expect((fallo as ErrorApi).ruta).toBe('/api/v1/needs/4/proposals');
    expect((fallo as ErrorApi).servicio).toBe('request-service');
  });

  it('un 503 con un cuerpo que no se pudo leer tambien nombra la capacidad', async () => {
    // Un 502 del proxy llega con el cuerpo de un nginx, no con el del backend.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('<html>502 Bad Gateway</html>', {
            status: 502,
            headers: { 'content-type': 'text/html' },
          })
      )
    );

    const fallo = await pedir('/api/v1/requests', esquema).catch((e: unknown) => e as ErrorApi);

    expect(fallo).toBeInstanceOf(ErrorApi);
    expect((fallo as ErrorApi).mensajeDegradado).toContain('las contrataciones');
    // Fallar mientras se maneja un fallo esconderia el problema original: un
    // error de analisis en vez del 502.
    expect((fallo as ErrorApi).codigo).toBe('RESPUESTA_INESPERADA');
  });
});

describe('lo que NO se marca como caida', () => {
  it.each([400, 401, 403, 404, 409, 422, 429])(
    'un %i no anuncia ninguna capacidad caída',
    async (estado) => {
      respondeCon(estado);

      const fallo = await pedir('/api/v1/notifications', esquema).catch(
        (e: unknown) => e as ErrorApi
      );

      expect(fallo).toBeInstanceOf(ErrorApi);
      const error = fallo as ErrorApi;
      expect(error.degradado).toBe(false);
      expect(error.capacidad).toBeNull();
      // Y el mensaje del servidor se respeta: un 422 trae el detalle del campo
      // y es la persona quien tiene que corregirlo.
      expect(error.message).not.toContain('sigue funcionando');
    }
  );

  it('un 422 conserva el detalle por campo que trae el servidor', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              code: 'VALIDATION_FAILED',
              message: 'Revise los campos marcados.',
              details: [{ field: 'correo', message: 'Correo invalido.' }],
            }),
            { status: 422, headers: { 'content-type': 'application/json' } }
          )
      )
    );

    const fallo = await pedir('/api/v1/notifications', esquema).catch(
      (e: unknown) => e as ErrorApi
    );

    expect((fallo as ErrorApi).message).toBe('Revise los campos marcados.');
    expect((fallo as ErrorApi).detalles).toHaveLength(1);
    expect((fallo as ErrorApi).sinPermiso).toBe(false);
  });

  it('un 500 no anuncia una capacidad que no se sabe cual es', async () => {
    respondeCon(500);

    const fallo = await pedir('/api/v1/notifications', esquema).catch(
      (e: unknown) => e as ErrorApi
    );

    expect((fallo as ErrorApi).degradado).toBe(false);
    // Es el unico sitio que queda con un texto generico, y es tambien el unico
    // que puede: RNF19 exige nombrar la capacidad cuando se sabe cual es.
    expect((fallo as ErrorApi).message).not.toContain('los avisos');
  });

  it('un 401 no se confunde con una caida, y por eso no se reintenta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ code: 'UNAUTHENTICATED', message: 'Sesion no valida.' }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
          })
      )
    );

    const fallo = await pedir('/api/v1/notifications', esquema).catch(
      (e: unknown) => e as ErrorApi
    );

    const error = fallo as ErrorApi;
    expect(error.sinAutenticar).toBe(true);
    expect(error.degradado).toBe(false);
    // Y este es el que la politica de reintentos de main.tsx corta: reintentar
    // un 401 gasta datos y retrasa el mensaje sin arreglar nada.
    expect(error.estado < 500).toBe(true);
  });
});
