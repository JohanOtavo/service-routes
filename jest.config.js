/**
 * Dos proyectos separados porque tienen coste y momento distintos:
 * las unitarias corren en cada commit, las de integracion solo en CI
 * (11-quality/testing-strategy.md).
 */
module.exports = {
  projects: [
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/services/*/tests/**/*.unit.test.ts', '<rootDir>/packages/*/tests/**/*.unit.test.ts'],
    },
    {
      displayName: 'integration',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/services/*/tests/**/*.int.test.ts'],
      // Levantan contenedores: mas lentas que las unitarias.
      testTimeout: 30000,
    },
  ],
  collectCoverageFrom: ['services/*/src/**/*.ts', 'packages/*/src/**/*.ts', '!**/*.d.ts'],
  coverageThreshold: {
    // Objetivos de 11-quality/testing-strategy.md.
    global: { lines: 80, statements: 80, branches: 70, functions: 80 },
    './services/*/src/domain/': { lines: 90, statements: 90 },
  },
};
