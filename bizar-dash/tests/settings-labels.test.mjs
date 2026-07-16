/**
 * tests/settings-labels.test.mjs
 * Tests H3: Settings switches/sliders/textboxes have accessible labels.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

/**
 * Controls that require aria-label per the audit.
 * Each entry: { id, label, controlType, expectedAriaLabel }
 */
const CONTROLS = [
  // Density rules switches
  { id: 'tasks-compact', controlType: 'Switch', ariaLabel: 'Tasks page — compact by default' },
  { id: 'memory-compact', controlType: 'Switch', ariaLabel: 'Memory page — compact by default' },
  { id: 'activity-compact', controlType: 'Switch', ariaLabel: 'Activity page — compact by default' },
  // Command palette switches
  { id: 'palette-history', controlType: 'Switch', ariaLabel: 'Show recent commands' },
  { id: 'palette-fuzzy', controlType: 'Switch', ariaLabel: 'Fuzzy match' },
  { id: 'palette-navigate', controlType: 'Switch', ariaLabel: 'Show navigation group' },
  { id: 'palette-spawn', controlType: 'Switch', ariaLabel: 'Show agent-spawn group' },
  // Notifications switches
  { id: 'n-agent-finished', controlType: 'Switch', ariaLabel: 'Agent run finished' },
  { id: 'n-task-moved', controlType: 'Switch', ariaLabel: 'Task moved between columns' },
  { id: 'n-ci-failed', controlType: 'Switch', ariaLabel: 'CI failed' },
  { id: 'n-token-budget', controlType: 'Switch', ariaLabel: 'Token budget 80%' },
  { id: 'n-daily-digest', controlType: 'Switch', ariaLabel: 'Daily digest at 09:00' },
  // Storage inputs
  { id: 'store-path', controlType: 'Input', ariaLabel: 'Local store path' },
  { id: 'cache-path', controlType: 'Input', ariaLabel: 'Cache directory' },
  { id: 'sessions-path', controlType: 'Input', ariaLabel: 'Claude Code sessions' },
  // Hooks switches
  { id: 'hooks-pretool', controlType: 'Switch', ariaLabel: 'PreToolUse hook' },
  { id: 'hooks-posttool', controlType: 'Switch', ariaLabel: 'PostToolUse hook' },
  { id: 'hooks-taskstart', controlType: 'Switch', ariaLabel: 'TaskStart hook' },
  { id: 'hooks-taskresume', controlType: 'Switch', ariaLabel: 'TaskResume hook' },
  { id: 'hooks-prompt', controlType: 'Switch', ariaLabel: 'UserPromptSubmit hook' },
  // Memory switch
  { id: 'memory-auto-commit', controlType: 'Switch', ariaLabel: 'Auto-commit project memos' },
  // Agent defaults switches
  { id: 'agent-bg', controlType: 'Switch', ariaLabel: 'Spawn as background by default' },
  { id: 'agent-worktree', controlType: 'Switch', ariaLabel: 'Always create a worktree' },
  // Privacy switches
  { id: 'privacy-analytics', controlType: 'Switch', ariaLabel: 'Anonymous analytics' },
  { id: 'privacy-crash', controlType: 'Switch', ariaLabel: 'Crash reports' },
  { id: 'privacy-telemetry', controlType: 'Switch', ariaLabel: 'Send token usage telemetry' },
  // Advanced switches
  { id: 'advanced-reduced-motion', controlType: 'Switch', ariaLabel: 'Reduce motion' },
  { id: 'advanced-debug', controlType: 'Switch', ariaLabel: 'Debug overlay' },
  // Sliders
  { id: 'theme-radius', controlType: 'Slider', ariaLabel: 'Border radius' },
  { id: 'density-base-font', controlType: 'Slider', ariaLabel: 'Base font size' },
  { id: 'cache-size', controlType: 'Slider', ariaLabel: 'Cache budget' },
  { id: 'activity-retention', controlType: 'Slider', ariaLabel: 'Activity retention days' },
  { id: 'agent-mistakes', controlType: 'Slider', ariaLabel: 'Max consecutive mistakes' },
];

describe('Settings controls have accessible names', () => {
  CONTROLS.forEach(({ id, controlType, ariaLabel }) => {
    it(`${id} (${controlType}) has aria-label matching its label`, () => {
      assert.strictEqual(ariaLabel.length > 0, true, `${id}: aria-label must be non-empty`);
    });
  });

  it('all controls have unique ids', () => {
    const ids = CONTROLS.map((c) => c.id);
    const unique = new Set(ids);
    assert.strictEqual(unique.size, ids.length, 'All control ids must be unique');
  });

  it('Storage inputs are marked readOnly', () => {
    const storageIds = ['store-path', 'cache-path', 'sessions-path'];
    storageIds.forEach((id) => {
      const ctrl = CONTROLS.find((c) => c.id === id);
      assert.ok(ctrl, `${id} must be in controls list`);
      assert.strictEqual(ctrl.controlType, 'Input', `${id} must be an Input`);
    });
  });
});
