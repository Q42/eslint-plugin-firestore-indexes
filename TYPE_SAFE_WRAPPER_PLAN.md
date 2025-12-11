# Type-Safe Firestore Index Wrapper: Alternative to ESLint Linting

## Executive Summary

This document outlines a comprehensive plan for creating a **type-safe wrapper** around Firestore collections that enforces index requirements at compile-time using TypeScript's advanced type system. Instead of using ESLint to detect missing indexes after code is written, this approach makes it **impossible to compile queries without matching indexes**, providing stronger guarantees and earlier feedback in the development cycle.

## Motivation

### Current Approach: ESLint Rule
- **Reactive**: Detects issues after code is written
- **Requires running the linter**: Can be skipped or ignored
- **Limited enforcement**: Can't prevent runtime issues if linter is bypassed
- **Configuration drift**: Indexes and code can get out of sync

### Proposed Approach: Type-Safe Wrapper
- **Proactive**: Prevents invalid queries from being written
- **Compile-time enforcement**: TypeScript compiler enforces constraints
- **Zero runtime overhead**: All checks happen at compile-time
- **Self-documenting**: Index definitions are part of the collection schema
- **IDE support**: Autocomplete and error highlighting in real-time

## Core Concept

The key insight is to encode Firestore indexes as **TypeScript types** and use **higher-order types** to validate query operations against these index definitions. The Firestore query builder pattern can be modeled using **conditional types** and **mapped types** to accumulate query constraints and validate them against available indexes.

## Architecture Overview

### 1. Index Definition Layer

Define indexes as TypeScript types that describe the fields and their sort orders:

```typescript
// Index definition types
type SortDirection = 'asc' | 'desc';

type IndexField<Field extends string, Direction extends SortDirection> = {
  field: Field;
  direction: Direction;
};

type Index<Fields extends readonly IndexField<string, SortDirection>[]> = {
  fields: Fields;
};

// Collection-specific index definitions
type UserIndex = 
  | Index<[IndexField<'age', 'asc'>, IndexField<'name', 'asc'>]>
  | Index<[IndexField<'email', 'asc'>]>
  | Index<[IndexField<'createdAt', 'desc'>, IndexField<'status', 'asc'>]>;
```

### 2. Query State Tracking Layer

Track the current query state using TypeScript types as queries are built:

```typescript
// Query state accumulated through the builder pattern
type QueryState<
  TData,
  TIndexes extends Index<any>[],
  TWhere extends WhereConstraint<TData>[] = [],
  TOrderBy extends OrderByConstraint<TData>[] = []
> = {
  data: TData;
  indexes: TIndexes;
  whereConstraints: TWhere;
  orderByConstraints: TOrderBy;
};

type WhereConstraint<TData> = {
  field: keyof TData & string;
  operator: WhereOperator;
  value: any;
};

type OrderByConstraint<TData> = {
  field: keyof TData & string;
  direction: SortDirection;
};
```

### 3. Index Validation Layer

Use conditional types to validate that the accumulated query state matches an available index:

```typescript
// Check if a query requires an index
type RequiresIndex<
  TWhere extends WhereConstraint<any>[],
  TOrderBy extends OrderByConstraint<any>[]
> = 
  // Complex queries with multiple orderBy or range filters need indexes
  TOrderBy['length'] extends 0 | 1
    ? TWhere extends [] ? false : HasRangeOrInequality<TWhere>
    : true;

// Validate that an index exists for the query
type ValidateIndexExists<
  TState extends QueryState<any, any, any, any>,
  TIndexes extends Index<any>[]
> = RequiresIndex<TState['whereConstraints'], TState['orderByConstraints']> extends true
  ? IndexMatches<TState, TIndexes> extends true
    ? true
    : ['ERROR: No matching index found for this query. Required fields:', ExtractRequiredFields<TState>]
  : true;

// Check if any index in the list matches the query requirements
type IndexMatches<TState, TIndexes extends Index<any>[]> = 
  TIndexes extends [infer First extends Index<any>, ...infer Rest extends Index<any>[]]
    ? SingleIndexMatches<TState, First> extends true
      ? true
      : IndexMatches<TState, Rest>
    : false;
```

### 4. Query Builder Wrapper Layer

Create a wrapped query builder that accumulates state and validates indexes:

