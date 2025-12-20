/**
 * @fileoverview Ensure Firestore indexes are created for each query in the codebase
 * @author Q42
 */
'use strict';

const fs = require('fs');
const path = require('path');

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

/**
 * @type {import('eslint').Rule.RuleModule}
 */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Ensure Firestore indexes are created for each query in the codebase',
      category: 'Best Practices',
      recommended: true,
      url: 'https://github.com/Q42/eslint-firestore-indexes',
    },
    fixable: null,
    schema: [
      {
        type: 'object',
        properties: {
          indexesPath: {
            type: 'string',
            default: 'indexes.json',
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      missingIndex: 'Firestore query on collection "{{collection}}" with filters {{filters}} is missing a required index. Add it to {{indexesPath}}',
      invalidIndexFile: 'Could not load indexes file at {{indexesPath}}: {{error}}',
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const indexesPath = options.indexesPath || 'indexes.json';
    
    let indexes = null;
    
    // Load indexes configuration
    try {
      const cwd = context.getCwd ? context.getCwd() : process.cwd();
      const fullPath = path.resolve(cwd, indexesPath);
      
      // Try to read the file directly without checking existence first
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        indexes = JSON.parse(content);
      } catch (readError) {
        // File doesn't exist or can't be read, use empty indexes
        indexes = { indexes: [] };
      }
    } catch (error) {
      context.report({
        loc: { line: 1, column: 0 },
        messageId: 'invalidIndexFile',
        data: {
          indexesPath,
          error: error.message,
        },
      });
      return {};
    }

    /**
     * Check if query can use index merging
     * Index merging works when:
     * - All filters are equality (==) filters, OR
     * - All filters except one are equality, and there's one inequality on a single field, OR
     * - All filters except one are equality, and there's one orderBy
     * 
     * Index merging does NOT work for:
     * - Multiple orderBy clauses
     * - Multiple inequality filters on different fields
     * - Inequality filter and orderBy on different fields
     * - Array-contains queries (these require specific indexes)
     * 
     * @param {Array} queryFields - Array of field objects with field name and operator
     * @returns {boolean}
     */
    function canUseIndexMerging(queryFields) {
      const equalityFilters = queryFields.filter(f => f.operator === '==');
      const inequalityFilters = queryFields.filter(f => 
        f.operator === '<' || f.operator === '<=' || f.operator === '>' || f.operator === '>='
      );
      const orderByFields = queryFields.filter(f => f.operator === 'orderBy');
      const arrayContainsFilters = queryFields.filter(f => 
        f.operator === 'array-contains' || f.operator === 'array-contains-any'
      );

      // Array-contains queries cannot use index merging
      if (arrayContainsFilters.length > 0) {
        return false;
      }

      // Multiple orderBy clauses cannot use index merging
      if (orderByFields.length > 1) {
        return false;
      }

      // Multiple inequality filters - need to check if they're on the same field
      if (inequalityFilters.length > 1) {
        const inequalityFieldNames = inequalityFilters.map(f => f.field);
        const uniqueFields = new Set(inequalityFieldNames);
        // Only allow if all inequalities are on the same field (e.g., price >= 10 AND price <= 100)
        if (uniqueFields.size > 1) {
          return false;
        }
        // If all on same field and no orderBy, this can work with index merging
        if (orderByFields.length === 0) {
          return true;
        }
        // If there's an orderBy, it must be on the same field as the inequality
        const inequalityField = inequalityFieldNames[0];
        const orderByField = orderByFields[0].field;
        return inequalityField === orderByField;
      }

      // One inequality + one orderBy - they must be on the same field for index merging
      if (inequalityFilters.length === 1 && orderByFields.length === 1) {
        const inequalityField = inequalityFilters[0].field;
        const orderByField = orderByFields[0].field;
        return inequalityField === orderByField;
      }

      // All equality filters - can use index merging
      if (queryFields.length === equalityFilters.length) {
        return true;
      }

      // Equality filters + one inequality (no orderBy) - can use index merging
      if (inequalityFilters.length === 1 && orderByFields.length === 0) {
        return true;
      }
      
      // Equality filters + one orderBy (no inequality) - can use index merging
      if (orderByFields.length === 1 && inequalityFilters.length === 0) {
        return true;
      }

      return false;
    }

    /**
     * Check if an index exists for the given query
     * @param {string} collection - Collection name
     * @param {Array} queryFields - Array of field objects with field name and operator
     * @returns {boolean}
     */
    function hasIndex(collection, queryFields) {
      if (!indexes || !indexes.indexes) {
        return false;
      }

      // Check if query can use index merging
      if (canUseIndexMerging(queryFields)) {
        // For index merging, Firestore automatically creates single-field indexes
        // for all fields, so these queries will work
        return true;
      }

      // Check for composite indexes
      const result = indexes.indexes.some(index => {
        if (index.collectionGroup !== collection && index.collectionId !== collection) {
          return false;
        }

        // Check if index fields match query fields
        const indexFields = index.fields || [];
        
        // For simple queries, just check if fields are included
        if (queryFields.length === 0) {
          return true; // No special index needed for simple queries
        }

        // Filter out __name__ field from index fields as it's automatically added by Firestore
        const relevantIndexFields = indexFields.filter(f => f.fieldPath !== '__name__');
        
        // Separate query fields by type
        const equalityQueryFields = queryFields.filter(f => f.operator === '==');
        const inequalityQueryFields = queryFields.filter(f => 
          f.operator === '<' || f.operator === '<=' || f.operator === '>' || f.operator === '>='
        );
        const orderByQueryFields = queryFields.filter(f => f.operator === 'orderBy');
        const arrayContainsQueryFields = queryFields.filter(f => 
          f.operator === 'array-contains' || f.operator === 'array-contains-any'
        );

        // Firestore index matching rules:
        // 1. Index must be a prefix match - we need to match from the beginning
        // 2. Equality and array-contains filters can be in any order at the beginning
        // 3. After equality/array-contains filters, inequality/orderBy fields must match exactly
        // 4. Array-contains fields need arrayConfig: "CONTAINS"

        // Check for array-contains queries - they need special arrayConfig
        for (const queryField of arrayContainsQueryFields) {
          const matchingIndexField = relevantIndexFields.find(idxf => idxf.fieldPath === queryField.field);
          if (!matchingIndexField || matchingIndexField.arrayConfig !== 'CONTAINS') {
            return false;
          }
        }

        // Build expected field sequence for query
        // Equality and array-contains filters (in query order, but could match in any order in index)
        const equalityFieldNames = [...equalityQueryFields.map(f => f.field), ...arrayContainsQueryFields.map(f => f.field)];
        // Inequality fields (must match in order)
        const inequalityFieldNames = inequalityQueryFields.map(f => f.field);
        // OrderBy fields (must match in order)
        const orderByFieldNames = orderByQueryFields.map(f => f.field);

        // Get index field names
        const indexFieldNames = relevantIndexFields.map(f => f.fieldPath);

        // Check if index matches the query with prefix matching
        // The index must start with all the query fields (in the right order)
        
        // First, check if all query fields are present in the index
        const allQueryFields = [...equalityFieldNames, ...inequalityFieldNames, ...orderByFieldNames];
        if (!allQueryFields.every(qf => indexFieldNames.includes(qf))) {
          return false;
        }

        // Now check prefix matching:
        // 1. All equality/array-contains fields from query must be present in the index
        //    (can be in any order, but must come before inequality/orderBy fields)
        // 2. After all equality/array-contains fields in the index, 
        //    inequality/orderBy fields from the query must match in order

        // Find where equality fields end in the index
        let indexPos = 0;
        const indexEqualityFields = new Set();
        
        // Collect all equality/array-contains fields at the start of the index
        while (indexPos < indexFieldNames.length) {
          const indexField = indexFieldNames[indexPos];
          const indexFieldDef = relevantIndexFields[indexPos];
          
          // Check if this is an equality-type field (has no order or has arrayConfig)
          // In Firestore, equality fields don't have a specific direction requirement
          // and array-contains fields have arrayConfig set
          const isEqualityField = indexFieldDef.arrayConfig === 'CONTAINS' || 
                                   equalityFieldNames.includes(indexField);
          
          if (isEqualityField) {
            indexEqualityFields.add(indexField);
            indexPos++;
          } else {
            // We've reached the inequality/orderBy section
            break;
          }
        }

        // Check that all equality fields from query are present in the index equality section
        for (const eqField of equalityFieldNames) {
          if (!indexEqualityFields.has(eqField)) {
            return false;
          }
        }

        // Match inequality/orderBy fields - they must be in order after equality fields
        const rangeFields = [...inequalityFieldNames, ...orderByFieldNames];
        for (const rangeField of rangeFields) {
          if (indexPos >= indexFieldNames.length || indexFieldNames[indexPos] !== rangeField) {
            return false;
          }
          indexPos++;
        }
        
        return true;
      });
      
      // Uncomment for debugging:
      // if (!result) {
      //   console.log('No index found for', collection, queryFields.map(f => f.field));
      //   console.log('Available indexes:', indexes.indexes.map(idx => ({
      //     coll: idx.collectionGroup,
      //     fields: idx.fields.map(f => f.fieldPath)
      //   })));
      // }
      
      return result;
    }

    /**
     * Extract query information from entire call chain
     * Walks backward from any node to find collection and all query operations
     */
    function analyzeCallChain(node) {
      const queryFields = [];
      let collection = null;
      let currentNode = node;

      // Walk backwards through the call chain
      while (currentNode && currentNode.type === 'CallExpression') {
        if (currentNode.callee && currentNode.callee.type === 'MemberExpression') {
          const methodName = currentNode.callee.property.name;
          
          // Skip methods that don't affect index requirements
          if (methodName === 'limit' || methodName === 'offset' || methodName === 'startAt' || 
              methodName === 'startAfter' || methodName === 'endAt' || methodName === 'endBefore') {
            // These methods don't affect index requirements, continue walking the chain
            currentNode = currentNode.callee.object;
            continue;
          }
          
          if (methodName === 'where' && currentNode.arguments.length >= 2) {
            const fieldArg = currentNode.arguments[0];
            const operatorArg = currentNode.arguments[1];
            
            if (fieldArg.type === 'Literal') {
              queryFields.unshift({
                field: fieldArg.value,
                operator: operatorArg.type === 'Literal' ? operatorArg.value : 'unknown',
              });
            }
          } else if (methodName === 'orderBy' && currentNode.arguments.length >= 1) {
            const fieldArg = currentNode.arguments[0];
            const directionArg = currentNode.arguments[1];
            
            if (fieldArg.type === 'Literal') {
              const direction = directionArg && directionArg.type === 'Literal' 
                ? (directionArg.value === 'desc' ? 'DESCENDING' : 'ASCENDING')
                : 'ASCENDING';
              
              queryFields.unshift({
                field: fieldArg.value,
                operator: 'orderBy',
                order: direction,
              });
            }
          } else if ((methodName === 'collection' || methodName === 'collectionGroup') && currentNode.arguments.length > 0) {
            if (currentNode.arguments[0].type === 'Literal') {
              collection = currentNode.arguments[0].value;
            }
            break; // Stop at collection()
          } else if (methodName.endsWith('CollRef') || methodName.endsWith('CollectionRef') || methodName.endsWith('Ref')) {
            // Custom collection reference functions like templateCollRef(), passportCollRef()
            // Extract collection name from method name (e.g., templateCollRef -> templates)
            const collectionName = methodName
              .replace(/CollRef$/, '')
              .replace(/CollectionRef$/, '')
              .replace(/Ref$/, '');
            
            // Convert camelCase to lowercase and add 's' if not already plural
            collection = collectionName.charAt(0).toLowerCase() + collectionName.slice(1);
            if (!collection.endsWith('s')) {
              collection += 's';
            }
            break; // Stop at custom collection reference
          }
          
          // Move to the object being called on
          currentNode = currentNode.callee.object;
        } else {
          break;
        }
      }

      return { collection, queryFields };
    }

    // Track query chains we've already reported
    const reportedQueries = new Set();

    return {
      // Detect queries by looking at .get(), .onSnapshot(), etc calls
      CallExpression(node) {
        // Look for terminal query methods
        if (
          node.callee.type === 'MemberExpression' &&
          (node.callee.property.name === 'get' || 
           node.callee.property.name === 'onSnapshot' ||
           node.callee.property.name === 'count')
        ) {
          // Analyze the entire chain leading to this call
          const { collection, queryFields } = analyzeCallChain(node.callee.object);
          
          if (collection && (queryFields.length > 1 || queryFields.some(f => f.operator === 'orderBy'))) {
            // Create a unique key for this query to avoid duplicate reports
            const queryKey = `${collection}:${queryFields.map(f => `${f.field}:${f.operator}`).join(',')}`;
            
            if (!reportedQueries.has(queryKey) && !hasIndex(collection, queryFields)) {
              reportedQueries.add(queryKey);
              const filters = queryFields.map(f => `${f.field} (${f.operator})`).join(', ');
              context.report({
                node,
                messageId: 'missingIndex',
                data: {
                  collection,
                  filters,
                  indexesPath,
                },
              });
            }
          }
        }
      },
    };
  },
};
