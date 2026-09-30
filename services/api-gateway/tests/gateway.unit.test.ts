import { CircuitBreaker } from '../src/proxy/CircuitBreaker';
import { esPublica, resolverRuta, RUTAS } from '../src/config/routes';
import { limpiarCabecerasDeCliente, CABECERAS_INTERNAS } from '../src/proxy/forward';
import type { Request } from 'express';

describe('tabla de enrutado', () => {
  it('lleva necesidades, propuestas y solicitudes al mismo servicio', () => {
    // Los tres forman un solo agregado: separarlos exigiria una transaccion
    // distribuida al adjudicar.
    expect(resolverRuta('/api/v1/needs')?.servicio).toBe('request-service');
    expect(resolverRuta('/api/v1/proposals/7/award')?.servicio).toBe('request-service');
    expect(resolverRuta('/api/v1/requests/3/status')?.servicio).toBe('request-service');
  });

  it('distingue servicios distintos por prefijo', () => {
    expect(resolverRuta('/api/v1/auth/login')?.servicio).toBe('auth-service');
    expect(resolverRuta('/api/v1/services?q=fuga')?.servicio ?? null).toBe(null);
    expect(resolverRuta('/api/v1/services')?.servicio).toBe('catalog-service');
    expect(resolverRuta('/api/v1/providers/12')?.servicio).toBe('provider-service');
  });

  it('no enruta lo que no reconoce', () => {
    expect(resolverRuta('/api/v1/desconocido')).toBeNull();
    expect(resolverRuta('/')).toBeNull();
    // Un prefijo parcial no debe colarse: /api/v1/authorize no es /api/v1/auth.
    expect(resolverRuta('/api/v1/authorize')).toBeNull();
  });
});

describe('rutas publicas', () => {
  const auth = RUTAS.find((r) => r.prefijo === '/api/v1/auth')!;
  const catalogo = RUTAS.find((r) => r.prefijo === '/api/v1/services')!;
  const necesidades = RUTAS.find((r) => r.prefijo === '/api/v1/needs')!;

  it('registro y login pasan sin token', () => {
    expect(esPublica(auth, 'POST', '/api/v1/auth/register')).toBe(true);
    expect(esPublica(auth, 'POST', '/api/v1/auth/login')).toBe(true);
  });

  it('el resto de auth exige token', () => {
    expect(esPublica(auth, 'POST', '/api/v1/auth/logout')).toBe(false);
    expect(esPublica(auth, 'GET', '/api/v1/auth/me')).toBe(false);
  });

  it('el metodo forma parte de la comparacion', () => {
    // GET /services es publico; POST /services publica un servicio y no lo es.
    expect(esPublica(catalogo, 'GET', '/api/v1/services')).toBe(true);
    expect(esPublica(catalogo, 'POST', '/api/v1/services')).toBe(false);
  });

  it('el comodin :id case con cualquier valor pero respeta la profundidad', () => {
    expect(esPublica(catalogo, 'GET', '/api/v1/services/42')).toBe(true);
    expect(esPublica(catalogo, 'GET', '/api/v1/services/42/ratings')).toBe(false);
  });

  it('las necesidades NO son publicas: solo las ven oferentes validados', () => {
    expect(esPublica(necesidades, 'GET', '/api/v1/needs')).toBe(false);
  });

  it('denegacion por defecto: una ruta sin lista publica nunca es publica', () => {
    const sinLista = RUTAS.filter((r) => r.publico === undefined);
    expect(sinLista.length).toBeGreaterThan(0);
    for (const ruta of sinLista) {
      expect(esPublica(ruta, 'GET', `${ruta.prefijo}/cualquier-cosa`)).toBe(false);
    }
  });
});

