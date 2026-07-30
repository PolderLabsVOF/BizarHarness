#!/usr/bin/env node
/**
 * .claude/hooks/__tests__/sessionend-recall.test.mjs
 *
 * Unit tests for sessionend-recall.mjs — SessionEnd hook that writes
 * .bizar/sessions/<date>-<id>.md and .bizar/session-state.json from a
 * synthesized transcript.
 *
 * Strategy: spawn the hook binary with a synthetic transcript on disk;
 * assert files are written correctly.
 */
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(__dirname, '..', 'sessionend-recall.mjs');

function runHook(inputJson, cwd) {
  const r = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(inputJson),
    encoding: 'utf8',
    cwd: cwd || process.cwd(),
    timeout: 8000,
  });
  return { status: r.status, stdout: r.stdout.trim(), stderr: r.stderr.trim() };
}

function makeProject({ withActiveFeature = true } = {}) {
  const dir = join(tmpdir(), `bh-recall-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, '.bizar'), { recursive: true });
  if (withActiveFeature) {
    writeFileSync(
      join(dir, 'feature_list.json'),
      JSON.stringify({
        features: [
          { id: 'F-103', state: 'active', behavior: 'rewrite sessionstart-prime' },
        ],
      }),
    );
  }
  return dir;
}

function makeTranscript(events) {
  const path = join(tmpdir(), `bh-transcript-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jsonl`);
  writeFileSync(path, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return path;
}

function readSessionState(dir) {
  const p = join(dir, '.bizar', 'session-state.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function readSessionNote(dir) {
  const p = join(dir, '.bizar', 'sessions');
  if (!existsSync(p)) return null;
  const files = readdirSync(p).filter((f) => f.endsWith('.md'));
  if (files.length === 0) return null;
  const newest = files.sort().slice(-1)[0];
  return { name: newest, body: readFileSync(join(p, newest), 'utf8') };
}

// ── Tests ──────────────────────────────────────────────────────────────────

test('SessionEnd: writes session note + state from transcript', () => {
  const dir = makeProject();
  const transcript = makeTranscript([
    { type: 'message', timestamp: '2026-07-22T18:00:00Z', message: { role: 'user', content: 'implement F-103 hook overhaul' } },
    { type: 'message', timestamp: '2026-07-22T18:00:05Z', message: { role: 'assistant', content: [
      { type: 'tool_use', name: 'Write', input: { file_path: '/home/user/.claude/hooks/sessionstart-prime.mjs', content: 'x' } },
    ]}},
    { type: 'message', timestamp: '2026-07-22T18:00:10Z', message: { role: 'user', content: 'continue' } },
  ]);
  try {
    const { status } = runHook({
      session_id: 'abc123def456789',
      reason: 'exit',
      cwd: dir,
      transcript_path: transcript,
    });
    assert.equal(status, 0);
    const state = readSessionState(dir);
    assert.ok(state);
    assert.equal(state.lastSessionId, 'abc123def456789');
    assert.equal(state.reason, 'exit');
    assert.equal(state.activeFeature, 'F-103');
    assert.match(state.nextStep, /implement F-103 hook overhaul/);
    const note = readSessionNote(dir);
    assert.ok(note);
    assert.match(note.name, /\d{4}-\d{2}-\d{2}-abc123de\.md/);
    assert.match(note.body, /activeFeature: F-103/);
    assert.match(note.body, /implement F-103 hook overhaul/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionEnd: extracts bash commands and tools used', () => {
  const dir = makeProject();
  const transcript = makeTranscript([
    { type: 'message', timestamp: '2026-07-22T18:00:00Z', message: { role: 'user', content: 'fix the bug' } },
    { type: 'message', timestamp: '2026-07-22T18:00:05Z', message: { role: 'assistant', content: [
      { type: 'tool_use', name: 'Bash', input: { command: 'ls /missing' } },
      { type: 'tool_use', name: 'Edit', input: { file_path: '/tmp/foo.mjs' } },
      { type: 'tool_use', name: 'Bash', input: { command: 'make check' } },
    ]}},
  ]);
  try {
    runHook({ session_id: 'xyz987', reason: 'exit', cwd: dir, transcript_path: transcript });
    const state = readSessionState(dir);
    assert.ok(state);
    assert.equal(state.toolsUsed.Bash, 2);
    assert.equal(state.toolsUsed.Edit, 1);
    assert.ok(state.filesTouched.includes('/tmp/foo.mjs'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionEnd: captures errors as blockers', () => {
  const dir = makeProject();
  const transcript = makeTranscript([
    { type: 'message', timestamp: '2026-07-22T18:00:00Z', message: { role: 'user', content: 'fix the bug' } },
    { type: 'message', timestamp: '2026-07-22T18:00:05Z', message: { role: 'assistant', content: [
      { type: 'tool_use', id: 'x1', name: 'Bash', input: { command: 'cat /missing' } },
    ]}},
    { type: 'message', timestamp: '2026-07-22T18:00:06Z', message: { role: 'tool', content: [
      { type: 'tool_result', tool_use_id: 'x1', content: 'Error: ENOENT: no such file or directory' },
    ]}},
  ]);
  try {
    runHook({ session_id: 'err', reason: 'exit', cwd: dir, transcript_path: transcript });
    const state = readSessionState(dir);
    assert.ok(state);
    assert.ok(state.blockers.some((b) => b.includes('ENOENT')));
    assert.match(state.nextStep, /Resolve Error: ENOENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionEnd: skips filler prompts when picking nextStep', () => {
  const dir = makeProject();
  const transcript = makeTranscript([
    { type: 'message', timestamp: '2026-07-22T18:00:00Z', message: { role: 'user', content: 'rewire the SessionStart briefing' } },
    { type: 'message', timestamp: '2026-07-22T18:00:05Z', message: { role: 'user', content: 'continue' } },
    { type: 'message', timestamp: '2026-07-22T18:00:10Z', message: { role: 'user', content: 'yes' } },
    { type: 'message', timestamp: '2026-07-22T18:00:15Z', message: { role: 'user', content: 'go on' } },
  ]);
  try {
    runHook({ session_id: 'filer', reason: 'exit', cwd: dir, transcript_path: transcript });
    const state = readSessionState(dir);
    assert.ok(state);
    assert.match(state.nextStep, /rewire the SessionStart briefing/);
    assert.doesNotMatch(state.nextStep, /Resume: continue/);
    assert.doesNotMatch(state.nextStep, /Resume: yes/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionEnd: zero active features surfaces "pick next"', () => {
  const dir = makeProject({ withActiveFeature: false });
  const transcript = makeTranscript([]);  // empty transcript → no prompts
  try {
    runHook({ session_id: 'noact', reason: 'exit', cwd: dir, transcript_path: transcript });
    const state = readSessionState(dir);
    assert.ok(state);
    assert.equal(state.activeFeature, null);
    assert.match(state.nextStep, /Pick next feature/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionEnd: malformed JSONL lines are skipped, hook exits 0', () => {
  const dir = makeProject();
  const transcript = join(tmpdir(), `bh-bad-${Date.now()}.jsonl`);
  writeFileSync(
    transcript,
    'not json\n{"type":"message","timestamp":"2026-07-22T18:00:00Z","message":{"role":"user","content":"real prompt"}}\nstill bad\n',
  );
  try {
    const { status } = runHook({ session_id: 'junk', reason: 'exit', cwd: dir, transcript_path: transcript });
    assert.equal(status, 0);
    const state = readSessionState(dir);
    assert.ok(state);
    assert.match(state.nextStep, /real prompt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
19  }
});

test('SessionEnd: missing transcript_path is graceful, exits 0', () => {
  const dir = makeProject();
  try {
    const { status } = runHook({ session_id: 'none', reason: 'exit', cwd: dir });
    assert.equal(status, 0);
    const state = readSessionState(dir);
    assert.ok(state);
    // No transcript means no user prompts, no errors.
    assert.equal(state.filesTouched.length, 0);
    assert.equal(state.blockers.length, 0);
    // F-103 is active in the default fixture, so nextStep continues with it.
    assert.match(state.nextStep, /Continue with F-103/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionEnd: invalid JSON on stdin exits 0 with empty state', () => {
  const dir = makeProject();
  try {
    const r = spawnSync('node', [HOOK_PATH], {
      input: 'not json',
      encoding: 'utf8',
      cwd: dir,
      timeout: 8000,
    });
    assert.equal(r.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SessionEnd: handles transcript with 200+ lines (cap respected)', () => {
  const dir = makeProject();
  const events = [];
  for (let i = 0; i < 250; i++) {
    events.push({
      type: 'message',
      timestamp: `2026-07-22T18:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`,
      message: { role: 'user', content: i === 249 ? 'final substantive prompt' : `prompt ${i}` },
    });
  }
  const transcript = makeTranscript(events);
  try {
    const { status } = runHook({ session_id: 'long', reason: 'exit', cwd: dir, transcript_path: transcript });
    assert.equal(status, 0);
    const state = readSessionState(dir);
    assert.ok(state);
    assert.match(state.nextStep, /final substantive prompt|Resume: final substantive prompt/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
