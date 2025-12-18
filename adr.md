# Firestore Index Validation ESLint Rule

## Status

Proposed

## Context

Firestore requires composite indexes for queries that:
- Use multiple `where()` clauses on different fields
- Use `orderBy()` in combination with `where()` clauses
- Use multiple `orderBy()` clauses
- Use array-contains queries with other filters

These indexes must be defined in `firestore.indexes.json` and deployed to Firebase. Missing indexes cause runtime errors that are difficult to catch during development.

### Example Problem Query

```typescript
// Example query with conditional filters
let query = firestore
  .collection('items')
  .where('status', '==', 'active')
  .where('category', '==', category)
  .orderBy('createdAt', 'desc')

if (organizationId) {
  query = query.where('organizationId', '==', organizationId)
}
```

This query can be satisfied in **two ways**: via composite indexes OR via **index merging** (if single-field indexes exist).

### Option 1: Composite Indexes (Current Approach)

**The key issue**: Even though `organizationId` is added **last** in the code (after `orderBy`), Firestore internally reorders equality filters to come before `orderBy`. However, **you cannot skip fields in the middle of an index** when using prefix matching.

1. **When `organizationId` is NOT provided**: Query is `status == X AND category == Y ORDER BY createdAt DESC`
   - Requires composite index: `[status, category, createdAt]` (must start with `status`)
   - **Cannot use** index `[status, category, organizationId, createdAt]` because it would need to skip `organizationId` in the middle

2. **When `organizationId` IS provided**: Query is `status == X AND category == Y AND organizationId == Z ORDER BY createdAt DESC`  
   - Can use composite index: `[status, category, organizationId, createdAt]` OR `[organizationId, status, category, createdAt]`

**Why two composite indexes?** 
- A query without `organizationId` cannot use an index that has `organizationId` anywhere in it (even at the end) because Firestore prefix matching requires matching fields consecutively from the start - you cannot skip a field in the middle.
- An index `[status, category, organizationId, createdAt]` would require the query to have `status`, then `category`, then `organizationId` - you can't skip `organizationId` and go straight to `createdAt` in the orderBy.

### Option 2: Index Merging (Alternative Approach)

Firestore supports **index merging** for queries with multiple equality (`==`) filters and an optional `orderBy` clause. Instead of requiring composite indexes, Firestore can merge existing single-field indexes.

**How it works:**
- For queries with multiple equality filters and `orderBy`, Firestore can combine single-field indexes
- Example: If single-field indexes exist for `status`, `category`, `organizationId`, and `createdAt`, Firestore can merge them to satisfy the query
- This eliminates the need for composite indexes in many cases

**For this query:**
1. **When `organizationId` is NOT provided**: `status == X AND category == Y ORDER BY createdAt DESC`
   - Could use index merging if single-field indexes exist for: `status`, `category`, and `createdAt`
   - No composite index needed if index merging is available

2. **When `organizationId` IS provided**: `status == X AND category == Y AND organizationId == Z ORDER BY createdAt DESC`
   - Could use index merging if single-field indexes exist for: `status`, `category`, `organizationId`, and `createdAt`
   - No composite index needed if index merging is available

**Limitations of index merging:**
- Only works with equality (`==`) filters, not inequality (`<`, `>`, `<=`, `>=`, `!=`)
- May not work with multiple `orderBy` clauses
- Performance may be better with composite indexes for frequently-used query patterns

## Decision

Create a custom ESLint rule that:
1. Detects Firestore queries with multiple fields or ordering
2. Extracts the query pattern (collection, where clauses, orderBy clauses)
3. Validates against `firestore.indexes.json` to ensure a matching index exists OR that index merging is possible
4. Reports errors when neither composite indexes nor index merging is available

## Implementation Plan

### Phase 1: Query Pattern Detection

The rule should parse TypeScript AST to identify Firestore query patterns:

**Patterns to detect:**
- Firestore collection references (e.g., `firestore.collection()`, `firestore.collectionGroup()`, or custom collection methods)
- Chained `.where(field, operator, value)` calls
- Chained `.orderBy(field, direction)` calls
- Conditional where clauses (e.g., `if (condition) query = query.where(...)`)

