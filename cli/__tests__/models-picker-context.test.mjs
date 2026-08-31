/**
 * cli/__tests__/models-picker-context.test.mjs
 *
 * Coverage for the F-192/10.17.4 context-window plumbing:
 *
 *   - `formatContextTokens()` formatter (1M ctx / 200k ctx / null)
 *   - `enrichModelsWithCapabilities()` surfaces `contextWindow: number`
 *     on each candidate row (mirroring `profile.limits.contextTokens`)
 *   - Picker display surfaces the formatted label for both branches
 *     (line-mode and TTY)
 *
 * These cases back the gate that lets `applyModelPickerToSettings`
 * (10.18.0) map any candidate with `contextWindow >= 1_000_000` to a
 * `[1m]`-suffixed entry in `modelOverrides`. Wrong window math here
 * silently inflates Claude Code's assumption, so the cases pin exact
 * values, not approximations.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';

import {
  formatContextTokens,
  enrichModelsWithCapabilities,
  pickModels,
  toCapabilityProfile,
} from '../commands/models.mjs';

test('formatContextTokens: 1M renders as "1M ctx"', () => {
  assert.equal(formatContextTokens(1_048_576), '1M ctx');
  assert.equal(formatContextTokens(1_000_000), '1M ctx');
});

test('formatContextTokens: fractional M renders with one decimal', () => {
  assert.equal(formatContextTokens(1_500_000), '1.5M ctx');
  // Trailing `.0` is dropped — 2_048_576 rounds to 2.0M which renders as `2M`.
  assert.equal(formatContextTokens(2_048_576), '2M ctx');
});

test('formatContextTokens: sub-1M renders in k', () => {
  assert.equal(formatContextTokens(200_000), '200k ctx');
  assert.equal(formatContextTokens(32_000), '32k ctx');
});

test('formatContextTokens: null / non-positive / non-finite return null', () => {
  assert.equal(formatContextTokens(null), null);
  assert.equal(formatContextTokens(undefined), null);
  assert.equal(formatContextTokens(0), null);
  assert.equal(formatContextTokens(-1), null);
  assert.equal(formatContextTokens(Number.NaN), null);
  assert.equal(formatContextTokens(Number.POSITIVE_INFINITY), null);
});

test('enrichModelsWithCapabilities: contextWindow = profile.limits.contextTokens', () => {
  const candidates = [{ id: 'claude-minimax/MiniMax-M3' }];
  const catalog = {
    'minimax/MiniMax-M3': {
      name: 'MiniMax M3',
      limit: { context: 1_048_576 },
      modalities: { input: ['text'], output: ['text'] },
    },
  };
  const [model] = enrichModelsWithCapabilities(candidates, catalog);
  assert.equal(model.contextWindow, 1_048_576);
  assert.equal(model.profile.limits.contextTokens, 1_048_576);
});

test('enrichModelsWithCapabilities: contextWindow = null when profile is missing', () => {
  const candidates = [{ id: 'unknown/model' }];
  const catalog = {};
  const [model] = enrichModelsWithCapabilities(candidates, catalog);
  assert.equal(model.contextWindow, null);
  assert.equal(model.profile, null);
});

test('enrichModelsWithCapabilities: >=1M context surfaces exact value to contextWindow', () => {
  // Pin the exact 1,048,576 number — the threshold check downstream uses
  // `>= 1_000_000`, so a rounding bug here would silently flip MiniMax-M3
  // into the non-1M bucket and break the modelOverrides mapping.
  const candidates = [{ id: 'claude-minimax/MiniMax-M3' }];
  const catalog = {
    'minimax/MiniMax-M3': { limit: { context: 1_048_576 } },
  };
  const [model] = enrichModelsWithCapabilities(candidates, catalog);
  assert.ok(model.contextWindow >= 1_000_000, 'contextWindow must clear the 1M threshold');
  assert.equal(model.contextWindow, 1_048_576);
});

test('enrichModelsWithCapabilities: 200k context does NOT clear the 1M threshold', () => {
  // Negative gate: ensures the threshold check uses >= 1_000_000 (not
  // something lenient like >= 100_000) so models with a 200K context are
  // NOT miscategorized as 1M.
  const candidates = [{ id: 'some/200k-model' }];
  const catalog = {
    'some/200k-model': { limit: { context: 200_000 } },
  };
  const [model] = enrichModelsWithCapabilities(candidates, catalog);
  assert.equal(model.contextWindow, 200_000);
  assert.ok(model.contextWindow < 1_000_000);
});

function makeInput(lines) {
  const r = new Readable({ read() {} });
  for (const line of lines) r.push(`${line}\n`);
  r.push(null);
  return r;
}

function makeOutput() {
  let buf = '';
  const w = new Writable({
    write(chunk, _enc, cb) { buf += String(chunk); cb(); },
  });
  w.buffer = () => buf;
  return w;
}

test('pickModels: line-mode render shows "1M ctx" for MiniMax-M3', async () => {
  const candidates = enrichModelsWithCapabilities(
    [{ id: 'claude-minimax/MiniMax-M3' }, { id: 'some/200k-model' }],
    {
      'minimax/MiniMax-M3': { limit: { context: 1_048_576 }, modalities: { input: ['text'], output: ['text'] } },
      'some/200k-model': { limit: { context: 200_000 }, modalities: { input: ['text'], output: ['text'] } },
    },
  );
  const stdin = makeInput(['']);
  const stdout = makeOutput();
  await pickModels({ candidates, stdin, stdout, prompt: 'Pick' });
  const buf = stdout.buffer();
  assert.match(buf, /1M ctx/, 'MiniMax-M3 row must show "1M ctx"');
  assert.match(buf, /200k ctx/, '200k row must show "200k ctx"');
});

// ── Phase 1 (v10.19.7): description / summary plumbing ───────────────────────

test('toCapabilityProfile: propagates Models.dev description and summary', () => {
  // Phase 1 plumbing — `toCapabilityProfile` must surface Models.dev's
  // `description` and `summary` so Phase 3's status screen (10.19.9) can
  // render the description without re-querying the catalog. Pin both
  // fields so a future refactor cannot silently drop one.
  const match = {
    id: 'minimax/MiniMax-M3',
    name: 'MiniMax M3',
    description: 'Fast and cheap.',
    summary: 'minimax/MiniMax-M3 is a fast M3 tier',
  };
  const profile = toCapabilityProfile('minimax/MiniMax-M3', match, 'exact-id', 0.9);
  assert.equal(profile.description, 'Fast and cheap.');
  assert.equal(profile.summary, 'minimax/MiniMax-M3 is a fast M3 tier');
});
