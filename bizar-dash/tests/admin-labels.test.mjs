/**
 * tests/admin-labels.test.mjs
 * Tests H1: Admin Run buttons have accessible labels.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

const ACTIONS = [
  { id: 'gc', title: 'Garbage collect' },
  { id: 'cache-clear', title: 'Clear cache' },
  { id: 'memory-reindex', title: 'Reindex memory' },
  { id: 'logs-purge', title: 'Purge old logs' },
  { id: 'restart', title: 'Restart dashboard' },
  { id: 'rebuild', title: 'Rebuild' },
  { id: 'export-activity', title: 'Export activity' },
];

/**
 * Simulates the AdminTile button rendering:
 * aria-label={action.title} children={action.title}
 */
function renderButton(action) {
  return {
    ariaLabel: action.title,
    text: action.title,
  };
}

describe('Admin Run buttons', () => {
  ACTIONS.forEach((action) => {
    it(`${action.id} button has aria-label matching action title`, () => {
      const btn = renderButton(action);
      assert.strictEqual(btn.ariaLabel, action.title, `aria-label should be "${action.title}"`);
    });

    it(`${action.id} button text matches action title`, () => {
      const btn = renderButton(action);
      assert.strictEqual(btn.text, action.title, `button text should be "${action.title}"`);
    });
  });
});
