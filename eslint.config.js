// Configuracion plana de ESLint 9 para todo el monorepo.
const tseslint = require('@typescript-eslint/eslint-plugin');
const tsparser = require('@typescript-eslint/parser');
const prettier = require('eslint-config-prettier');

module.exports = [
  // Los patrones llevan `**/` delante a proposito. En configuracion plana las
  // rutas son relativas al archivo de configuracion, asi que un `dist/**` a secas
  // solo ignoraba el `dist/` de la raiz y acababa lintando el JavaScript ya
  // compilado de cada servicio.
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/*.d.ts'] },

  // TypeScript: el codigo de los servicios y del cliente.
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': ['warn', { allowExpressions: true }],
      // `_` significa "descartado a proposito" en argumentos, en variables
      // desestructuradas y en el `catch`. Se ignoran las tres: obligar a
      // nombrar de otra forma lo que se tira a proposito produce mas ruido que
      // el aviso que evita.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'no-return-await': 'error',
    },
  },

  // JavaScript: migraciones, seeds y utilidades de base de datos.
  {
    files: ['db/**/*.js', '*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        process: 'readonly',
        __dirname: 'readonly',
        console: 'readonly',
      },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  prettier,
];
