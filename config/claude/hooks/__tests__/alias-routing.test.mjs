/**
 * config/claude/hooks/__tests__/alias-routing.test.mjs
 *
 * Behavior-lock test for the shipped Claude Code settings template.
 *
 * After the OmniRoute alias-routing overhaul (see
 * .omx/plans/2026-09-05-omniroute-alias-routing-overhaul.md), the
 * shipped `config/claude/settings.json` template is the sole owner of
 * the native -> OmniRoute alias binding:
 *
 *   - top-level `model` is the native default ("sonnet")
 *   - `env.ANTHROPIC_DEFAULT_SONNET_MODEL` -> "default"
 *   - `env.ANTHROPIC_DEFAULT_HAIKU_MODEL`  -> "common"
 *   - `env.ANTHROPIC_DEFAULT_OPUS_MODEL`   -> "hard"
 *   - `env.ANTHROPIC_DEFAULT_FABLE_MODEL`  -> "fable"
 *   - `env.ANTHROPIC_MODEL`                is NOT set
 *   - `env.CLAUDE_CODE_SUBAGENT_MODEL`     is NOT set
 *   - `modelOverrides` (if present) maps concrete Anthropic keys to
 *     the four combo names
 *
 * These tests currently FAIL against the pre-implementation tree; they
 * are the contract to satisfy before deleting the legacy router code.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const SETTINGS_PATH = join(REPO_ROOT, 'config', 'claude', 'settings.json');

function loadSettings() {
  return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
}

const ALLOWED_COMBOS = ['default', 'common', 'hard', 'fable'];

test('alias-routing: top-level model is the native default "sonnet"', () => {
  const settings = loadSettings();
  assert.equal(
    settings.model,
    'sonnet',
    `expected settings.model === "sonnet"; got ${JSON.stringify(settings.model)}`,
  );
});

test('alias-routing: ANTHROPIC_DEFAULT_SONNET_MODEL maps to "default"', () => {
  const settings = loadSettings();
  assert.equal(
    settings.env && settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL,
    'default',
    `expected env.ANTHROPIC_DEFAULT_SONNET_MODEL === "default"; got ${
      JSON.stringify(settings.env && settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL)
    }`,
  );
});

test('alias-routing: ANTHROPIC_DEFAULT_HAIKU_MODEL maps to "common"', () => {
  const settings = loadSettings();
  assert.equal(
    settings.env && settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
    'common',
    `expected env.ANTHROPIC_DEFAULT_HAIKU_MODEL === "common"; got ${
      JSON.stringify(settings.env && settings.env.ANTHROPIC_DEFAULT_HAIKU_MODEL)
    }`,
  );
});

test('alias-routing: ANTHROPIC_DEFAULT_OPUS_MODEL maps to "hard"', () => {
  const settings = loadSettings();
  assert.equal(
    settings.env && settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL,
    'hard',
    `expected env.ANTHROPIC_DEFAULT_OPUS_MODEL === "hard"; got ${
      JSON.stringify(settings.env && settings.env.ANTHROPIC_DEFAULT_OPUS_MODEL)
    }`,
  );
});

test('alias-routing: ANTHROPIC_DEFAULT_FABLE_MODEL maps to "fable"', () => {
  const settings = loadSettings();
  assert.equal(
    settings.env && settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL,
    'fable',
    `expected env.ANTHROPIC_DEFAULT_FABLE_MODEL === "fable"; got ${
      JSON.stringify(settings.env && settings.env.ANTHROPIC_DEFAULT_FABLE_MODEL)
    }`,
  );
});

test('alias-routing: ANTHROPIC_MODEL is NOT set in env (no global override)', () => {
  const settings = loadSettings();
  const env = settings.env || {};
  assert.ok(
    env.ANTHROPIC_MODEL === undefined,
    `expected env.ANTHROPIC_MODEL to be unset; got ${JSON.stringify(env.ANTHROPIC_MODEL)}`,
  );
});

test('alias-routing: CLAUDE_CODE_SUBAGENT_MODEL is NOT set in env (no subagent override)', () => {
  const settings = loadSettings();
  const env = settings.env || {};
  assert.ok(
    env.CLAUDE_CODE_SUBAGENT_MODEL === undefined,
    `expected env.CLAUDE_CODE_SUBAGENT_MODEL to be unset; got ${JSON.stringify(env.CLAUDE_CODE_SUBAGENT_MODEL)}`,
  );
});

test('alias-routing: modelOverrides (if present) maps concrete Anthropic keys -> combo names', () => {
  const settings = loadSettings();
  const overrides = settings.modelOverrides || {};
  // If `modelOverrides` is shipped, every value MUST be one of the
  // four combo names. Keys must be concrete Anthropic model keys, not
  // arbitrary alias strings.
  for (const [key, value] of Object.entries(overrides)) {
    assert.ok(
      ALLOWED_COMBOS.includes(value),
      `modelOverrides["${key}"] = ${JSON.stringify(value)} is not one of the four OmniRoute combos (${ALLOWED_COMBOS.join(', ')})`,
    );
  }
  for (const value of Object.values(overrides)) {
    assert.ok(
      typeof value === 'string',
      `modelOverrides value must be a string; got ${typeof value}`,
    );
    assert.ok(
      !value.includes('/'),
      `modelOverrides value "${value}" looks like a raw gateway ID (contains "/"); values must be combo names only`,
    );
  }
});
