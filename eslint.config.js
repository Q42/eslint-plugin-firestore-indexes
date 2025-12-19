/**
 * ESLint flat config for eslint-firestore-indexes
 */
module.exports = [
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**', 'examples/**'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      // Add any custom rules here if needed
    },
  },
];
