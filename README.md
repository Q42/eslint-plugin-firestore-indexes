# eslint-firestore-indexes

[![Test](https://github.com/Q42/eslint-firestore-indexes/actions/workflows/test.yml/badge.svg)](https://github.com/Q42/eslint-firestore-indexes/actions/workflows/test.yml)

Ensure Firestore indexes are created for each query in the codebase.

## Overview

This ESLint plugin helps you catch missing Firestore indexes at development time. It analyzes your code for Firestore queries and checks them against a configuration file (typically `indexes.json`) to ensure all required indexes are defined.

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

### Index Merging vs Composite Indexes

Firestore can satisfy some queries in two ways:

**1. Composite Indexes** (recommended for frequently-used queries):
- Explicit indexes defined in `firestore.indexes.json`
- Typically provide better performance
- Required for complex queries with inequality filters or multiple `orderBy` clauses

**2. Index Merging**:
- Firestore can merge existing single-field indexes to satisfy queries
- Only works with equality (`==`) filters and at most one `orderBy` clause
- Requires single-field indexes for each field used in the query
- May have performance implications compared to composite indexes

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
5. **Index merging detection**: The rule can check if single-field indexes exist, but cannot guarantee Firestore will use merging

## References

- [Firestore Index Documentation](https://firebase.google.com/docs/firestore/query-data/indexes)
- [Firestore Index Overview (includes index merging)](https://firebase.google.com/docs/firestore/query-data/index-overview)

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
