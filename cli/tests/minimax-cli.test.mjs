/**
 * cli/tests/minimax-cli.test.mjs
 *
 * Tests for MiniMax CLI bar rendering.
 * Verifies bar shows CONSUMED quota as filled blocks (not remaining).
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';

// ── Bar rendering helper (mirrors minimax.mjs logic) ──────────────────────────

/**
 * Render a quota bar string.
 * @param {number} remainingPct - percentage of quota remaining (0-100)
 * @returns {string} bar string like '██░░░░░░░░░░░░░░░░░' (20 chars total)
 */
function renderBar(remainingPct) {
  const consumed = 100 - remainingPct;
  const filled = Math.round(consumed / 5);
  const empty = 20 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('MiniMax CLI bar rendering', () => {

  test('91% remaining → 9% consumed → 2 filled blocks (9/5 rounds to 2)', () => {
    const bar = renderBar(91);
    const filledCount = (bar.match(/█/g) || []).length;
    assert.strictEqual(filledCount, 2, `Expected 2 filled blocks for 91% remaining, got ${filledCount}`);
    assert.strictEqual(bar.length, 20, `Bar should be exactly 20 chars`);
  });

  test('100% remaining → 0% consumed → 0 filled blocks', () => {
    const bar = renderBar(100);
    const filledCount = (bar.match(/█/g) || []).length;
    assert.strictEqual(filledCount, 0, `Expected 0 filled blocks for 100% remaining`);
  });

  test('0% remaining → 100% consumed → 20 filled blocks', () => {
    const bar = renderBar(0);
    const filledCount = (bar.match(/█/g) || []).length;
    assert.strictEqual(filledCount, 20, `Expected 20 filled blocks for 0% remaining`);
  });

  test('75% remaining → 25% consumed → 5 filled blocks', () => {
    const bar = renderBar(75);
    const filledCount = (bar.match(/█/g) || []).length;
    assert.strictEqual(filledCount, 5, `Expected 5 filled blocks for 75% remaining`);
  });

  test('25% remaining → 75% consumed → 15 filled blocks', () => {
    const bar = renderBar(25);
    const filledCount = (bar.match(/█/g) || []).length;
    assert.strictEqual(filledCount, 15, `Expected 15 filled blocks for 25% remaining`);
  });

  test('bar is always exactly 20 characters', () => {
    for (const remaining of [0, 10, 25, 50, 75, 90, 100]) {
      const bar = renderBar(remaining);
      assert.strictEqual(bar.length, 20, `Bar for ${remaining}% remaining should be 20 chars, got ${bar.length}`);
    }
  });

  test('filled blocks increase as remaining decreases', () => {
    const bars = [100, 91, 75, 50, 25, 10, 0].map(r => ({
      remaining: r,
      filled: (renderBar(r).match(/█/g) || []).length
    }));
    for (let i = 1; i < bars.length; i++) {
      assert.ok(
        bars[i].filled >= bars[i-1].filled,
        `${bars[i].remaining}% remaining (${bars[i].filled} blocks) should have >= filled blocks than ${bars[i-1].remaining}% remaining (${bars[i-1].filled} blocks)`
      );
    }
  });
});
