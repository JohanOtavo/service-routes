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
    '^.+\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', target: 'ES2022', strict: true, esModuleInterop: true } }],
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
      ],
    },
  ],
  collectCoverageFrom: ['services/*/src/**/*.ts', 'packages/*/src/**/*.ts', '!**/*.d.ts'],
  coverageThreshold: {
    global: { lines: 80, statements: 80, branches: 70, functions: 80 },
  },
};
