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
      
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        indexes = JSON.parse(content);
      } else {
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
     * Check if an index exists for the given query
     * @param {string} collection - Collection name
     * @param {Array} queryFields - Array of field objects with field name and operator
     * @returns {boolean}
     */
    function hasIndex(collection, queryFields) {
      if (!indexes || !indexes.indexes) {
        return false;
      }

      return indexes.indexes.some(index => {
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
        
        // Extract just the field names from query
        const queryFieldNames = queryFields.map(qf => qf.field);
        const indexFieldNames = relevantIndexFields.map(idxf => idxf.fieldPath);
        
        // Check if all query fields are present in the index
        // An index can cover a query if it contains all the query fields
        // Note: This is a simplified check - a full implementation would need to verify:
        // 1. Field order (equality filters before inequality before orderBy)
        // 2. Array config for array-contains operations
        // 3. Proper prefix matching
        return queryFieldNames.every(qfn => indexFieldNames.includes(qfn));
      });
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
            
            if (fieldArg.type === 'Literal') {
              queryFields.unshift({
                field: fieldArg.value,
                operator: 'orderBy',
              });
            }
          } else if ((methodName === 'collection' || methodName === 'collectionGroup') && currentNode.arguments.length > 0) {
            if (currentNode.arguments[0].type === 'Literal') {
              collection = currentNode.arguments[0].value;
            }
            break; // Stop at collection()
          } else if (methodName.endsWith('CollRef') || methodName.endsWith('CollectionRef')) {
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
