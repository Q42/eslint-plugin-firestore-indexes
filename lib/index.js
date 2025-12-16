/**
 * @fileoverview ESLint plugin to ensure Firestore indexes are created for each query
 * @author Q42
 */
'use strict';

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const firestoreIndexes = require('./rules/firestore-indexes');

//------------------------------------------------------------------------------
// Plugin Definition
//------------------------------------------------------------------------------

module.exports = {
  rules: {
    'firestore-indexes': firestoreIndexes,
  },
  configs: {
    recommended: {
      plugins: ['eslint-firestore-indexes'],
      rules: {
        'eslint-firestore-indexes/firestore-indexes': 'error',
      },
    },
  },
};
