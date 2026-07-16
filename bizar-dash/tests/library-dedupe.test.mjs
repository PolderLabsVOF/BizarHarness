/**
 * tests/library-dedupe.test.mjs
 * Tests H4: LibraryGrid deduplicates entries by name (keeps first occurrence).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

/**
 * Simulates the LibrariesView dedup logic.
 * .reduce<LibraryItemProps[]>((acc, item) => {
 *   if (!acc.some((existing) => existing.name === item.name)) acc.push(item);
 *   return acc;
 * }, []);
 */
function dedupe(items) {
  return items.reduce((acc, item) => {
    if (!acc.some((existing) => existing.name === item.name)) acc.push(item);
    return acc;
  }, []);
}

describe('Libraries dedup by name', () => {
  it('dedupes 6 entries with 3 distinct names down to 3', () => {
    const input = [
      { name: 'skill-a', slug: 'skill-a', status: 'enabled' },
      { name: 'skill-b', slug: 'skill-b', status: 'enabled' },
      { name: 'skill-a', slug: 'skill-a-copy', status: 'disabled' }, // dup — should be dropped
      { name: 'skill-c', slug: 'skill-c', status: 'enabled' },
      { name: 'skill-b', slug: 'skill-b-copy', status: 'error' }, // dup — should be dropped
      { name: 'skill-c', slug: 'skill-c-copy', status: 'disabled' }, // dup — should be dropped
    ];
    const result = dedupe(input);
    assert.strictEqual(result.length, 3, 'should return 3 unique items');
    assert.strictEqual(result[0].name, 'skill-a');
    assert.strictEqual(result[1].name, 'skill-b');
    assert.strictEqual(result[2].name, 'skill-c');
  });

  it('keeps first occurrence when duplicates exist', () => {
    const input = [
      { name: 'dup', slug: 'first', status: 'enabled' },
      { name: 'dup', slug: 'second', status: 'disabled' },
    ];
    const result = dedupe(input);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].slug, 'first');
  });

  it('returns empty array for empty input', () => {
    assert.strictEqual(dedupe([]).length, 0);
  });

  it('returns all items when no duplicates', () => {
    const input = [
      { name: 'alpha', slug: 'alpha', status: 'enabled' },
      { name: 'beta', slug: 'beta', status: 'enabled' },
    ];
    const result = dedupe(input);
    assert.strictEqual(result.length, 2);
  });
});
