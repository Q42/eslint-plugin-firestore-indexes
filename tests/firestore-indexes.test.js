/**
 * @fileoverview Tests for firestore-indexes rule
 * @author Q42
 */
'use strict';

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const { RuleTester } = require('eslint');
const rule = require('../dist/rules/firestore-indexes');
const fs = require('fs');
const path = require('path');

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    parser: require('@typescript-eslint/parser'),
    parserOptions: {
      project: './tsconfig.test.json',
      tsconfigRootDir: path.join(__dirname, '..'),
    },
  },
});

// Create a temporary indexes.json for testing
const testIndexesPath = path.join(__dirname, 'test-indexes.json');
const testIndexes = {
  indexes: [
    {
      collectionGroup: 'users',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'age', order: 'ASCENDING' },
        { fieldPath: 'name', order: 'ASCENDING' },
      ],
    },
    {
      collectionGroup: 'posts',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'DESCENDING' },
      ],
    },
    {
      collectionGroup: 'products',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'category', order: 'ASCENDING' },
        { fieldPath: 'price', order: 'ASCENDING' },
        { fieldPath: 'rating', order: 'DESCENDING' },
      ],
    },
    {
      collectionGroup: 'templates',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'type', order: 'ASCENDING' },
        { fieldPath: 'status', order: 'ASCENDING' },
      ],
    },
    {
      collectionGroup: 'templates',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'type', order: 'ASCENDING' },
        { fieldPath: 'createdAt', order: 'DESCENDING' },
      ],
    },
    {
      collectionGroup: 'passports',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'intakers', arrayConfig: 'CONTAINS', order: 'ASCENDING' },
        { fieldPath: 'updated', order: 'DESCENDING' },
      ],
    },
    {
      collectionGroup: 'passports',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'begeleider', arrayConfig: 'CONTAINS', order: 'ASCENDING' },
        { fieldPath: 'updated', order: 'DESCENDING' },
      ],
    },
  ],
  fieldOverrides: [],
};

// Write test indexes file
fs.writeFileSync(testIndexesPath, JSON.stringify(testIndexes, null, 2));

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
  ],

  invalid: [
    // Invalid: No index for users with email and status
    {
      code: `
        firestore.collection('users')
          .where('email', '==', 'test@example.com')
          .where('status', '==', 'active')
          .get();
      `,
      options: [{ indexesPath: testIndexesPath }],
      errors: [
        {
          messageId: 'missingIndex',
          data: {
            collection: 'users',
            filters: 'email (==), status (==)',
            indexesPath: testIndexesPath,
          },
        },
      ],
    },

    // Invalid: No index for orders collection
    {
      code: `
        firestore.collection('orders')
          .where('customerId', '==', '123')
          .orderBy('orderDate', 'desc')
          .get();
      `,
      options: [{ indexesPath: testIndexesPath }],
      errors: [
        {
          messageId: 'missingIndex',
          data: {
            collection: 'orders',
            filters: 'customerId (==), orderDate (orderBy)',
            indexesPath: testIndexesPath,
          },
        },
      ],
    },

    // Invalid: Wrong field combination for products
    {
      code: `
        firestore.collection('products')
          .where('brand', '==', 'Apple')
          .where('inStock', '==', true)
          .orderBy('updatedAt', 'desc')
          .get();
      `,
      options: [{ indexesPath: testIndexesPath }],
      errors: [
        {
          messageId: 'missingIndex',
          data: {
            collection: 'products',
            filters: 'brand (==), inStock (==), updatedAt (orderBy)',
            indexesPath: testIndexesPath,
          },
        },
      ],
    },

    // Invalid: Multiple where clauses without index
    {
      code: `
        db.collection('comments')
          .where('postId', '==', '456')
          .where('approved', '==', true)
          .get();
      `,
      options: [{ indexesPath: testIndexesPath }],
      errors: [
        {
          messageId: 'missingIndex',
        },
      ],
    },

    // Invalid: Query with where clause after orderBy - missing index
    {
      code: `
        async function test() {
          const snapshot = await firestore
            .templateCollRef()
            .where('status', '==', FirebaseTemplateStatus.Current)
            .where('type', '==', type)
            .orderBy('createdAt', 'desc')
            .where('foobar', '==', 'bar')
            .get();
        }
      `,
      options: [{ indexesPath: testIndexesPath }],
      errors: [
        {
          messageId: 'missingIndex',
          data: {
            collection: 'templates',
            filters: 'status (==), type (==), createdAt (orderBy), foobar (==)',
            indexesPath: testIndexesPath,
          },
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

// Clean up test file
fs.unlinkSync(testIndexesPath);

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
