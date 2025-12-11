module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
  plugins: ['eslint-firestore-indexes'],
  rules: {
    'eslint-firestore-indexes/firestore-indexes': [
      'error',
      {
        indexesPath: 'examples/indexes.json',
      },
    ],
  },
};