**Collection identification:**
- Extract collection name from method calls like `collectionRef()`, `collectionGroupRef()`, or custom collection methods
- Map to `collectionGroup` in `firestore.indexes.json`

**Query extraction:**
- Track all `where()` clauses with field path, operator, and value type
- Track all `orderBy()` clauses with field path and direction
- Handle conditional queries (e.g., optional `organizationId` filter)

### Phase 2: Index Matching Logic

**Index structure in firestore.indexes.json:**
```json
{
  "collectionGroup": "items",
  "fields": [
    { "fieldPath": "organizationId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "category", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" },
    { "fieldPath": "__name__", "order": "DESCENDING" }
  ]
}
```

**Matching rules:**

**For Composite Indexes:**
1. Collection group must match
2. All query fields must be present in the index (in order)
3. Field order matters: equality filters first, then inequality/range, then orderBy
4. Array-contains queries require `arrayConfig: "CONTAINS"` in index
5. `__name__` is always appended by Firestore, so ignore it in matching
6. **Prefix matching**: Queries must match the index from the first field. A query without `organizationId` cannot use an index starting with `organizationId`
7. Handle optional fields (e.g., conditional `organizationId`) - requires separate indexes for each query pattern

**For Index Merging:**
1. Query must only use equality (`==`) filters (no inequality filters)
2. Query can have at most one `orderBy` clause
3. Check if single-field indexes exist for each equality filter field
4. Check if a single-field index exists for the `orderBy` field (if present)
5. If all required single-field indexes exist, index merging is possible and no composite index is needed
6. Note: Index merging may have performance implications - composite indexes are typically faster for frequently-used queries

**Special cases:**
- Inequality queries (`<`, `<=`, `>`, `>=`) must come after equality queries
- Multiple inequality queries on the same field are allowed (e.g., `score >= X AND score <= Y`)
- Soft-delete filters (e.g., `deletedAt`, `archivedAt`) are common and may be handled specially
- **Prefix matching requirement**: Firestore indexes use prefix matching. A query must match the index from the first field. This means:
  - Query `status == X AND category == Y` cannot use index `[organizationId, status, category]`
  - Query `organizationId == X AND status == Y` cannot use index `[status, category]`
  - Each unique query pattern (with different starting fields) requires its own index
  - Conditional queries that add/remove fields at the beginning need separate indexes for each pattern
- **Index merging eligibility**: 
  - Only applies to queries with equality (`==`) filters
  - Works with optional `orderBy` clause
  - Does NOT work with inequality filters, `!=`, or multiple `orderBy` clauses
  - Requires single-field indexes for each field used in the query

### Phase 3: Rule Implementation

**ESLint Rule Structure:**
```typescript
// eslint-plugin-firestore-index/index.ts
export const firestoreIndexRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ensure Firestore queries have corresponding indexes',
    },
    schema: [
      {
        type: 'object',
        properties: {
          indexFile: { type: 'string' }, // path to firestore.indexes.json
        },
      },
    ],
  },
  create(context) {
    // 1. Load and parse firestore.indexes.json
    // 2. Traverse AST for Firestore query patterns
    // 3. Extract query details
    // 4. Check for composite index match OR index merging eligibility
    // 5. Report missing indexes only if neither composite index nor index merging is available
  },
}
```

**AST Traversal:**
- Use ESLint's `CallExpression` visitor
- Identify Firestore collection reference calls (e.g., `firestore.collection()`, `firestore.collectionGroup()`, or custom collection methods)
- Track chained method calls (`.where()`, `.orderBy()`)
- Handle variable reassignments (e.g., `query = query.where(...)`)

**Query Pattern Examples:**

```typescript
// Simple case
firestore.collection('items')
  .where('status', '==', 'active')
  .orderBy('createdAt', 'desc')

// Conditional
let query = firestore.collection('items')
if (organizationId) {
  query = query.where('organizationId', '==', organizationId)
}
query = query.where('status', '==', 'active')

// Array contains
firestore.collection('items')
  .where('tags', 'array-contains', tag)
  .orderBy('updatedAt', 'desc')
```

### Phase 4: Error Reporting

**Error messages should include:**
- File location and line number
- Collection name
- Required index fields
- Suggested solutions (composite index OR single-field indexes for index merging)
- Suggested index definition (JSON snippet)
- Link to Firebase console for index creation

