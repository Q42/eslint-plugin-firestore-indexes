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
// Tests
//------------------------------------------------------------------------------

describe('examples directory', function() {
  let eslint;

  before(function() {
    // Create ESLint instance with the configuration from examples directory
    eslint = new ESLint({
      cwd: path.join(__dirname, '..', 'examples'),
      overrideConfigFile: path.join(__dirname, '..', 'examples', 'eslint.config.js'),
    });
  });

  it('valid-queries.js should have no ESLint errors', async function() {
    const results = await eslint.lintFiles(['valid-queries.js']);
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
    const results = await eslint.lintFiles(['invalid-queries.js']);
    const errorCount = results.reduce((sum, result) => sum + result.errorCount, 0);

    if (errorCount === 0) {
      const formatter = await eslint.loadFormatter('stylish');
      const resultText = formatter.format(results);
      console.log('Expected errors but got none:');
      console.log(resultText);
    }

    assert.ok(errorCount > 0, 'invalid-queries.js should have at least one ESLint error for missing indexes');
  });
});
