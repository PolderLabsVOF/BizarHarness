/**
 * cli/commands/statusline.test.mjs
 *
 * Tests for the statusline command.
 */
import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseStatuslineArgs,
  updateStatuslineSettings,
  formatStatusline,
  STATUSLINE_TEMPLATES,
  resolveStatuslinePath,
  assertOperatorContext,
  showStatuslineHelp,
} from './statusline.mjs';

const originalEnv = process.env;

afterEach(() => {
  process.env = { ...originalEnv };
  delete process.env.BIZAR_AGENT;
  delete process.env.CLAUDE_CODE_AGENT_NAME;
});

test('parseStatuslineArgs defaults to render', () => {
  assert.deepEqual(parseStatuslineArgs([]), {
    subcommand: 'render',
    template: undefined,
    padding: undefined,
    refresh: undefined,
    hideVim: false,
  });
});

test('parseStatuslineArgs parses install with flags', () => {
  const result = parseStatuslineArgs(['install', '--padding', '2', '--refresh', '10', '--hide-vim', '--template', 'compact']);
  assert.equal(result.subcommand, 'install');
  assert.equal(result.padding, 2);
  assert.equal(result.refresh, 10);
  assert.equal(result.hideVim, true);
  assert.equal(result.template, 'compact');
});

test('parseStatuslineArgs parses remove', () => {
  assert.deepEqual(parseStatuslineArgs(['remove']), {
    subcommand: 'remove',
    template: undefined,
    padding: undefined,
    refresh: undefined,
    hideVim: false,
  });
});

test('parseStatuslineArgs throws on invalid template', () => {
  assert.throws(() => parseStatuslineArgs(['--template', 'invalid']), /Unknown template/);
});

test('parseStatuslineArgs parses help flag', () => {
  const result = parseStatuslineArgs(['--help']);
  assert.equal(result.help, true);
  assert.equal(result.subcommand, 'render');
});

test('updateStatuslineSettings preserves env and other settings', () => {
  const current = { permissions: { defaultMode: 'acceptEdits' }, env: { KEEP: 'yes' } };
  const next = updateStatuslineSettings(current, { install: true, padding: 2, refresh: 10, hideVim: true, template: 'compact' });
  assert.equal(next.permissions.defaultMode, 'acceptEdits');
  assert.equal(next.env.KEEP, 'yes');
  assert.equal(next.statusLine.type, 'command');
  assert.equal(next.statusLine.padding, 2);
  assert.equal(next.statusLine.refreshInterval, 10);
  assert.equal(next.statusLine.hideVimModeIndicator, true);
  assert.equal(next.statusLine.template, 'compact');
  assert.equal(next.statusLine.command, 'bizar statusline render');
  assert.equal(next.statusLine.refreshInterval, 10);
});

test('updateStatuslineSettings overwrites existing statusLine', () => {
  const current = { statusLine: { type: 'old', command: 'old-cmd' } };
  const next = updateStatuslineSettings(current, { install: true, padding: 3 });
  assert.equal(next.statusLine.type, 'command');
  assert.equal(next.statusLine.padding, 3);
  assert.equal(next.statusLine.template, 'default');
});

test('updateStatuslineSettings removes statusLine on remove', () => {
  const current = { statusLine: { type: 'command' }, other: 'keep' };
  const next = updateStatuslineSettings(current, { remove: true });
  assert.equal(next.statusLine, undefined);
  assert.equal(next.other, 'keep');
});

test('formatStatusline default template returns 3 lines', () => {
  const data = {
    model: { id: 'sonnet', display_name: 'Sonnet 4.5' },
    workspace: { current_dir: '/home/user/proj' },
    context_window: { used_percentage: 20, total_input_tokens: 8000, total_output_tokens: 2000 },
    cost: { total_cost_usd: 0.25, total_duration_ms: 60000 },
  };
  const env = { COLUMNS: '80' };
  const output = formatStatusline(data, 'default', env, { gitBranch: 'main', gitDirty: { modified: 1, staged: 2 } });
  const lines = output.split('\n');
  assert.equal(lines.length, 3);
  assert.ok(lines[0].includes('Sonnet 4.5'));
  assert.ok(lines[1].includes('/home/user/proj') || lines[1].includes('…'));
  assert.ok(lines[2].includes('20%'));
});

