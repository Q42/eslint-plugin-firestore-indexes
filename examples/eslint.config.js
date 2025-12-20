const firestoreIndexes = require('../lib/index.js');

module.exports = [
  {
    files: ['**/*.js'],
    plugins: {
      'firestore-indexes': firestoreIndexes,
    },
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
    },
    rules: {
      'firestore-indexes/firestore-indexes': [
        'error',
        {
          indexesPath: 'indexes.json',
        },
      ],
    },
  },
];
