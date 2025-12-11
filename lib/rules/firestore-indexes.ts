/**
 * @fileoverview Ensure Firestore indexes are created for each query in the codebase
 * @author Q42
 */

import { ESLintUtils, TSESTree } from '@typescript-eslint/utils';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

type QueryField = {
  field: string;
  operator: string;
};

type IndexConfig = {
  indexes: Array<{
    collectionGroup?: string;
    collectionId?: string;
    queryScope?: string;
    fields: Array<{
      fieldPath: string;
      order?: string;
      arrayConfig?: string;
    }>;
  }>;
  fieldOverrides: any[];
};

const createRule = ESLintUtils.RuleCreator(
  (name) => `https://github.com/Q42/eslint-firestore-indexes/blob/main/docs/rules/${name}.md`
);

export = createRule({
  name: 'firestore-indexes',
  meta: {
    type: 'problem',
    docs: {
      description: 'Ensure Firestore indexes are created for each query in the codebase',
    },
    messages: {
      missingIndex:
        'Firestore query on collection "{{collection}}" with filters {{filters}} is missing a required index. Add it to {{indexesPath}}',
      invalidIndexFile: 'Could not load indexes file at {{indexesPath}}: {{error}}',
    },
    schema: [
      {
        type: 'object',
        properties: {
          indexesPath: {
            type: 'string',
          },
        },
        additionalProperties: false,
      },
    ],
  },
  defaultOptions: [{ indexesPath: 'indexes.json' }],

  create(context, [options]) {
    const indexesPath = options.indexesPath || 'indexes.json';
    const parserServices = ESLintUtils.getParserServices(context);
    const checker = parserServices.program.getTypeChecker();
    
    let indexes: IndexConfig | null = null;

    // Load indexes configuration
    try {
      const cwd = context.getCwd ? context.getCwd() : process.cwd();
      const fullPath = path.resolve(cwd, indexesPath);

      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        indexes = JSON.parse(content);
      } else {
        indexes = { indexes: [], fieldOverrides: [] };
      }
    } catch (error: any) {
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
     * Check if a type is a Firestore Query or CollectionReference
     */
    function isFirestoreQueryType(type: ts.Type): boolean {
      const typeString = checker.typeToString(type);
      return (
        typeString.includes('Query') ||
        typeString.includes('CollectionReference') ||
        typeString.includes('DocumentReference')
      );
    }

    /**
     * Get collection name from a CollectionReference type
     */
    function getCollectionFromType(type: ts.Type): string | null {
      // Try to extract collection name from type
      // This is a simplified approach - in reality, we'd need more sophisticated type analysis
      const typeString = checker.typeToString(type);
      
      // Look for patterns like CollectionReference<DocumentData, "collectionName">
      const match = typeString.match(/CollectionReference<[^,>]+,\s*["']([^"']+)["']/);
      if (match) {
        return match[1];
      }
      
      return null;
    }

    /**
     * Check if an index exists for the given query
     */
    function hasIndex(collection: string, queryFields: QueryField[]): boolean {
      if (!indexes || !indexes.indexes) {
        return false;
      }

      return indexes.indexes.some((index) => {
        if (index.collectionGroup !== collection && index.collectionId !== collection) {
          return false;
        }

        const indexFields = index.fields || [];

        if (queryFields.length === 0) {
          return true;
        }

        // Filter out __name__ field
        const relevantIndexFields = indexFields.filter((f) => f.fieldPath !== '__name__');

        const queryFieldNames = queryFields.map((qf) => qf.field);
        const indexFieldNames = relevantIndexFields.map((idxf) => idxf.fieldPath);

        // Check if all query fields are present in the index
        return queryFieldNames.every((qfn) => indexFieldNames.includes(qfn));
      });
    }

    /**
     * Trace variable through assignments and conditional branches
     */
    function traceVariable(
      node: TSESTree.Node,
      variableName: string,
      scope: any
    ): TSESTree.Node[] {
      const assignments: TSESTree.Node[] = [];
      
      // Find all assignments to this variable
      const variable = scope.set.get(variableName);
      if (!variable) {
        return assignments;
      }

      // Track all references to the variable
      for (const ref of variable.references) {
        if (ref.isWrite() && ref.writeExpr) {
          assignments.push(ref.writeExpr);
        }
      }

      return assignments;
    }

    /**
     * Extract query information from a call chain using type information
     */
    function analyzeQueryChain(node: TSESTree.Node): { collection: string | null; queryFields: QueryField[] } {
      const queryFields: QueryField[] = [];
      let collection: string | null = null;
      let currentNode: TSESTree.Node = node;

      // Walk backwards through the call chain
      while (currentNode.type === 'CallExpression') {
        const callExpr = currentNode as TSESTree.CallExpression;
        
        if (callExpr.callee.type === 'MemberExpression') {
          const memberExpr = callExpr.callee;
          const methodName = memberExpr.property.type === 'Identifier' 
            ? memberExpr.property.name 
            : '';

          // Skip pagination methods
          if (['limit', 'offset', 'startAt', 'startAfter', 'endAt', 'endBefore'].includes(methodName)) {
            currentNode = memberExpr.object;
            continue;
          }

          // Extract where() clauses
          if (methodName === 'where' && callExpr.arguments.length >= 2) {
            const fieldArg = callExpr.arguments[0];
            const operatorArg = callExpr.arguments[1];

            if (fieldArg.type === 'Literal') {
              queryFields.unshift({
                field: String(fieldArg.value),
                operator: operatorArg.type === 'Literal' ? String(operatorArg.value) : 'unknown',
              });
            }
          }
          
          // Extract orderBy() clauses
          else if (methodName === 'orderBy' && callExpr.arguments.length >= 1) {
            const fieldArg = callExpr.arguments[0];

            if (fieldArg.type === 'Literal') {
              queryFields.unshift({
                field: String(fieldArg.value),
                operator: 'orderBy',
              });
            }
          }
          
          // Check for collection() or collectionGroup() methods
          else if (['collection', 'collectionGroup'].includes(methodName) && callExpr.arguments.length > 0) {
            const arg = callExpr.arguments[0];
            if (arg.type === 'Literal') {
              collection = String(arg.value);
            }
            break;
          }
          
          // Use type checking to identify collection reference methods
          if (!collection) {
            try {
              const tsNode = parserServices.esTreeNodeToTSNodeMap.get(memberExpr.object);
              if (tsNode) {
                const type = checker.getTypeAtLocation(tsNode);
                const typeString = checker.typeToString(type);
                
                // Check if this is a CollectionReference type
                if (typeString.includes('CollectionReference')) {
                  // Try to extract collection name from the method name
                  // e.g., templateCollRef() -> templates
                  if (methodName.endsWith('CollRef') || methodName.endsWith('CollectionRef') || methodName.endsWith('Ref')) {
                    const collectionName = methodName
                      .replace(/CollRef$/, '')
                      .replace(/CollectionRef$/, '')
                      .replace(/Ref$/, '');
                    
                    collection = collectionName.charAt(0).toLowerCase() + collectionName.slice(1);
                    if (collection && !collection.endsWith('s')) {
                      collection += 's';
                    }
                    break;
                  }
                  
                  // Try to extract from type parameters
                  const collFromType = getCollectionFromType(type);
                  if (collFromType) {
                    collection = collFromType;
                    break;
                  }
                }
              }
            } catch (e) {
              // Type checking failed, continue
            }
          }

          currentNode = memberExpr.object;
        } else {
          break;
        }
      }

      return { collection, queryFields };
    }

    /**
     * Analyze query with variable tracking for conditional queries
     */
    function analyzeQueryWithVariableTracking(node: TSESTree.CallExpression): void {
      // Check if this is a query execution method
      if (
        node.callee.type !== 'MemberExpression' ||
        !['get', 'onSnapshot', 'count'].includes(
          node.callee.property.type === 'Identifier' ? node.callee.property.name : ''
        )
      ) {
        return;
      }

      // Get the object being called on
      let queryObject = node.callee.object;
      
      // If it's a simple identifier (variable), trace it through assignments
      if (queryObject.type === 'Identifier') {
        const variableName = queryObject.name;
        const scope = context.getScope();
        
        // Trace all assignments to this variable
        const assignments = traceVariable(queryObject, variableName, scope);
        
        // Analyze each branch/assignment path
        for (const assignment of assignments) {
          if (assignment.type === 'CallExpression') {
            const { collection, queryFields } = analyzeQueryChain(assignment);
            
            if (collection && (queryFields.length > 1 || queryFields.some((f) => f.operator === 'orderBy'))) {
              checkAndReport(node, collection, queryFields);
            }
          }
        }
      }
      
      // Analyze the direct call chain
      const { collection, queryFields } = analyzeQueryChain(queryObject);
      
      if (collection && (queryFields.length > 1 || queryFields.some((f) => f.operator === 'orderBy'))) {
        checkAndReport(node, collection, queryFields);
      }
    }

    const reportedQueries = new Set<string>();

    function checkAndReport(node: TSESTree.Node, collection: string, queryFields: QueryField[]): void {
      const queryKey = `${collection}:${queryFields.map((f) => `${f.field}:${f.operator}`).join(',')}`;

      if (!reportedQueries.has(queryKey) && !hasIndex(collection, queryFields)) {
        reportedQueries.add(queryKey);
        const filters = queryFields.map((f) => `${f.field} (${f.operator})`).join(', ');
        
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

    return {
      CallExpression(node: TSESTree.CallExpression) {
        analyzeQueryWithVariableTracking(node);
      },
    };
  },
});
