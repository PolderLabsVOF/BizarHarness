/**
 * config/claude/hooks/__tests__/alias-hooks.test.mjs
 *
 * Behavior-lock test for the hook surface after the OmniRoute
 * alias-routing overhaul (see
 * .omx/plans/2026-09-05-omniroute-alias-routing-overhaul.md).
 *
 * After implementation:
 *   - `config/claude/hooks/agent-model-guard.mjs` and
 *     `config/claude/hooks/sessionstart-model-sync.mjs` MUST NOT be
 *     wired into any Bizar hook chain (settings.json dispatcher
 *     commands and `cli/commands/hook.mjs` EVENT_CHAINS / HOOK_PROGRAMS).
 *   - The unrelated safety hooks (`worker-suggest.mjs`,
 *     `workflow-route-guard.mjs`, `thinking-route.mjs`) MUST still
 *     exist on disk and remain in the chain.
 *   - No hook command string contains a `bizar models` recovery
 *     message.
 *
 * The pre-implementation tree currently keeps both removed hooks in
 * the chain (via EVENT_CHAINS / HOOK_PROGRAMS in
 * `cli/commands/hook.mjs`) and surfaces `bizar models` recovery
 * messages from the agent-model-guard source.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const SETTINGS_PATH = join(repoRoot, 'config', 'claude', 'settings.json');
const HOOKS_DIR = join(repoRoot, 'config', 'claude', 'hooks');
const HOOK_DISPATCHER = join(repoRoot, 'cli', 'commands', 'hook.mjs');

function loadSettings() {
  return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
}

function loadDispatcher() {
  return readFileSync(HOOK_DISPATCHER, 'utf8');
}

function flattenHookCommands(settings) {
  const out = [];
  for (const [event, entries] of Object.entries(settings.hooks || {})) {
    for (const entry of entries) {
      const hooks = Array.isArray(entry.hooks) ? entry.hooks : [entry];
      for (const hook of hooks) {
        if (hook && typeof hook.command === 'string') {
          out.push({ event, command: hook.command });
        }
      }
    }
  }
  return out;
}

const REMOVED_HOOKS = ['agent-model-guard.mjs', 'sessionstart-model-sync.mjs'];
const SAFETY_HOOKS = ['worker-suggest.mjs', 'workflow-route-guard.mjs', 'thinking-route.mjs'];

test('alias-hooks: agent-model-guard.mjs is NOT wired into the Bizar hook chain', () => {
  const dispatcher = loadDispatcher();
  // The dispatcher file exports EVENT_CHAINS (frozens object map of
  // event -> array of leaf hook names) and HOOK_PROGRAMS (map of leaf
  // name -> script). Neither map may carry agent-model-guard after
  // the cleanup.
  assert.ok(
    !/['"]agent-model-guard['"]/.test(dispatcher),
    'cli/commands/hook.mjs still references `agent-model-guard` (in HOOK_PROGRAMS, EVENT_CHAINS, or selectEventChain)',
  );
});

test('alias-hooks: sessionstart-model-sync.mjs is NOT wired into the Bizar hook chain', () => {
  const dispatcher = loadDispatcher();
  assert.ok(
    !/['"]sessionstart-model-sync['"]/.test(dispatcher),
    'cli/commands/hook.mjs still references `sessionstart-model-sync` (in HOOK_PROGRAMS, EVENT_CHAINS, or selectEventChain)',
  );
});

test('alias-hooks: settings.json hook command strings do NOT mention the removed hook scripts', () => {
  const commands = flattenHookCommands(loadSettings());
  const offenders = [];
  for (const { command } of commands) {
    for (const removed of REMOVED_HOOKS) {
      if (command.includes(removed)) offenders.push({ command, removed });
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `settings.json hook commands still mention a removed script: ${JSON.stringify(offenders)}`,
  );
});

test('alias-hooks: unrelated safety hook files still exist on disk', () => {
  for (const hook of SAFETY_HOOKS) {
    const path = join(HOOKS_DIR, hook);
    assert.ok(
      existsSync(path),
      `unrelated safety hook ${hook} must remain (it is not a model-routing hook)`,
    );
  }
});

test('alias-hooks: removed hook files are deleted from disk', () => {
  for (const hook of REMOVED_HOOKS) {
    const path = join(HOOKS_DIR, hook);
    assert.equal(
      existsSync(path),
      false,
      `${hook} must be deleted; static alias contract has no model-guard or sync hook`,
    );
  }
});

test('alias-hooks: hook command strings do NOT contain `bizar models` recovery messages', () => {
  const commands = flattenHookCommands(loadSettings());
  const offenders = commands.filter((c) => /\bbizar models\b/.test(c.command));
  assert.deepEqual(
    offenders,
    [],
    `hook command strings still reference \`bizar models\` as a recovery: ${JSON.stringify(offenders)}`,
  );
});

test('alias-hooks: no shipped hook source contains a `bizar models` recovery message', () => {
  // Belt-and-braces: even after the removed hooks are deleted, scan
  // the remaining hook files for recovery messages that direct
  // operators to run `bizar models`. This must remain false.
  for (const hook of SAFETY_HOOKS) {
    const path = join(HOOKS_DIR, hook);
    if (!existsSync(path)) continue;
    const src = readFileSync(path, 'utf8');
    assert.ok(
      !/\bbizar models\b/.test(src),
      `hook ${hook} still contains a \`bizar models\` reference; static alias contract forbids picker references`,
    );
  }
});
