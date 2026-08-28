/**
 * cli/__tests__/advisor-context.test.mjs
 *
 * Leaf-level tests for `config/claude/hooks/advisor-context.mjs`.
 *
 * Background: a previous version of this hook dumped up to 30kB of raw
 * parent-session transcript into every `linda|karen|carl|qa-reviewer|
 * principal-engineer|debug-specialist` dispatch. That meant:
 *   - spinner/status records (`<total_tokens>` reminders, system
 *     records, last-prompt echoes) leaked into the subagent context as
 *     if they were substantive content;
 *   - long-running sessions whose JSONL persisted across sessions
 *     re-injected prior-session content (including unrelated prior
 *     user prompts) into the new session's subagents.
 *
 * The fix (this hook + the narrowed agent list in `cli/commands/hook.mjs`)
 * limits the dump to 8 records, 6kB total, drops non-substantive record
 * types entirely, and falls back to a "could not be reconstructed"
 * message when the dump is too short to be useful.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOK_PATH = join(
  import.meta.dirname,
  '..',
  '..',
  'config',
  'claude',
  'hooks',
  'advisor-context.mjs',
);

function makeContent(text) {
  // Claude Code records store `message.content` as an array of typed blocks.
  // The hook's extractText() only emits text when content is an array of {type:'text'}.
  return [{ type: 'text', text }];
}

function makeTranscript(records) {
  return records.map((r) => JSON.stringify(r)).join('\n') + '\n';
}

function runHook(input, transcriptBody) {
  const dir = mkdtempSync(join(tmpdir(), 'bizar-advisor-'));
  const transcriptPath = join(dir, 'transcript.jsonl');
  writeFileSync(transcriptPath, transcriptBody, 'utf8');
  const stdinPayload = JSON.stringify({ ...input, transcript_path: transcriptPath });
  try {
    const result = spawnSync(process.execPath, [HOOK_PATH], {
      input: stdinPayload,
      encoding: 'utf8',
      timeout: 10_000,
    });
    return { result, dir, transcriptPath };
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

test('advisor-context: filters out attachment / system / last-prompt / ai-title records', () => {
  const body = makeTranscript([
    { type: 'attachment', hookEventName: 'PostToolUse', content: 'BOOKKEEPING: tool_use_id=abc' },
    { type: 'system', subtype: 'total_tokens_reminder', text: '<total_tokens>14999000 tokens left</total_tokens>' },
    { type: 'last-prompt', lastPrompt: 'echoed prompt text' },
    { type: 'ai-title', aiTitle: 'Some title' },
    { type: 'agent-name', agentName: 'Some agent' },
    { type: 'stop_hook_summary', hookCount: 1 },
    // Substantive records that SHOULD appear:
    { type: 'user', message: { role: 'user', content: makeContent('real user prompt one') } },
    { type: 'assistant', message: { role: 'assistant', content: makeContent('real assistant reply one') } },
    { type: 'user', message: { role: 'user', content: makeContent('real user prompt two') } },
  ]);
  const { result, dir } = runHook({ agent_type: 'linda' }, body);
  try {
    assert.equal(result.status, 0, result.stderr);
    const out = JSON.parse(result.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, 'SubagentStart');
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.match(ctx, /real user prompt one/);
    assert.match(ctx, /real assistant reply one/);
    assert.match(ctx, /real user prompt two/);
    // None of the bookkeeping records may appear.
    assert.doesNotMatch(ctx, /BOOKKEEPING/);
    assert.doesNotMatch(ctx, /<total_tokens>/);
    assert.doesNotMatch(ctx, /echoed prompt text/);
    assert.doesNotMatch(ctx, /Some title/);
    assert.doesNotMatch(ctx, /Some agent/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('advisor-context: hard cap on recent body', () => {
  // 20 records, each ~600 chars (under per-record 800 cap so they survive
  // untouched), joined would be ~12kB; must be hard-capped to ~6kB of body
  // content inside <recent-conversation>.
  const records = [];
  for (let i = 0; i < 20; i++) {
    records.push({
      type: i % 2 === 0 ? 'user' : 'assistant',
      message: {
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: makeContent(`marker-${i} ${'x'.repeat(580)}`),
      },
    });
  }
  const { result, dir } = runHook({ agent_type: 'linda' }, makeTranscript(records));
  try {
    assert.equal(result.status, 0);
    const ctx = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    const m = ctx.match(/<recent-conversation>([\s\S]*?)<\/recent-conversation>/);
    assert.ok(m, 'expected <recent-conversation> body');
    const body = m[1];
    // Hard cap: body must stay under 7kB (6000 slice + ~30-byte truncation marker).
    assert.ok(body.length < 7_000, `expected body < 7kB, got ${body.length}`);
    // The most-recent record's marker must survive.
    assert.match(ctx, /marker-19/);
    // The earliest record's marker (followed by the space that separates
    // it from its x-padding) must have been truncated away.
    assert.doesNotMatch(ctx, /marker-0 /, 'expected earliest record to be truncated');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('advisor-context: takes only the last 8 substantive records', () => {
  // 15 substantive records; only the last 8 should appear.
  const records = [];
  for (let i = 0; i < 15; i++) {
    records.push({
      type: i % 2 === 0 ? 'user' : 'assistant',
      message: { role: i % 2 === 0 ? 'user' : 'assistant', content: makeContent(`marker-${i} turn`) },
    });
  }
  const { result, dir } = runHook({ agent_type: 'linda' }, makeTranscript(records));
  try {
    assert.equal(result.status, 0);
    const ctx = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    // The last 8 records are 7..14.
    for (let i = 7; i <= 14; i++) assert.match(ctx, new RegExp(`marker-${i} turn`));
    // Records 0..6 must NOT appear.
    for (let i = 0; i <= 6; i++) assert.doesNotMatch(ctx, new RegExp(`marker-${i} turn`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('advisor-context: skips isSidechain and isMeta records', () => {
  const body = makeTranscript([
    { type: 'user', isSidechain: true, message: { role: 'user', content: makeContent('should not appear') } },
    { type: 'user', isMeta: true, message: { role: 'user', content: makeContent('should not appear either') } },
    { type: 'user', message: { role: 'user', content: makeContent('User asks: walk me through the review and highlight anything that looks off in this batch of changes.') } },
  ]);
  const { result, dir } = runHook({ agent_type: 'linda' }, body);
  try {
    assert.equal(result.status, 0);
    const ctx = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    assert.match(ctx, /walk me through the review/);
    assert.doesNotMatch(ctx, /should not appear/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('advisor-context: empty / non-substantive input falls back to reconstructed-unavailable message', () => {
  // Only bookkeeping records → no dump.
  const body = makeTranscript([
    { type: 'attachment' },
    { type: 'system' },
    { type: 'last-prompt' },
  ]);
  const { result, dir } = runHook({ agent_type: 'linda' }, body);
  try {
    assert.equal(result.status, 0);
    const ctx = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    assert.match(ctx, /could not be reconstructed/i);
    assert.doesNotMatch(ctx, /<recent-conversation>/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('advisor-context: missing transcript_path exits 0 with fallback', () => {
  const result = spawnSync(process.execPath, [HOOK_PATH], {
    input: JSON.stringify({ agent_type: 'linda' }),
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.status, 0);
  const ctx = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.match(ctx, /could not be reconstructed/i);
});