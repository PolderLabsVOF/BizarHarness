/**
 * src/server/claude-session-watcher.test.mjs
 *
 * F-040 — Unit tests for the claude-session-watcher. Run with:
 *   node --test bizar-dash/src/server/claude-session-watcher.test.mjs
 *
 * Covers (12 cases total):
 *   1.  _testProcessTail reads existing file content
 *   2.  _testProcessTail picks up appended lines
 *   3.  _testProcessTail resets on file truncation
 *   4.  _testProcessTail buffers partial trailing lines
 *   5.  Multiple JSONL files tracked independently via _testInit
 *   6.  Agent tool_use emits claude:tool-use with agentName
 *   7.  result success emits claude:session-ended completed
 *   8.  result error_during_execution emits claude:session-ended failed
 *   9.  Non-Agent tool_use emits only claude:session-activity
 *   10. start() is idempotent (returns true once, false after)
 *   11. stop() clears all watchers (isActive() returns false)
 *   12. Default start() resolves CLAUDE_SESSIONS_DIR
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  claudeSessionWatcher,
  _testProcessTail,
  _testInit,
} from './claude-session-watcher.mjs';

const { agentsStore } = await import('./agents-store.mjs');

let tmpRoot;
before(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'f040-watcher-'));
});

after(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  try { claudeSessionWatcher.stop(); } catch { /* ignore */ }
});

function writeSession(id, lines) {
  const dir = join(tmpRoot, id);
  mkdirSync(dir, { recursive: true });
  const fp = join(dir, 'messages.jsonl');
  writeFileSync(fp, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
  return fp;
}

function waitFor(predicate, { timeoutMs = 1500, intervalMs = 25 } = {}) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      try {
        if (predicate()) return resolve();
      } catch { /* ignore */ }
      if (Date.now() - started > timeoutMs) return reject(new Error('waitFor timed out'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

test('_testProcessTail reads existing file content', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'f040-tail-'));
  try {
    const fp = join(tmp, 'messages.jsonl');
    writeFileSync(fp, JSON.stringify({ type: 'system', subtype: 'init' }) + '\n');
    const r = _testProcessTail(fp, 0);
    assert.equal(r.lines.length, 1);
    assert.equal(r.truncated, false);
    assert.ok(r.newSize > 0);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('_testProcessTail picks up appended lines', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'f040-tail-'));
  try {
    const fp = join(tmp, 'messages.jsonl');
    writeFileSync(fp, JSON.stringify({ type: 'system', subtype: 'init' }) + '\n');
    const r1 = _testProcessTail(fp, 0);
    appendFileSync(fp, JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }) + '\n');
    const r2 = _testProcessTail(fp, r1.newSize);
    assert.equal(r2.lines.length, 1);
    assert.equal(r2.truncated, false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('_testProcessTail resets on truncation', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'f040-tail-'));
  try {
    const fp = join(tmp, 'messages.jsonl');
    // Initial: a long line that sets lastSize to a known larger value.
    writeFileSync(fp, JSON.stringify({ type: 'system', subtype: 'init', session_id: 'ses_long_xxxxxxxxxxxxxxxxx' }) + '\n');
    const r1 = _testProcessTail(fp, 0);
    assert.ok(r1.newSize > 40);
    // Now shrink the file (truncation) — this should reset lastSize to 0
    // and re-read the whole smaller file.
    writeFileSync(fp, JSON.stringify({ type: 'system', subtype: 'init', session_id: 'short' }) + '\n');
    const r2 = _testProcessTail(fp, r1.newSize);
    assert.equal(r2.truncated, true);
    assert.equal(r2.lines.length, 1);
    assert.ok(r2.lines[0].includes('short'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('_testProcessTail buffers partial trailing lines', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'f040-tail-'));
  try {
    const fp = join(tmp, 'messages.jsonl');
    writeFileSync(fp, '{"type":"system"');
    const r = _testProcessTail(fp, 0);
    assert.equal(r.lines.length, 0, 'no complete line yet');
    assert.ok(r.newSize < Buffer.byteLength('{"type":"system"', 'utf8'));
    appendFileSync(fp, ',"subtype":"init","session_id":"ses_t12"}\n');
    const r2 = _testProcessTail(fp, r.newSize);
    assert.equal(r2.lines.length, 1);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('multiple JSONL files are tracked independently', async () => {
  writeSession('ses_multi1', [
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'one' }] } },
  ]);
  writeSession('ses_multi2', [
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'two' }] } },
  ]);
  const evts = [];
  const off = _testInit({ sessionDir: tmpRoot, onEvent: (e) => evts.push(e) });
  try {
    await waitFor(() => {
      const ids = new Set(evts.filter((e) => e.type === 'claude:session-activity').map((e) => e.sessionId));
      return ids.has('ses_multi1') && ids.has('ses_multi2');
    });
    const ids = new Set(evts.filter((e) => e.type === 'claude:session-activity').map((e) => e.sessionId));
    assert.ok(ids.has('ses_multi1'));
    assert.ok(ids.has('ses_multi2'));
  } finally {
    off.stop();
  }
});