```typescript
class TypedQuery<TState extends QueryState<any, any, any, any>> {
  constructor(
    private state: TState,
    private firestoreQuery: FirestoreQuery<TState['data']>
  ) {}

  // Where clause adds constraint to state
  where<
    TField extends keyof TState['data'] & string,
    TOp extends WhereOperator,
    TValue
  >(
    field: TField,
    operator: TOp,
    value: TValue
  ): TypedQuery<{
    data: TState['data'];
    indexes: TState['indexes'];
    whereConstraints: [...TState['whereConstraints'], WhereConstraint<TState['data']>];
    orderByConstraints: TState['orderByConstraints'];
  }> {
    return new TypedQuery(
      {
        ...this.state,
        whereConstraints: [...this.state.whereConstraints, { field, operator, value }]
      },
      this.firestoreQuery.where(field, operator, value)
    );
  }

  // OrderBy adds constraint to state
  orderBy<
    TField extends keyof TState['data'] & string,
    TDirection extends SortDirection
  >(
    field: TField,
    direction: TDirection = 'asc' as TDirection
  ): TypedQuery<{
    data: TState['data'];
    indexes: TState['indexes'];
    whereConstraints: TState['whereConstraints'];
    orderByConstraints: [...TState['orderByConstraints'], OrderByConstraint<TState['data']>];
  }> {
    return new TypedQuery(
      {
        ...this.state,
        orderByConstraints: [...this.state.orderByConstraints, { field, direction }]
      },
      this.firestoreQuery.orderBy(field, direction)
    );
  }

  // Get executes only if index validation passes
  get<
    TValidation = ValidateIndexExists<TState, TState['indexes']>
  >(
    ...args: TValidation extends true ? [] : [TValidation]
  ): Promise<QuerySnapshot<TState['data']>> {
    // TypeScript ensures this only compiles with valid indexes
    return this.firestoreQuery.get();
  }
}
```

### 5. Collection Wrapper

Create a wrapper function to initialize typed collections with their indexes:

```typescript
function typedCollection<
  TData,
  TIndexes extends Index<any>[]
>(
  collectionRef: CollectionReference<TData>,
  indexes: TIndexes
): TypedCollectionReference<TData, TIndexes> {
  return {
    doc: (id?: string) => collectionRef.doc(id),
    
    query: (): TypedQuery<{
      data: TData;
      indexes: TIndexes;
      whereConstraints: [];
      orderByConstraints: [];
    }> => {
      return new TypedQuery(
        {
          data: {} as TData,
          indexes,
          whereConstraints: [],
          orderByConstraints: []
        },
        collectionRef
      );
    },
    
    // Direct access to underlying collection for cases where type safety can be bypassed
    unsafe: () => collectionRef
  };
}
```

## Implementation Strategy

### Phase 1: Core Type System (Week 1-2)
1. Define index representation types
2. Create query state tracking types
3. Implement basic index validation logic
4. Build prototype with simple equality queries

### Phase 2: Advanced Query Support (Week 3-4)
1. Add support for range queries (`>`, `<`, `>=`, `<=`)
2. Implement `in` and `array-contains` operators
3. Handle composite indexes with multiple fields
4. Support `startAt`, `endAt`, `limit` operations

### Phase 3: Complex Validation Logic (Week 5-6)
1. Implement Firestore's index selection algorithm
2. Handle inequality filters and orderBy interactions
3. Support array membership queries
4. Add validation for single-field vs composite indexes

### Phase 4: Developer Experience (Week 7-8)
1. Create helper utilities for index definition
2. Implement better error messages using conditional types
3. Add migration utilities from existing code
4. Create documentation and examples

### Phase 5: Real-world Integration (Week 9-10)
1. Test with production codebases
2. Handle edge cases discovered in testing
3. Optimize type computation performance
4. Create best practices guide

## Technical Challenges and Solutions

### Challenge 1: TypeScript's Type System Limitations

**Problem**: TypeScript's type system operates at compile-time and has limitations in expressing complex runtime logic.

**Solution**: 
- Use recursive conditional types for iterative checking
- Leverage template literal types for better error messages
- Accept some limitations and provide "unsafe" escape hatches for edge cases

### Challenge 2: Builder Pattern State Accumulation

**Problem**: Each method call in the builder pattern needs to carry forward accumulated state.

