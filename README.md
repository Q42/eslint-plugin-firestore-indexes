# eslint-firestore-indexes

[![Test](https://github.com/Q42/eslint-firestore-indexes/actions/workflows/test.yml/badge.svg)](https://github.com/Q42/eslint-firestore-indexes/actions/workflows/test.yml)

Ensure Firestore indexes are created for each query in the codebase.

## Overview

This ESLint plugin helps you catch missing Firestore indexes at development time. It analyzes your code for Firestore queries and checks them against a configuration file (typically `indexes.json`) to ensure all required indexes are defined.

**Features:**
- Automatically detects Firestore queries using `.collection()`, `.collectionGroup()`, or custom collection reference functions
- Supports custom collection reference functions (e.g., `templateCollRef()`, `passportCollRef()`)
- Ignores pagination methods (`limit`, `offset`, `startAt`, etc.) that don't affect index requirements
- Validates queries with multiple `where()` clauses and/or `orderBy()` operations
- Checks for array-contains operations that require special index configuration

## Requirements

This plugin requires:
- **ESLint**: ≥8.0.0
- **Node.js**: ≥14.0.0

## Installation

```bash
npm install --save-dev eslint-firestore-indexes
```

## Usage

1. **Create an `indexes.json` file** in your project root:

```json
{
  "indexes": [
    {
      "collectionGroup": "users",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "age", "order": "ASCENDING" },
        { "fieldPath": "name", "order": "ASCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

2. **Configure ESLint** in your `.eslintrc.js`:

```javascript
module.exports = {
  plugins: ['eslint-firestore-indexes'],
  rules: {
    'eslint-firestore-indexes/firestore-indexes': [
      'error',
      {
        indexesPath: 'indexes.json', // Path to your indexes file
      },
    ],
  },
};
```

Or for ESLint 9+ flat config (`eslint.config.js`):

```javascript
import firestoreIndexes from 'eslint-firestore-indexes';

export default [
  {
    plugins: {
      'firestore-indexes': firestoreIndexes,
    },
    rules: {
      'firestore-indexes/firestore-indexes': [
        'error',
        {
          indexesPath: 'indexes.json', // Path to your indexes file
        },
      ],
    },
  },
];
```

3. **Run ESLint** on your code:

```bash
npx eslint your-code.js
```

## Rule Details

This rule detects Firestore queries that require composite indexes and validates them against your `indexes.json` file.

### Examples of **incorrect** code:

```javascript
// Missing index for users collection with email and status fields
firestore.collection('users')
  .where('email', '==', 'test@example.com')
  .where('status', '==', 'active')
  .get();

// Missing index for orders with customerId and orderDate
firestore.collection('orders')
  .where('customerId', '==', '123')
  .orderBy('orderDate', 'desc')
  .get();
```

### Examples of **correct** code:

```javascript
// Single field query - no index needed
firestore.collection('users')
  .where('age', '>', 18)
  .get();

// Index exists in indexes.json
firestore.collection('users')
  .where('age', '>', 18)
  .where('name', '==', 'John')
  .get();
```

## Configuration

The rule accepts an options object with the following properties:

- `indexesPath` (string): Path to the indexes configuration file. Default: `'indexes.json'`

## Indexes File Format

The indexes file should follow the Firebase indexes export format:

```json
{
  "indexes": [
    {
      "collectionGroup": "collectionName",
      "queryScope": "COLLECTION",
      "fields": [
        {
          "fieldPath": "fieldName",
          "order": "ASCENDING"
        }
      ]
    }
  ],
  "fieldOverrides": []
}
```

## When are indexes required?

Firestore requires composite indexes for queries that:
- Use multiple `where()` clauses on different fields
- Combine `where()` with `orderBy()` on different fields
- Use multiple `orderBy()` clauses
- Use array-contains queries with other filters

Single field queries and simple equality checks typically don't require custom indexes.

### Index Merging Support

**Version 1.1.0+**: This plugin now supports Firestore's **Index Merging** feature! Queries that can use index merging will not trigger errors, even if no composite index is defined.

Firestore can satisfy some queries in two ways:

**1. Composite Indexes** (recommended for frequently-used queries):
- Explicit indexes defined in `firestore.indexes.json`
- Typically provide better performance
- Required for complex queries

**2. Index Merging** (automatic):
- Firestore automatically merges single-field indexes to satisfy certain queries
- **This plugin recognizes when index merging is available and will not report errors**
- Works when all of the following conditions are met:
  - All filters are equality (`==`) filters, OR
  - All filters except one are equality, with one inequality filter on a single field, OR
  - All filters except one are equality, with one `orderBy` clause
- Does **NOT** work for:
  - Multiple `orderBy` clauses
  - Multiple inequality filters on different fields
  - Inequality filter and `orderBy` on different fields
  - Array-contains queries combined with other filters (requires composite index)

**Examples that use index merging (no composite index needed):**
```javascript
// All equality filters
firestore.collection('users')
  .where('status', '==', 'active')
  .where('role', '==', 'admin')
  .where('verified', '==', true)
  .get();

// Equality filters + one inequality
firestore.collection('products')
  .where('category', '==', 'electronics')
  .where('price', '>', 100)
  .get();

// Equality filters + one orderBy
firestore.collection('posts')
  .where('status', '==', 'published')
  .where('author', '==', userId)
  .orderBy('createdAt', 'desc')
  .get();
```

**Examples that require composite indexes:**
```javascript
// Multiple orderBy clauses
firestore.collection('users')
  .orderBy('lastName', 'asc')
  .orderBy('firstName', 'asc')
  .get();

// Inequality + orderBy on different fields
firestore.collection('products')
  .where('price', '>', 100)
  .orderBy('rating', 'desc')
  .get();

// Multiple inequalities on different fields
firestore.collection('products')
  .where('price', '>', 100)
  .where('stock', '<', 10)
  .get();
```

### Important: Prefix Matching

Firestore indexes use **prefix matching**. This means:
- A query must match the index from the first field
- You cannot skip fields in the middle of an index
- Query `status == X AND category == Y` cannot use index `[organizationId, status, category]`
- Conditional queries that add/remove fields at the beginning need separate indexes for each pattern

**Example with conditional filters:**
```javascript
let query = firestore
  .collection('items')
  .where('status', '==', 'active')
  .where('category', '==', category)
  .orderBy('createdAt', 'desc')

if (organizationId) {
  query = query.where('organizationId', '==', organizationId)
}
```

This query requires **two separate indexes**:
1. Without `organizationId`: `[status, category, createdAt]`
2. With `organizationId`: `[status, category, organizationId, createdAt]` OR `[organizationId, status, category, createdAt]`

### Special Cases

- **Inequality queries** (`<`, `<=`, `>`, `>=`) must come after equality queries in the index
- **Multiple inequality queries** on the same field are allowed (e.g., `score >= X AND score <= Y`)
- **Array-contains queries** require `arrayConfig: "CONTAINS"` in the index configuration

## Development

### Running Tests

```bash
npm test
```

### Running Linter

```bash
npm run lint
```

## Examples

Check the `examples/` directory for sample code and configuration:

- `examples/indexes.json` - Sample indexes configuration
- `examples/valid-queries.js` - Examples of queries with proper indexes
- `examples/invalid-queries.js` - Examples of queries missing indexes

## Limitations

This ESLint rule has some limitations:

1. **Dynamic queries**: Cannot detect queries built dynamically at runtime
2. **Conditional logic**: May have false positives/negatives with complex conditional queries
3. **Cross-file queries**: Queries built across multiple functions may not be fully detected
4. **Query helpers**: Custom query helper functions may need special handling
5. **Performance implications**: The rule allows queries that use index merging, but these may have different performance characteristics than composite indexes. Consider creating composite indexes for frequently-used queries even when index merging is available.

## References

- [Firestore Index Documentation](https://firebase.google.com/docs/firestore/query-data/indexes)
- [Firestore Index Overview (includes index merging)](https://firebase.google.com/docs/firestore/query-data/index-overview)

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