test('Agent tool_use emits claude:tool-use with agentName', async () => {
  writeSession('ses_agent', [{
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'tu_1', name: 'Agent', input: { subagent_type: 'coder', prompt: 'write a hello world' } },
      ],
    },
  }]);
  const evts = [];
  const off = _testInit({ sessionDir: tmpRoot, onEvent: (e) => evts.push(e) });
  try {
    await waitFor(() => evts.some((e) => e.type === 'claude:tool-use' && e.sessionId === 'ses_agent'));
    const evt = evts.find((e) => e.type === 'claude:tool-use' && e.sessionId === 'ses_agent');
    assert.equal(evt.agentName, 'coder');
    assert.equal(evt.name, 'Agent');
    assert.equal(evt.toolUseId, 'tu_1');
    assert.ok(evt.args && evt.args.subagent_type === 'coder');
  } finally {
    off.stop();
  }
});

test('result success emits claude:session-ended completed', async () => {
  writeSession('ses_done', [{
    type: 'result',
    subtype: 'success',
    session_id: 'ses_done',
    is_error: false,
    duration_ms: 100,
  }]);
  const evts = [];
  const off = _testInit({ sessionDir: tmpRoot, onEvent: (e) => evts.push(e) });
  try {
    await waitFor(() => evts.some((e) => e.type === 'claude:session-ended' && e.sessionId === 'ses_done' && e.reason === 'completed'));
    const evt = evts.find((e) => e.type === 'claude:session-ended' && e.sessionId === 'ses_done');
    assert.equal(evt.reason, 'completed');
  } finally {
    off.stop();
  }
});

test('result error_during_execution emits claude:session-ended failed', async () => {
  writeSession('ses_err', [{
    type: 'result',
    subtype: 'error_during_execution',
    session_id: 'ses_err',
    is_error: true,
  }]);
  const evts = [];
  const off = _testInit({ sessionDir: tmpRoot, onEvent: (e) => evts.push(e) });
  try {
    await waitFor(() => evts.some((e) => e.type === 'claude:session-ended' && e.sessionId === 'ses_err' && e.reason === 'failed'));
    const evt = evts.find((e) => e.type === 'claude:session-ended' && e.sessionId === 'ses_err');
    assert.equal(evt.reason, 'failed');
  } finally {
    off.stop();
  }
});

test('Non-Agent tool_use emits only claude:session-activity', async () => {
  writeSession('ses_other', [{
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 'tu_2', name: 'Read', input: { file_path: '/tmp/x' } },
      ],
    },
  }]);
  const evts = [];
  const off = _testInit({ sessionDir: tmpRoot, onEvent: (e) => evts.push(e) });
  try {
    await waitFor(() => evts.some((e) => e.type === 'claude:session-activity' && e.sessionId === 'ses_other'));
    const toolUse = evts.find((e) => e.type === 'claude:tool-use' && e.sessionId === 'ses_other');
    assert.equal(toolUse, undefined);
    const activity = evts.find((e) => e.type === 'claude:session-activity' && e.sessionId === 'ses_other');
    assert.ok(activity);
    assert.equal(activity.lastToolName, 'Read');
  } finally {
    off.stop();
  }
});

test('start() is idempotent — returns true once, false after', () => {
  claudeSessionWatcher.stop();
  const a = claudeSessionWatcher.start({ sessionDir: tmpRoot });
  const b = claudeSessionWatcher.start({ sessionDir: tmpRoot });
  assert.equal(a, true);
  assert.equal(b, false);
  claudeSessionWatcher.stop();
});

test('stop() clears all watchers (isActive() returns false)', () => {
  claudeSessionWatcher.start({ sessionDir: tmpRoot });
  assert.equal(claudeSessionWatcher.isActive(), true);
  const stopped = claudeSessionWatcher.stop();
  assert.equal(stopped, true);
  assert.equal(claudeSessionWatcher.isActive(), false);
});

test('default start() resolves CLAUDE_SESSIONS_DIR', () => {
  claudeSessionWatcher.stop();
  // Just verify start() works without a sessionDir override. The
  // module-level CLAUDE_SESSIONS_DIR is computed at import time from
  // process.env.HOME; we don't try to change HOME here because the
  // constant is captured at module load.
  const started = claudeSessionWatcher.start();
  assert.equal(started, true);
  claudeSessionWatcher.stop();
});