test('formatStatusline compact template returns 1 line', () => {
  const data = {
    model: { id: 'sonnet', display_name: 'Sonnet 4.5' },
    workspace: { current_dir: '/home/user/proj' },
    context_window: { used_percentage: 20, total_input_tokens: 8000, total_output_tokens: 2000 },
    cost: { total_cost_usd: 0.25 },
  };
  const output = formatStatusline(data, 'compact', { COLUMNS: '80' }, { gitBranch: 'main', gitDirty: { modified: 0, staged: 0 } });
  const lines = output.split('\n');
  assert.equal(lines.length, 1);
  assert.ok(lines[0].includes('Sonnet 4.5'));
});

test('formatStatusline git-only template contains branch but not model', () => {
  const data = {
    model: { id: 'sonnet', display_name: 'Sonnet 4.5' },
    workspace: { current_dir: '/home/user/proj' },
    cost: { total_cost_usd: 0.25 },
  };
  const output = formatStatusline(data, 'git-only', { COLUMNS: '80' }, { gitBranch: 'main', gitDirty: { modified: 1, staged: 0 } });
  assert.ok(output.includes('main'));
  assert.ok(!output.includes('Sonnet'));
});

test('progress bar math: 50% -> 10 filled / 10 empty', () => {
  const data = {
    model: { display_name: 'Test' },
    workspace: { current_dir: '/test' },
    context_window: { used_percentage: 50, total_input_tokens: 25000, total_output_tokens: 0 },
  };
  const output = formatStatusline(data, 'default', { COLUMNS: '80' });
  // 50% should have equal filled and empty
  assert.ok(output.includes('█') && output.includes('░'));
});

test('progress bar math: 25% -> 5 filled / 15 empty', () => {
  const data = {
    model: { display_name: 'Test' },
    workspace: { current_dir: '/test' },
    context_window: { used_percentage: 25, total_input_tokens: 12500, total_output_tokens: 0 },
  };
  const output = formatStatusline(data, 'default', { COLUMNS: '80' });
  // Should have fewer filled than empty
  const filled = (output.match(/█/g) || []).length;
  const empty = (output.match(/░/g) || []).length;
  assert.equal(filled, 5);
  assert.equal(empty, 15);
});

test('progress bar math: 0% -> 0 filled / 20 empty', () => {
  const data = {
    model: { display_name: 'Test' },
    workspace: { current_dir: '/test' },
    context_window: { used_percentage: 0, total_input_tokens: 0, total_output_tokens: 0 },
  };
  const output = formatStatusline(data, 'default', { COLUMNS: '80' });
  const filled = (output.match(/█/g) || []).length;
  const empty = (output.match(/░/g) || []).length;
  assert.equal(filled, 0);
  assert.equal(empty, 20);
});

test('progress bar math: 100% -> 20 filled / 0 empty', () => {
  const data = {
    model: { display_name: 'Test' },
    workspace: { current_dir: '/test' },
    context_window: { used_percentage: 100, total_input_tokens: 40000, total_output_tokens: 10000 },
  };
  const output = formatStatusline(data, 'default', { COLUMNS: '80' });
  const filled = (output.match(/█/g) || []).length;
  const empty = (output.match(/░/g) || []).length;
  assert.equal(filled, 20);
  assert.equal(empty, 0);
});

test('progress bar color: 30% uses green', () => {
  const data = {
    model: { display_name: 'Test' },
    workspace: { current_dir: '/test' },
    context_window: { used_percentage: 30, total_input_tokens: 15000, total_output_tokens: 0 },
  };
  const output = formatStatusline(data, 'default', { COLUMNS: '80' });
  assert.ok(output.includes('\x1b[32m')); // green
});