**Solution**:
- Use generic type parameters to thread state through method chains
- Employ tuple types to accumulate constraints as arrays
- Use intersection types to merge new constraints with existing state

### Challenge 3: Complex Index Matching Logic

**Problem**: Firestore's index selection algorithm is complex with many rules.

**Solution**:
- Start with subset of most common cases (composite indexes with orderBy)
- Incrementally add support for more complex scenarios
- Document known limitations and provide override mechanisms
- Use type-level recursion to check multiple possible indexes

### Challenge 4: Type Computation Performance

**Problem**: Complex type computations can slow down TypeScript compiler and IDE.

**Solution**:
- Cache intermediate type computations
- Limit maximum query complexity (e.g., max 5 orderBy clauses)
- Provide simplified mode for large codebases
- Use `// @ts-expect-error` with comments for extreme edge cases

### Challenge 5: Error Message Clarity

**Problem**: TypeScript's error messages for complex type failures can be cryptic.

**Solution**:
```typescript
// Use branded types for better error messages
type IndexError<Message extends string> = { __error: Message; __brand: 'IndexError' };

// Create descriptive error types
type NoMatchingIndex = IndexError<'No index found matching query constraints'>;
type MissingIndexFields<Fields extends string[]> = IndexError<`Missing index on fields: ${Fields[number]}`>;

// Use conditional types to produce helpful errors
type ValidateOrError<TState> = 
  IndexMatches<TState> extends true 
    ? TState 
    : NoMatchingIndex;
```

## Example Usage

### Defining a Collection with Indexes

```typescript
// Define your data model
interface User {
  id: string;
  email: string;
  age: number;
  name: string;
  status: 'active' | 'inactive';
  createdAt: Timestamp;
}

// Define available indexes
const userIndexes = [
  { fields: [{ field: 'age', direction: 'asc' as const }, { field: 'name', direction: 'asc' as const }] },
  { fields: [{ field: 'email', direction: 'asc' as const }] },
  { fields: [{ field: 'createdAt', direction: 'desc' as const }, { field: 'status', direction: 'asc' as const }] },
] as const;

// Create typed collection
const users = typedCollection<User, typeof userIndexes>(
  firestore.collection('users'),
  userIndexes
);
```

### Valid Queries (Compile Successfully)

```typescript
// ✅ Single field orderBy - no index needed
const query1 = await users
  .query()
  .orderBy('age')
  .get();

// ✅ Matches the age + name composite index
const query2 = await users
  .query()
  .orderBy('age', 'asc')
  .orderBy('name', 'asc')
  .get();

// ✅ Simple equality query - no index needed
const query3 = await users
  .query()
  .where('email', '==', 'test@example.com')
  .get();

// ✅ Matches createdAt + status index
const query4 = await users
  .query()
  .orderBy('createdAt', 'desc')
  .orderBy('status', 'asc')
  .get();
```

### Invalid Queries (Compilation Errors)

```typescript
// ❌ No matching index for this combination
const query5 = await users
  .query()
  .orderBy('age', 'desc')  // Different direction than indexed
  .orderBy('name', 'asc')
  .get();
// Error: No matching index found for this query

// ❌ No index for status + age combination
const query6 = await users
  .query()
  .orderBy('status')
  .orderBy('age')
  .get();
// Error: Required fields: ['status', 'age']. Available indexes: [...]

// ❌ Range query with orderBy on different field needs index
const query7 = await users
  .query()
  .where('age', '>', 18)
  .orderBy('name')
  .get();
// Error: Range queries with orderBy require composite index
```

### Using the Escape Hatch

```typescript
// For rare edge cases, bypass type checking
const query8 = await users
  .unsafe()
  .where('someField', '>', 100)
  .orderBy('otherField')
  .get();
// No type checking, use with caution
```

## Comparison with ESLint Approach

| Aspect | ESLint Rule | Type-Safe Wrapper |
|--------|-------------|-------------------|
| **Enforcement Timing** | Post-write (linting phase) | During-write (compilation) |
| **Can be bypassed** | Yes (skip linting, disable rule) | No (unless using unsafe) |
| **IDE Integration** | Requires ESLint extension | Native TypeScript support |
| **Error Feedback** | After save/lint run | Real-time as you type |
| **Learning Curve** | Low (just add plugin) | Medium (new API to learn) |
| **Migration Effort** | Low (add config) | High (rewrite queries) |
| **Type Safety** | None | Full type safety |
| **Runtime Overhead** | None | None (types erased) |
| **Flexibility** | High (regex patterns) | Medium (type system limits) |
| **Index Management** | Separate from code | Coupled with code |
| **Accuracy** | Depends on rule quality | 100% (if implemented correctly) |

