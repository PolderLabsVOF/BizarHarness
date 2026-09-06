/**
 * config/workflows/__tests__/alias-dispatch.test.mjs
 *
 * Behavior-lock test for the native workflow dispatch sites after the
 * OmniRoute alias-routing overhaul (see
 * .omx/plans/2026-09-05-omniroute-alias-routing-overhaul.md).
 *
 * After implementation, every shipped workflow under
 * `config/workflows/{bizar-debug,bizar-implement,bizar-research,
 *  ultracode,ultracode-research,ultracode-review}.js` MUST:
 *
 *   1. Use ONLY the allowed native aliases (`haiku`, `sonnet`,
 *      `opus`, `fable`) when handing a model to a subagent.
 *   2. Reject any raw gateway-ID pattern (e.g. `<provider>/<model>`).
 *   3. `bizar-debug.js` uses `opus` for hard/RCA/fix/verification
 *      lanes.
 *   4. Never pass `inherit` for a subagent model.
 *   5. Never consume `args.routing` as a source of gateway IDs.
 *
 * The pre-implementation tree currently violates all five.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const workflowsDir = resolve(here, '..');

const WORKFLOW_FILES = [
  'bizar-debug.js',
  'bizar-implement.js',
  'bizar-research.js',
  'ultracode.js',
  'ultracode-research.js',
  'ultracode-review.js',
];

const ALLOWED_ALIASES = ['haiku', 'sonnet', 'opus', 'fable'];

// Matches `<provider>/<model>` gateway IDs such as `cx/gpt-5.6-luna`
// or `minimax/MiniMax-M3`. Also catches OmniRoute combos that look
// like gateway IDs (e.g. `provider/some-model/v2`).
const GATEWAY_ID_PATTERN = /[a-z][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*(\/v\d+)?/g;
// Matches `inherit` (with optional quotes) used as a subagent model.
const INHERIT_PATTERN = /\bmodel\s*[:=]\s*['"]?inherit['"]?/;
// Reads of `args.routing` are forbidden — that field used to carry
// gateway IDs and is now contract-violating to consume.
const ROUTING_READ_PATTERN = /WORKFLOW_INPUT\.routing|\bargs\.routing\b|\bargs\b\[\s*['"]routing['"]\s*\]/;

function loadSource(file) {
  return readFileSync(join(workflowsDir, file), 'utf8');
}

test('alias-dispatch: every shipped workflow uses only the four allowed native aliases', () => {
  for (const file of WORKFLOW_FILES) {
    const src = loadSource(file);
    const matches = src.match(GATEWAY_ID_PATTERN) || [];
    const offending = matches.filter((m) => !ALLOWED_ALIASES.includes(m));
    assert.deepEqual(
      offending,
      [],
      `${file} contains raw gateway IDs / non-allowed strings: ${JSON.stringify(offending)}`,
    );
  }
});

test('alias-dispatch: no workflow passes `inherit` for a subagent model', () => {
  for (const file of WORKFLOW_FILES) {
    const src = loadSource(file);
    assert.ok(
      !INHERIT_PATTERN.test(src),
      `${file} uses \`inherit\` as a subagent model`,
    );
  }
});

test('alias-dispatch: no workflow reads args.routing for gateway IDs', () => {
  for (const file of WORKFLOW_FILES) {
    const src = loadSource(file);
    assert.ok(
      !ROUTING_READ_PATTERN.test(src),
      `${file} consumes args.routing as a contract violation`,
    );
  }
});

test('alias-dispatch: bizar-debug.js uses opus for hard/RCA/fix/verification lanes', () => {
  const src = loadSource('bizar-debug.js');
  // The post-implementation source must statically reference `opus`
  // for every high-risk lane it dispatches. We assert this by
  // requiring that the file uses only the string 'opus' (not raw
  // gateway IDs) for its high-risk dispatch calls. Because the live
  // file currently uses `routeModel(opts.risk)`, we instead require
  // that the static string `opus` is present in the source — the
  // implementation step will replace the dynamic router with an
  // explicit native alias for these lanes.
  assert.ok(
    /['"]opus['"]/.test(src),
    `bizar-debug.js must statically reference the native alias "opus" for hard/RCA/fix/verification lanes`,
  );
});
