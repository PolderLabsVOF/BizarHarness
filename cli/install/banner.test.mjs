/**
 * cli/install/banner.test.mjs
 *
 * Tests for cli/install/banner.mjs
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { showBanner, showPantheon, sectionHeading, palette } from './banner.mjs';

describe('showBanner()', () => {
  test('does not throw', () => {
    assert.doesNotThrow(() => showBanner());
  });

  test('does not throw with version', () => {
    assert.doesNotThrow(() => showBanner('10.0.0'));
  });
});

describe('palette', () => {
  test('has all 5 required keys', () => {
    const required = ['primary', 'success', 'warn', 'error', 'dim'];
    for (const key of required) {
      assert.ok(key in palette, `missing palette key: ${key}`);
      assert.ok(typeof palette[key] === 'function', `${key} should be a function`);
    }
  });
});

describe('sectionHeading()', () => {
  let output;
  const orig = console.log;

  test('does not throw', () => {
    assert.doesNotThrow(() => sectionHeading('Test Section'));
  });
});

console.log('  banner.test.mjs loaded — run with: node --test cli/install/banner.test.mjs');
