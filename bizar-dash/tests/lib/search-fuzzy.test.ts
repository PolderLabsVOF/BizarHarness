/**
 * tests/lib/search-fuzzy.test.ts
 *
 * v4.9 — Unit tests for fuzzy search with typo tolerance.
 */
import { describe, it, expect } from 'vitest';
import {
  levenshtein,
  scoreField,
  fuzzySearch,
  type SearchableItem,
} from '../../src/web/lib/search';

/* ─── Levenshtein ─── */

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  it('returns length for completely different strings', () => {
    expect(levenshtein('abc', 'xyz')).toBe(3);
  });

  it('counts single-character insertion', () => {
    expect(levenshtein('cat', 'cats')).toBe(1);
  });

  it('counts single-character deletion', () => {
    expect(levenshtein('cats', 'cat')).toBe(1);
  });

  it('counts single-character substitution', () => {
    expect(levenshtein('cat', 'car')).toBe(1);
  });

  it('handles empty strings', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('', '')).toBe(0);
  });

  it('handles transposition as two edits', () => {
    expect(levenshtein('ab', 'ba')).toBe(2);
  });
});

/* ─── scoreField ─── */

describe('scoreField', () => {
  const field = 'accent color';

  it('exact match scores 100', () => {
    expect(scoreField('accent color', field)).toBe(100);
  });

  it('prefix match scores 90', () => {
    expect(scoreField('acc', field)).toBe(90);
    expect(scoreField('accent', field)).toBe(90); // starts with "accent"
  });

  it('word boundary match scores 80', () => {
    // "color" is a separate word in "accent color"
    expect(scoreField('color', field)).toBe(80);
    // "colo" starts at "color" word boundary, not field start
    expect(scoreField('colo', field)).toBe(80);
  });

  it('typo within 2 chars scores 40', () => {
    // "accent" vs "axcent" (one char off)
    expect(scoreField('axcent', 'accent color')).toBe(40);
    // "accent" vs "accant" (one char off)
    const score = scoreField('accant', 'accent color');
    expect(score).toBe(40);
  });

  it('substring non-prefix, non-word-boundary match scores 30', () => {
    // "cent" is not at a word boundary in "accent color"
    expect(scoreField('cent', 'accent color')).toBe(30);
  });

  it('returns 0 for no match', () => {
    expect(scoreField('zzzzz', 'accent color')).toBe(0);
  });

  it('handles case insensitivity via pre-lowered inputs', () => {
    // Our callers lower case before passing — verify the scoring works
    // "accent" is a prefix of "accent color" → scores 90
    expect(scoreField('Accent'.toLowerCase(), 'Accent Color'.toLowerCase())).toBe(90);
  });
});

/* ─── fuzzySearch ─── */

describe('fuzzySearch', () => {
  const items: SearchableItem[] = [
    { key: 'theme.accent', label: 'Accent color', section: 'theme', value: '#8b5cf6' },
    { key: 'theme.fontFamily', label: 'Font family', section: 'theme' },
    { key: 'ui.layout', label: 'UI layout', section: 'layout', value: 'topnav' },
    { key: 'defaultAgent', label: 'Default agent', section: 'general', value: 'odin' },
    { key: 'notifications.onAgentComplete', label: 'Notify on agent complete', section: 'notifications', description: 'Show toast when an agent finishes' },
  ];

  it('returns empty array for empty query', () => {
    expect(fuzzySearch('', items)).toEqual([]);
    expect(fuzzySearch('   ', items)).toEqual([]);
  });

  it('finds exact match by label', () => {
    const results = fuzzySearch('accent color', items);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].key).toBe('theme.accent');
    expect(results[0].score).toBe(100);
  });

  it('finds match by value', () => {
    const results = fuzzySearch('#8b5cf6', items);
    expect(results.some((r) => r.key === 'theme.accent')).toBe(true);
  });

  it('finds match by description', () => {
    const results = fuzzySearch('toast', items);
    expect(results.some((r) => r.key === 'notifications.onAgentComplete')).toBe(true);
  });

  it('finds match via typo tolerance', () => {
    const results = fuzzySearch('axcent', items);
    expect(results.some((r) => r.key === 'theme.accent')).toBe(true);
  });

  it('sorts by score descending', () => {
    const results = fuzzySearch('agent', items);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });

  it('returns empty when nothing matches', () => {
    const results = fuzzySearch('zzzznonexistent', items);
    expect(results).toEqual([]);
  });

  it('sets matchedField and matchedTerm on results', () => {
    const results = fuzzySearch('accent', items);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].matchedField).toBe('label');
    expect(results[0].matchedTerm).toBe('Accent color');
  });
});