**Example error (when neither composite index nor index merging is available):**
```
Missing Firestore index for query at items.ts:42
Collection: items
Required fields: organizationId (ASC), status (ASC), category (ASC), createdAt (DESC)

Option 1 - Composite Index (recommended for frequently-used queries):
Add to firestore.indexes.json:
{
  "collectionGroup": "items",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "organizationId", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "category", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" },
    { "fieldPath": "__name__", "order": "DESCENDING" }
  ]
}

Option 2 - Index Merging (if query only uses equality filters):
Ensure single-field indexes exist for: organizationId, status, category, createdAt
```

**Example warning (when index merging is possible but composite index doesn't exist):**
```
Query at items.ts:42 can use index merging (single-field indexes exist)
Collection: items
Consider creating a composite index for better performance:
[status, category, createdAt] or [organizationId, status, category, createdAt]
```

## Limitations

1. **Dynamic queries**: Cannot detect queries built dynamically at runtime
2. **Conditional logic**: May have false positives/negatives with complex conditional queries
3. **Cross-file queries**: Queries built across multiple functions may not be fully detected
4. **Query helpers**: Custom query helper functions (e.g., `queryHelpers.where()`) may need special handling
5. **Index density**: Cannot validate `SPARSE_ALL` vs `SPARSE` density requirements
6. **Index merging detection**: Determining if index merging is actually used by Firestore may be difficult - the rule can check if single-field indexes exist, but cannot guarantee Firestore will use merging (Firestore may prefer composite indexes for performance)
7. **Single-field index detection**: Need to check `fieldOverrides` section in `firestore.indexes.json` for single-field indexes, not just composite indexes

## Alternatives Considered

### 1. Runtime Validation
- **Pros**: Catches all cases, including dynamic queries
- **Cons**: Only fails at runtime, harder to debug, requires test coverage

### 2. TypeScript Type System
- **Pros**: Compile-time safety
- **Cons**: Very complex to implement, limited by TypeScript's type system

### 3. Pre-commit Hooks
- **Pros**: Catches issues before commit
- **Cons**: Doesn't provide IDE feedback, can be bypassed

### 4. Manual Documentation
- **Pros**: Simple, no tooling needed
- **Cons**: Easy to forget, no enforcement

## Implementation Steps

1. **Create ESLint plugin structure**
   - Set up `eslint-plugin-firestore-index` package
   - Define rule structure and configuration

2. **Implement AST parser**
   - Parse Firestore query builder patterns
   - Extract collection, where, and orderBy clauses
   - Handle conditional queries

3. **Implement index matcher**
   - Load and parse `firestore.indexes.json`
   - Match query patterns to composite indexes
   - Check for index merging eligibility (single-field indexes in `fieldOverrides` section)
   - Handle edge cases (optional fields, array-contains, etc.)
   - Prioritize composite index matches over index merging (composite indexes are typically faster)

4. **Add to project**
   - Install plugin in project's `package.json`
   - Configure in ESLint configuration file (e.g., `.eslintrc.js`, `.eslintrc.json`, or `eslint.config.js`)
   - Add to CI/CD pipeline

5. **Test and refine**
   - Test against existing queries
   - Fix false positives/negatives
   - Document edge cases

## Testing Strategy

1. **Unit tests**: Test query pattern extraction and index matching logic
2. **Integration tests**: Test against real codebase queries
3. **Regression tests**: Ensure existing valid queries don't trigger false positives

## Future Enhancements

1. **Auto-fix**: Suggest and apply index definitions automatically
2. **Index cleanup**: Detect unused indexes in `firestore.indexes.json`
3. **Query optimization**: Suggest more efficient query patterns
4. **Documentation generation**: Auto-generate index documentation

## References

- [Firestore Index Documentation](https://firebase.google.com/docs/firestore/query-data/indexes)
- [Firestore Index Overview (includes index merging)](https://firebase.google.com/docs/firestore/query-data/index-overview)
- [ESLint Custom Rules](https://eslint.org/docs/latest/developer-guide/working-with-rules)
- [TypeScript AST Explorer](https://astexplorer.net/)

