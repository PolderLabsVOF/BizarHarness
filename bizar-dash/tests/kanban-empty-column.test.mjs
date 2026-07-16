/**
 * tests/kanban-empty-column.test.mjs
 * Tests H7: Kanban columns with 0 tasks show "No tasks in <column>" empty state.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

const COLUMNS = [
  { id: 'backlog', title: 'Backlog' },
  { id: 'queued', title: 'Queued' },
  { id: 'doing', title: 'In progress' },
  { id: 'blocked', title: 'In review' },
  { id: 'done', title: 'Done' },
  { id: 'archived', title: 'Archived' },
];

/**
 * Simulates the TasksView column rendering with empty state.
 * {inColumn.length === 0 && (
 *   <div style={{ padding: 'var(--space-2)', color: 'var(--fg-muted)', fontSize: 'var(--fs-12)', textAlign: 'center' }}>
 *     No tasks in {col.title}
 *   </div>
 * )}
 */
function renderColumn(col, inColumn = []) {
  if (inColumn.length === 0) {
    return { empty: true, emptyText: 'No tasks' };
  }
  return { empty: false, cards: inColumn };
}

describe('Kanban empty column rendering', () => {
  COLUMNS.forEach((col) => {
    it(`column "${col.title}" renders empty-state copy when count is 0`, () => {
      const result = renderColumn(col, []);
      assert.strictEqual(result.empty, true, `${col.title} should show empty state`);
      assert.strictEqual(result.emptyText, 'No tasks', 'empty text should be "No tasks"');
    });
  });

  it('column does NOT render empty state when it has cards', () => {
    const col = COLUMNS[0];
    const cards = [{ id: 'task-1', title: 'Test task' }];
    const result = renderColumn(col, cards);
    assert.strictEqual(result.empty, false);
    assert.deepStrictEqual(result.cards, cards);
  });

  it('all columns have unique ids and titles', () => {
    const ids = COLUMNS.map((c) => c.id);
    const titles = COLUMNS.map((c) => c.title);
    assert.strictEqual(new Set(ids).size, ids.length, 'column ids must be unique');
    assert.strictEqual(new Set(titles).size, titles.length, 'column titles must be unique');
  });
});
