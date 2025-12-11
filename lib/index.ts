/**
 * @fileoverview ESLint plugin to ensure Firestore indexes are created for each query
 * @author Q42
 */

import firestoreIndexes from './rules/firestore-indexes';

//------------------------------------------------------------------------------
// Plugin Definition
//------------------------------------------------------------------------------

export = {
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
