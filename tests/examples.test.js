/**
 * @fileoverview Tests for examples directory
 * @author Q42
 */
'use strict';

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const { ESLint } = require('eslint');
const path = require('path');
const assert = require('assert');

//------------------------------------------------------------------------------
// Constants
//------------------------------------------------------------------------------

const EXAMPLES_DIR = path.resolve(__dirname, '..', 'examples');
const VALID_QUERIES_FILE = 'valid-queries.js';
const INVALID_QUERIES_FILE = 'invalid-queries.js';
const ESLINT_CONFIG_FILE = path.resolve(EXAMPLES_DIR, 'eslint.config.js');

//------------------------------------------------------------------------------
// Tests
//------------------------------------------------------------------------------

describe('examples directory', function() {
  let eslint;

  before(function() {
    // Create ESLint instance with the configuration from examples directory
    eslint = new ESLint({
      cwd: EXAMPLES_DIR,
      overrideConfigFile: ESLINT_CONFIG_FILE,
    });
  });

  it('valid-queries.js should have no ESLint errors', async function() {
    const results = await eslint.lintFiles([VALID_QUERIES_FILE]);
    const errorCount = results.reduce((sum, result) => sum + result.errorCount, 0);
    const warningCount = results.reduce((sum, result) => sum + result.warningCount, 0);

    if (errorCount > 0 || warningCount > 0) {
      const formatter = await eslint.loadFormatter('stylish');
      const resultText = formatter.format(results);
      console.log(resultText);
    }

    assert.strictEqual(errorCount, 0, 'valid-queries.js should have no ESLint errors');
    assert.strictEqual(warningCount, 0, 'valid-queries.js should have no ESLint warnings');
  });

  it('invalid-queries.js should have ESLint errors', async function() {
    const results = await eslint.lintFiles([INVALID_QUERIES_FILE]);
    const errorCount = results.reduce((sum, result) => sum + result.errorCount, 0);

    if (errorCount === 0) {
      const formatter = await eslint.loadFormatter('stylish');
      const resultText = formatter.format(results);
      console.log('Expected errors but got none:');
      console.log(resultText);
    }

    assert.ok(errorCount == 2, 'invalid-queries.js should be missing indexes for all queries');
  });
});
