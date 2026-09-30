/**
 * Tabla de enrutado del gateway.
 *
 * SRS-GW-02: cada prefijo de ruta pertenece a un microservicio. La tabla es
 * explicita y no se deduce del nombre del recurso, porque la correspondencia no
 * siempre es obvia: `/needs` y `/proposals` van los dos a request-service, que
 * es dueno del agregado completo.
 *
 * `publico` marca las rutas que NO exigen token. Es una lista blanca a
 * proposito: una ruta nueva nace protegida, y olvidarse de declararla produce
 * un 401 —molesto pero inofensivo— en lugar de un agujero.
 */
export interface RutaUpstream {
  /** Prefijo que atiende esta entrada, sin barra final. */
  prefijo: string;
  /** Nombre del servicio; se usa en el registro y en el cortacircuitos. */
  servicio: string;
  /** Variable de entorno con su URL base. */
  variableUrl: string;
  /** Rutas exactas que no requieren autenticacion. */
  publico?: readonly { metodo: string; ruta: string }[];
}

export const RUTAS: readonly RutaUpstream[] = [
  {
    prefijo: '/api/v1/auth',
    servicio: 'auth-service',
    variableUrl: 'UPSTREAM_AUTH_URL',
    publico: [
      { metodo: 'POST', ruta: '/api/v1/auth/register' },
      { metodo: 'POST', ruta: '/api/v1/auth/login' },
      { metodo: 'POST', ruta: '/api/v1/auth/refresh' },
      { metodo: 'POST', ruta: '/api/v1/auth/password-recovery' },
      { metodo: 'POST', ruta: '/api/v1/auth/password-reset' },
    ],
  },
  {
    prefijo: '/api/v1/users',
    servicio: 'auth-service',
    variableUrl: 'UPSTREAM_AUTH_URL',
  },
  {
    prefijo: '/api/v1/providers',
    servicio: 'provider-service',
    variableUrl: 'UPSTREAM_PROVIDER_URL',
    // Consultar el perfil publico de un prestador no exige sesion (SRS RF31).
    publico: [{ metodo: 'GET', ruta: '/api/v1/providers/:id' }],
  },
  {
    prefijo: '/api/v1/services',
    servicio: 'catalog-service',
    variableUrl: 'UPSTREAM_CATALOG_URL',
    // La busqueda del catalogo es publica: sin ella, quien llega por primera
    // vez no puede ver que ofrece la plataforma (SRS RF45).
    publico: [
      { metodo: 'GET', ruta: '/api/v1/services' },
      { metodo: 'GET', ruta: '/api/v1/services/:id' },
    ],
  },
  {
    prefijo: '/api/v1/categories',
    servicio: 'catalog-service',
    variableUrl: 'UPSTREAM_CATALOG_URL',
    publico: [{ metodo: 'GET', ruta: '/api/v1/categories' }],
  },
  {
    prefijo: '/api/v1/needs',
    servicio: 'request-service',
    variableUrl: 'UPSTREAM_REQUEST_URL',
    // Las necesidades NO son publicas: solo las consultan oferentes validados
    // (SRS RF130), y su detalle no debe exponer datos de contacto (RF136).
  },
  {
    prefijo: '/api/v1/proposals',
    servicio: 'request-service',
    variableUrl: 'UPSTREAM_REQUEST_URL',
  },
  {
    prefijo: '/api/v1/requests',
    servicio: 'request-service',
    variableUrl: 'UPSTREAM_REQUEST_URL',
  },
  {
    prefijo: '/api/v1/ratings',
    servicio: 'rating-service',
    variableUrl: 'UPSTREAM_RATING_URL',
  },
  {
    prefijo: '/api/v1/notifications',
    servicio: 'notification-service',
    variableUrl: 'UPSTREAM_NOTIFICATION_URL',
  },
  {
    prefijo: '/api/v1/admin',
    servicio: 'admin-reporting-service',
    variableUrl: 'UPSTREAM_ADMIN_URL',
  },
];

/** Devuelve la entrada que atiende una ruta, o null si ninguna la cubre. */
export function resolverRuta(path: string): RutaUpstream | null {
  // Se elige el prefijo mas largo que coincida: asi una entrada mas especifica
  // gana sobre otra mas general si alguna vez se solapan.
  let mejor: RutaUpstream | null = null;

  for (const ruta of RUTAS) {
    const coincide = path === ruta.prefijo || path.startsWith(`${ruta.prefijo}/`);
    if (coincide && (mejor === null || ruta.prefijo.length > mejor.prefijo.length)) {
      mejor = ruta;
    }
  }

  return mejor;
}

/**
 * Indica si una peticion concreta puede pasar sin token.
 *
 * Compara segmento a segmento para que `:id` case con cualquier valor, sin
 * construir una expresion regular al vuelo a partir de la ruta.
 */
export function esPublica(ruta: RutaUpstream, metodo: string, path: string): boolean {
  if (ruta.publico === undefined) return false;

  return ruta.publico.some((entrada) => {
    if (entrada.metodo !== metodo) return false;

    const esperados = entrada.ruta.split('/');
    const recibidos = path.split('/');
    if (esperados.length !== recibidos.length) return false;

    return esperados.every(
      (segmento, i) => segmento.startsWith(':') || segmento === recibidos[i]
    );
  });
}
