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
  ],
});

// Clean up test file
fs.unlinkSync(testIndexesPath);

console.log('All tests passed!');