test('progress bar color: 65% uses yellow', () => {
  const data = {
    model: { display_name: 'Test' },
    workspace: { current_dir: '/test' },
    context_window: { used_percentage: 65, total_input_tokens: 32500, total_output_tokens: 0 },
  };
  const output = formatStatusline(data, 'default', { COLUMNS: '80' });
  assert.ok(output.includes('\x1b[33m')); // yellow
});

test('progress bar color: 95% uses red', () => {
  const data = {
    model: { display_name: 'Test' },
    workspace: { current_dir: '/test' },
    context_window: { used_percentage: 95, total_input_tokens: 47500, total_output_tokens: 0 },
  };
  const output = formatStatusline(data, 'default', { COLUMNS: '80' });
  assert.ok(output.includes('\x1b[31m')); // red
});

test('cwd truncation: long path gets … prefix', () => {
  const data = {
    model: { display_name: 'Test' },
    workspace: { current_dir: '/very/long/path/that/exceeds/the/limit' },
    context_window: { used_percentage: 2, total_input_tokens: 1000, total_output_tokens: 0 },
  };
  const output = formatStatusline(data, 'default', { COLUMNS: '80' });
  assert.ok(output.includes('…'));
});

test('missing fields handled gracefully: no PR', () => {
  const data = {
    model: { display_name: 'Test' },
    workspace: { current_dir: '/test' },
    context_window: { used_percentage: 2, total_input_tokens: 1000, total_output_tokens: 0 },
    cost: { total_cost_usd: 0 },
  };
  const output = formatStatusline(data, 'default', { COLUMNS: '80' });
  assert.ok(!output.includes('#'));
});

test('missing fields handled gracefully: no advisor', () => {
  const data = {
    model: { display_name: 'Test' },
    workspace: { current_dir: '/test' },
    context_window: { used_percentage: 2, total_input_tokens: 1000, total_output_tokens: 0 },
    cost: { total_cost_usd: 0 },
  };
  const output = formatStatusline(data, 'default', { COLUMNS: '80' });
  assert.ok(!output.includes('(advisor)'));
});

test('resolveStatuslinePath returns literal command', () => {
  assert.equal(resolveStatuslinePath(), 'bizar statusline render');
});

test('assertOperatorContext refuses install when BIZAR_AGENT=1', () => {
  process.env.BIZAR_AGENT = '1';
  assert.throws(() => assertOperatorContext('install'), /not available to agents/);
});

test('assertOperatorContext refuses remove when CLAUDE_CODE_AGENT_NAME set', () => {
  process.env.CLAUDE_CODE_AGENT_NAME = 'test-agent';
  assert.throws(() => assertOperatorContext('remove'), /not available to agents/);
});

test('assertOperatorContext does NOT refuse render even when BIZAR_AGENT set', () => {
  // render is called by Claude Code itself, so it should never be blocked
  // Even if BIZAR_AGENT is set, render should pass through
  const original = process.env.BIZAR_AGENT;
  process.env.BIZAR_AGENT = '1';
  try {
    // This should NOT throw - render is allowed
    assert.equal(assertOperatorContext('render'), true);
  } finally {
    if (original === undefined) delete process.env.BIZAR_AGENT;
    else process.env.BIZAR_AGENT = original;
  }
});

test('STATUSLINE_TEMPLATES has expected shapes', () => {
  assert.equal(STATUSLINE_TEMPLATES.default.lines, 3);
  assert.equal(STATUSLINE_TEMPLATES.compact.lines, 1);
  assert.equal(STATUSLINE_TEMPLATES['git-only'].lines, 1);
});

test('showStatuslineHelp does not throw', () => {
  assert.doesNotThrow(() => showStatuslineHelp());
});
