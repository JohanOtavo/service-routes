/**
 * Dos proyectos separados porque tienen coste y momento distintos: las
 * unitarias corren en cada commit, las de integracion solo en CI
 * (11-quality/testing-strategy.md).
 */
/**
 * El `.env` del repositorio, cargado antes de los proyectos.
 *
 * Las pruebas de integracion se OMITEN cuando falta su contrasena de base de
 * datos, y lo hacen contandose como aprobadas. En una maquina donde el `.env`
 * no esta exportado, eso convierte `npm test` en una medicion falsa: 151
 * pruebas "pasando" sin tocar la base, y la cobertura cayendo de 68 % a 42 %
 * sin que nada falle. En CI no se noto porque el workflow pone las variables a
 * mano.
 *
 * `dotenv` no sobrescribe lo que ya venga del entorno, asi que CI sigue
 * mandando sobre su propia configuracion.
 */
const hostPedido = process.env['MYSQL_HOST'];
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

/**
 * El `MYSQL_HOST` del `.env` es para los contenedores, no para las pruebas.
 *
 * Vale `mysql`, el nombre del servicio de compose, que solo resuelve dentro de
 * la red de Docker; las pruebas corren en el anfitrion y veian
 * "getaddrinfo ENOTFOUND mysql". Solo se corrige cuando nadie lo pidio de forma
 * explicita: CI manda `MYSQL_HOST=127.0.0.1` y eso se respeta tal cual.
 */
if (hostPedido === undefined) process.env['MYSQL_HOST'] = '127.0.0.1';

const tsJest = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    // El paquete compartido se resuelve al fuente, no a dist: asi las pruebas
    // no dependen de haber compilado antes.
    '^@punto-amigo/shared$': '<rootDir>/packages/shared/src/index.ts',
    '^@punto-amigo/messaging$': '<rootDir>/packages/messaging/src/index.ts',
    '^@punto-amigo/service-kit$': '<rootDir>/packages/service-kit/src/index.ts',
  },
  transform: {
    '^.+\.ts$': [
      'ts-jest',
      { tsconfig: { module: 'commonjs', target: 'ES2022', strict: true, esModuleInterop: true } },
    ],
  },
};

module.exports = {
  projects: [
    {
      ...tsJest,
      displayName: 'unit',
      testMatch: [
        '<rootDir>/services/*/tests/**/*.unit.test.ts',
        '<rootDir>/packages/*/tests/**/*.unit.test.ts',
      ],
    },
    {
      ...tsJest,
      displayName: 'integration',
      // Tambien los paquetes compartidos: el consumidor de eventos solo se
      // puede probar de verdad contra MySQL, porque su defecto mas grave estuvo
      // en lo que el motor devuelve al insertar.
      testMatch: [
        '<rootDir>/services/*/tests/**/*.int.test.ts',
        '<rootDir>/packages/*/tests/**/*.int.test.ts',
        // Y la capa de base de datos: las semillas solo se pueden probar
        // ejecutandolas, y lo que hay que demostrar de ellas —que repetirlas
        // conserva los identificadores— no se puede simular.
        '<rootDir>/db/tests/**/*.int.test.ts',
      ],
    },
  ],
  collectCoverageFrom: ['services/*/src/**/*.ts', 'packages/*/src/**/*.ts', '!**/*.d.ts'],
  /**
   * Trinquete, no objetivo.
   *
   * La estrategia pide 80/80/80/70 (11-quality/testing-strategy.md), pero esa
   * cifra nunca se midio: el workflow ejecutaba `test:unit` y
   * `test:integration` por separado, ninguna con `--coverage`, asi que el umbral
   * de abajo no se comprobaba en ningun sitio. Al medirlo de verdad con las 320
   * pruebas pasando, la cobertura real es:
   *
   *   statements 66.04%   branches 53.79%   functions 65.27%   lines 68.03%
   *
   * Estos valores son esa cifra menos ~1 punto, para que una corrida con una
   * funcion o rama mas cubierta no haga fallar la puerta sin motivo. Marcan el
   * suelo real: la cobertura puede subir, y si baja, CI se pone en rojo.
   *
   * Subir el trinquete es trabajo de pruebas, no de configuracion. La brecha
   * que queda esta anotada en el backlog con el reparto por capa.
   */
  coverageThreshold: {
    global: { lines: 67, statements: 65, branches: 52, functions: 64 },
  },
};
