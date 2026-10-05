/**
 * Dos proyectos separados porque tienen coste y momento distintos: las
 * unitarias corren en cada commit, las de integracion solo en CI
 * (11-quality/testing-strategy.md).
 */
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
      /**
       * Carga `.env` sin pisar lo que ya venga definido, traduce los nombres de
       * servicio de Compose a loopback y exige que las pruebas arranquen de
       * verdad. Sin esto, una suite que no encuentra la base hace `return`
       * temprano y Jest la cuenta como aprobada: el gate puede quedar verde sin
       * que se haya ejecutado una sola prueba. Ver el archivo para el detalle.
       */
      globalSetup: '<rootDir>/jest.global-setup.js',
      // Tambien los paquetes compartidos: el consumidor de eventos solo se
      // puede probar de verdad contra MySQL, porque su defecto mas grave estuvo
      // en lo que el motor devuelve al insertar.
      // Y `db/`: los seeds se ejecutan contra el motor porque su garantia es
      // sobre lo que este NO hace -no borrar, no reasignar identificadores-, y
      // un doble en memoria no probaria ninguna de las dos cosas.
      testMatch: [
        '<rootDir>/services/*/tests/**/*.int.test.ts',
        '<rootDir>/packages/*/tests/**/*.int.test.ts',
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