describe('limpieza de cabeceras del cliente', () => {
  /**
   * Es el control mas importante del gateway.
   *
   * Los servicios confian en x-internal-user-id por el hecho de recibirla. Si
   * una peticion externa pudiera traerla, bastaria una cabecera para hacerse
   * pasar por administrador sin token alguno.
   */
  it('elimina toda cabecera interna que llegue de fuera', () => {
    const req = {
      headers: {
        'x-internal-user-id': '1',
        'x-internal-roles': 'ADMINISTRADOR',
        'x-internal-jti': 'falsificado',
        'x-internal-secret': 'adivinado',
        authorization: 'Bearer token-legitimo',
        'content-type': 'application/json',
      },
    } as unknown as Request;

    limpiarCabecerasDeCliente(req);

    for (const cabecera of Object.values(CABECERAS_INTERNAS)) {
      expect(req.headers[cabecera]).toBeUndefined();
    }
    // Las cabeceras legitimas sobreviven.
    expect(req.headers['authorization']).toBe('Bearer token-legitimo');
    expect(req.headers['content-type']).toBe('application/json');
  });
});

describe('cortacircuitos', () => {
  let ahora = 0;
  const reloj = (): number => ahora;

  beforeEach(() => {
    ahora = 1_000_000;
  });

  it('permite mientras esta cerrado', () => {
    const cb = new CircuitBreaker(undefined, reloj);
    expect(cb.permite('catalog-service')).toBe(true);
    expect(cb.estado('catalog-service')).toBe('CERRADO');
  });

  it('abre al alcanzar el umbral de fallos consecutivos', () => {
    const cb = new CircuitBreaker({ umbralFallos: 3, esperaMs: 10_000, exitosParaCerrar: 2 }, reloj);

    cb.registrarFallo('catalog-service');
    cb.registrarFallo('catalog-service');
    expect(cb.estado('catalog-service')).toBe('CERRADO');

    cb.registrarFallo('catalog-service');
    expect(cb.estado('catalog-service')).toBe('ABIERTO');
    expect(cb.permite('catalog-service')).toBe(false);
  });

  it('un exito intercalado reinicia la cuenta', () => {
    const cb = new CircuitBreaker({ umbralFallos: 3, esperaMs: 10_000, exitosParaCerrar: 2 }, reloj);

    cb.registrarFallo('catalog-service');
    cb.registrarFallo('catalog-service');
    cb.registrarExito('catalog-service');
    cb.registrarFallo('catalog-service');
    cb.registrarFallo('catalog-service');

    expect(cb.estado('catalog-service')).toBe('CERRADO');
  });

  it('pasa a semiabierto cuando vence la espera', () => {
    const cb = new CircuitBreaker({ umbralFallos: 1, esperaMs: 10_000, exitosParaCerrar: 2 }, reloj);
    cb.registrarFallo('catalog-service');

    expect(cb.permite('catalog-service')).toBe(false);

    ahora += 10_001;
    expect(cb.permite('catalog-service')).toBe(true);
    expect(cb.estado('catalog-service')).toBe('SEMIABIERTO');
  });

  it('un solo fallo en semiabierto reabre sin volver a contar hasta el umbral', () => {
    const cb = new CircuitBreaker({ umbralFallos: 5, esperaMs: 10_000, exitosParaCerrar: 2 }, reloj);
    for (let i = 0; i < 5; i += 1) cb.registrarFallo('catalog-service');

    ahora += 10_001;
    cb.permite('catalog-service');
    cb.registrarFallo('catalog-service');

    expect(cb.estado('catalog-service')).toBe('ABIERTO');
  });

  it('se cierra tras los exitos requeridos en semiabierto', () => {
    const cb = new CircuitBreaker({ umbralFallos: 1, esperaMs: 10_000, exitosParaCerrar: 2 }, reloj);
    cb.registrarFallo('catalog-service');

    ahora += 10_001;
    cb.permite('catalog-service');
    cb.registrarExito('catalog-service');
    expect(cb.estado('catalog-service')).toBe('SEMIABIERTO');

    cb.registrarExito('catalog-service');
    expect(cb.estado('catalog-service')).toBe('CERRADO');
  });

  it('aisla los servicios entre si', () => {
    const cb = new CircuitBreaker({ umbralFallos: 1, esperaMs: 10_000, exitosParaCerrar: 1 }, reloj);
    cb.registrarFallo('rating-service');

    // Que las calificaciones esten caidas no debe impedir buscar servicios.
    expect(cb.permite('rating-service')).toBe(false);
    expect(cb.permite('catalog-service')).toBe(true);
  });
});