## Advantages

1. **Impossible to write invalid queries**: Compile-time enforcement prevents bugs before runtime
2. **Self-documenting**: Index definitions live alongside collection definitions
3. **Excellent IDE support**: Autocomplete shows only valid query combinations
4. **Zero runtime cost**: All validation happens at compile-time
5. **Refactoring safety**: Changing indexes automatically highlights affected queries
6. **Type inference**: Full type safety throughout query chain
7. **Early feedback**: Errors appear immediately while typing

## Disadvantages

1. **Higher learning curve**: Developers must learn new API
2. **Migration cost**: Existing code must be rewritten to use wrapper
3. **Type complexity**: Advanced TypeScript features may be difficult to maintain
4. **Compiler performance**: Complex type computations may slow IDE
5. **Inflexibility**: Some valid patterns may be difficult to express in type system
6. **TypeScript dependency**: Only works for TypeScript projects
7. **Library maintenance**: Requires keeping up with Firestore API changes

## Migration Path

For teams currently using Firestore directly:

### Step 1: Gradual Adoption
```typescript
// Old code continues to work
const oldQuery = firestore.collection('users').where('age', '>', 18);

// New code uses wrapper
const newQuery = typedCollection(firestore.collection('users'), indexes)
  .query()
  .where('age', '>', 18);
```

### Step 2: Automated Migration Tool
Create a codemod to automatically convert existing queries:
```bash
npx firestore-typed-wrapper-migrate src/**/*.ts
```

### Step 3: Coexistence Period
- Both approaches work in parallel
- Gradually migrate file by file
- Use unsafe() wrapper for complex edge cases during transition

### Step 4: Full Migration
- Remove direct Firestore imports
- Enforce typed wrapper usage through linting or code review
- Document all uses of unsafe() escape hatch

## Future Enhancements

1. **Auto-generate index files**: Tool to export Firestore indexes to TypeScript types
2. **Runtime validation mode**: Optional runtime checks for development
3. **GraphQL integration**: Generate GraphQL resolvers with built-in index validation
4. **Query optimizer**: Suggest better indexes based on actual queries
5. **Admin SDK integration**: Generate firestore.indexes.json from type definitions
6. **Multi-database support**: Handle different index sets per database
7. **Query plan visualization**: Show which index will be used for a query

## Proof of Concept

A minimal proof of concept can be implemented in ~500 lines of TypeScript to demonstrate:

1. Basic index definition types
2. Simple query builder with `where` and `orderBy`
3. Index validation for composite indexes
4. Error messages for missing indexes
5. Sample collection with 3-4 indexes

This POC would validate the core concept before investing in a full implementation.

## Conclusion

The type-safe wrapper approach offers **stronger guarantees** than ESLint linting by making invalid queries impossible to compile. While it requires more upfront investment and has a steeper learning curve, it provides significant long-term benefits:

- **Catch errors earlier**: At compile-time instead of runtime
- **Better developer experience**: Real-time feedback and autocomplete
- **Self-documenting code**: Index definitions are part of the type system
- **Refactoring confidence**: Type errors guide you through changes

This approach is best suited for:
- **TypeScript projects** with strict type checking
- **Teams willing to invest** in upfront migration
- **Projects where correctness** is critical
- **Codebases with frequent query changes** that benefit from type safety

For projects that need a lighter-weight solution or work in JavaScript, the ESLint rule approach remains valuable. Ideally, both approaches could coexist: use the type-safe wrapper for new code and the ESLint rule as a safety net for legacy code or edge cases.

## Next Steps

To move forward with this plan:

1. **Validate with stakeholders**: Confirm this approach aligns with project goals
2. **Build proof of concept**: 2-3 day spike to validate feasibility
3. **Performance testing**: Ensure type computation doesn't slow TypeScript
4. **Gather feedback**: Share POC with potential users
5. **Decide on scope**: Determine which Firestore features to support
6. **Plan implementation**: Break into concrete milestones with deliverables
