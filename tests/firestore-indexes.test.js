/**
 * @fileoverview Tests for firestore-indexes rule
 * @author Q42
 */
'use strict';

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const { RuleTester } = require('eslint');
const rule = require('../lib/rules/firestore-indexes');
const fs = require('fs');
const path = require('path');

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
  },
});

// Use fixtures file for testing
const testIndexesPath = path.join(__dirname, 'fixtures', 'test-indexes.json');

ruleTester.run('firestore-indexes', rule, {
  valid: [
    // Single where clause - no index needed
    {
      code: `
        firestore.collection('users').where('age', '>', 18).get();
      `,
      options: [{ indexesPath: testIndexesPath }],
    },

    // Valid: Index exists for users with age and name
    {
      code: `
        firestore.collection('users')
          .where('age', '>', 18)
          .where('name', '==', 'John')
          .get();
      `,
      options: [{ indexesPath: testIndexesPath }],
    },

    // Valid: Index exists for posts with status and createdAt
    {
      code: `
        firestore.collection('posts')
          .where('status', '==', 'published')
          .orderBy('createdAt', 'desc')
          .get();
      `,
      options: [{ indexesPath: testIndexesPath }],
    },

    // Valid: Index exists for products
    {
      code: `
        firestore.collection('products')
          .where('category', '==', 'electronics')
          .where('price', '<', 1000)
          .orderBy('rating', 'desc')
          .get();
      `,
      options: [{ indexesPath: testIndexesPath }],
    },

    // No collection call - should not trigger
    {
      code: `
        someOtherFunction().where('field', '==', 'value').get();
      `,
      options: [{ indexesPath: testIndexesPath }],
    },

    // Valid: Custom collection reference function with limit
    {
      code: `
        async function test() {
          const snapshot = await firestore
            .templateCollRef()
            .where('type', '==', templateType)
            .where('status', '==', FirebaseTemplateStatus.Current)
            .limit(1)
            .get();
        }
      `,
      options: [{ indexesPath: testIndexesPath }],
    },

    // Valid: Array-contains with orderBy (index exists)
    {
      code: `
        async function test() {
          const snapshot = await firestore
            .passportCollRef()
            .where('intakers', 'array-contains', IdToken.uid)
            .orderBy('updated', 'desc')
            .get();
        }
      `,
      options: [{ indexesPath: testIndexesPath }],
    },

    // Valid: Index merging - two equality filters
    {
      code: `
        async function test() {
          const collectionSnapshot = await firestore
            .invitationCollRef()
            .where('userId', '==', userId)
            .where('documentId', '==', documentId)
            .limit(1)
            .get();
        }
      `,
      options: [{ indexesPath: testIndexesPath }],
    },

    // Valid: Index merging - two equality filters + one inequality (uses composite index)
    {
      code: `
        async function test() {
          const result = await firestore
            .sessionCollRef()
            .where('documentId', '==', documentId)
            .where('status', '==', null)
            .where('count', '<', MAX_COUNT)
            .get();
        }
      `,
      options: [{ indexesPath: testIndexesPath }],
    },

    // Valid: Index merging - all equality filters
    {
      code: `
        firestore.collection('items')
          .where('status', '==', 'active')
          .where('category', '==', 'electronics')
          .get();
      `,
      options: [{ indexesPath: testIndexesPath }],
    },

    // Valid: Index merging - three equality filters
    {
      code: `
        firestore.collection('items')
          .where('status', '==', 'active')
          .where('category', '==', 'electronics')
          .where('inStock', '==', true)
          .get();
      `,
      options: [{ indexesPath: testIndexesPath }],
    },

    // Valid: Index merging - equality filters + one orderBy
    {
      code: `
        firestore.collection('items')
          .where('status', '==', 'active')
          .where('category', '==', 'electronics')
          .orderBy('createdAt', 'desc')
          .get();
      `,
      options: [{ indexesPath: testIndexesPath }],
    },

    // Valid: Index merging - equality filters + one inequality
    {
      code: `
        firestore.collection('items')
          .where('status', '==', 'active')
          .where('price', '>', 100)
          .get();
      `,
      options: [{ indexesPath: testIndexesPath }],
    },
  ],

  invalid: [
    // Invalid: Multiple orderBy clauses (cannot use index merging)
    {
      code: `
        firestore.collection('users')
          .orderBy('email', 'asc')
          .orderBy('status', 'desc')
          .get();
      `,
      options: [{ indexesPath: testIndexesPath }],
      errors: [
        {
          messageId: 'missingIndex',
        },
      ],
    },

    // Invalid: Multiple inequality filters on different fields (cannot use index merging)
    {
      code: `
        firestore.collection('orders')
          .where('price', '>', 100)
          .where('quantity', '<', 10)
          .get();
      `,
      options: [{ indexesPath: testIndexesPath }],
      errors: [
        {
          messageId: 'missingIndex',
        },
      ],
    },

    // Invalid: Inequality + orderBy on different fields (cannot use simple index merging)
    {
      code: `
        firestore.collection('products')
          .where('price', '>', 100)
          .orderBy('rating', 'desc')
          .get();
      `,
      options: [{ indexesPath: testIndexesPath }],
      errors: [
        {
          messageId: 'missingIndex',
        },
      ],
    },

    // Invalid: Multiple inequality filters on different fields with orderBy
    {
      code: `
        async function test() {
          const snapshot = await firestore
            .templateCollRef()
            .where('priority', '>', 5)
            .where('score', '<', 100)
            .orderBy('createdAt', 'desc')
            .get();
        }
      `,
      options: [{ indexesPath: testIndexesPath }],
      errors: [
        {
          messageId: 'missingIndex',
        },
      ],
    },

    // Invalid: Array-contains with wrong field - missing index
    {
      code: `
        async function test() {
          const passportsSnapshot = await firestore
            .passportCollRef()
            .where('wrongField', 'array-contains', IdToken.uid)
            .orderBy('updated', 'desc')
            .get();
        }
      `,
      options: [{ indexesPath: testIndexesPath }],
      errors: [
        {
          messageId: 'missingIndex',
        },
      ],
    },
  ],
});

console.log('All tests passed!');

// Note: The following test cases for conditional queries are examples for future implementation
// They require tracking variable reassignments across statements, which is not currently supported
//
// Example 1: Conditional query with if statement
// let query = firestore
//   .templateCollRef()
//   .where('status', '==', FirebaseTemplateStatus.Current)
//   .where('type', '==', type)
//   .orderBy('createdAt', 'desc')
//
// if (schoolId) {
//   query = query.where('schoolId', '==', schoolId)
// }
// const snapshot = await query.get()
//
// Example 2: If-else conditional with array-contains
// let query = firestore.passportCollRef()
//
// if (IdToken.role === UserRole.Intaker) {
//   query = query.where('intakers', 'array-contains', IdToken.uid)
// } else {
//   query = query.where('begeleider', 'array-contains', IdToken.uid)
// }
// const passportsSnapshot = await query.orderBy('updated', 'desc').get()
