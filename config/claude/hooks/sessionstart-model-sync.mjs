#!/usr/bin/env node
/**
 * sessionstart-model-sync.mjs — Claude Code SessionStart hook.
 *
 * Re-applies the operator's `userSelected.models` block (from
 * `~/.config/bizar/config/claude/model-router.json`) into the three
 * Claude Code settings keys that the operator owns:
 *
 *   - modelPicker   → { options: [{ model, label }] } in user pick order
 *   - modelOverrides → { <id>: <id> } self-map for every live pick
 *   - model         → reset to the first user pick if the current value
 *                     starts with `claude-` (the dead gateway namespace —
 *                     the live gateway rejects it with model_not_found)
 *
 * Why this hook exists:
 *   Claude Code's `/model` picker rewrites `~/.claude/settings.json` on
 *   every user pick. The rewrite preserves most keys but drops `modelPicker`
 *   and rewrites `model` to whatever the gateway returned (often the dead
 *   `claude-<provider>/<model>[1m]` shape). Without this hook the operator
 *   loses their picker list between every Claude Code session.
 *
 * Scope guarantee:
 *   This hook ONLY touches `modelPicker`, `modelOverrides`, and `model`.
 *   Env, mcpServers, permissions, hooks, and every other operator key is
 *   left untouched. The source of truth for picks
 *   (`~/.config/bizar/config/claude/model-router.json`) is also untouched.
 *
 * Failure policy:
 *   This is an advisory hook. Any failure (missing router, malformed JSON,
 *   unwritable settings.json, etc.) is logged to
 *   `~/.config/bizar/hook-logs/model-sync-DATE.jsonl` and swallowed. The
 *   hook always exits 0 — the operator's existing picks survive whatever
 *   Claude Code wrote last, and a broken sync must not block session start.
 *
 * Claude Code SessionStart input:
 *   { session_id, transcript_path, cwd, hook_event_name, source }
 *
 * Claude Code SessionStart output:
 *   { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }
 */

'use strict';

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const HOOK_LOG_DIR = join(homedir(), '.config', 'bizar', 'hook-logs');

function readJsonIfObject(path) {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function readRouterPath() {
  const envOverride = process.env.BIZAR_MODEL_ROUTER_CONFIG;
  if (envOverride && typeof envOverride === 'string' && envOverride.trim()) {
    return envOverride;
  }
  return join(homedir(), '.config', 'bizar', 'config', 'claude', 'model-router.json');
}

function readSettingsPath() {
  return join(homedir(), '.claude', 'settings.json');
}

// Mirrors `cli/commands/models.mjs#deriveModelLabel` without the profile
// override branch. The picker label is meant to be derived from the model
// id; the profile `name`/`displayName` is used elsewhere in `applyModelPicker`
// only when present, but for our session-start re-apply the id-derived label
// is sufficient and matches the helper's behaviour for every live id in the
// router file.
function deriveModelLabel(modelId) {
  const id = String(modelId || '').trim();
  if (!id) return '';
  const slash = id.indexOf('/');
  const tail = slash >= 0 ? id.slice(slash + 1) : id;
  return tail
    .replace(/[\\/]+/g, ' ')
    .replace(/[-_]+/g, ' ')
    .replace(/:/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function atomicWriteJson(path, value) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  renameSync(tmp, path);
}

function logEvent(entry) {
  try {
    mkdirSync(HOOK_LOG_DIR, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    appendFileSync(
      join(HOOK_LOG_DIR, `model-sync-${today}.jsonl`),
      JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n',
    );
  } catch {
    /* best-effort */
  }
}

function buildPayload(appliedCount, modelAfter) {
  const note = appliedCount > 0
    ? `Bizar reapplied ${appliedCount} model picker option(s) to ~/.claude/settings.json (model=${modelAfter}).`
    : '';
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: note,
    },
  };
}

function syncOnce() {
  const routerPath = readRouterPath();
  const router = readJsonIfObject(routerPath);
  const userSelected = router && typeof router === 'object' ? router.userSelected : null;
  const models = userSelected && Array.isArray(userSelected.models) ? userSelected.models : [];
  const profiles = userSelected && userSelected.profiles && typeof userSelected.profiles === 'object'
    ? userSelected.profiles
    : {};
  const liveIds = models.filter((id) => typeof id === 'string' && id.trim());
  if (liveIds.length === 0) {
    return { applied: 0, modelAfter: null, skipped: 'no-userSelected' };
  }

  const settingsPath = readSettingsPath();
  const settings = readJsonIfObject(settingsPath) || {};
  const before = {
    model: typeof settings.model === 'string' ? settings.model : null,
    modelPicker: settings.modelPicker || null,
    modelOverrides: settings.modelOverrides || null,
  };

  const options = liveIds.map((id) => {
    const option = { model: id, label: deriveModelLabel(id) };
    const profile = profiles[id];
    if (profile && typeof profile.description === 'string' && profile.description.trim()) {
      option.description = profile.description.trim();
    }
    return option;
  });

  settings.modelPicker = { options };
  settings.modelOverrides = Object.fromEntries(liveIds.map((id) => [id, id]));

  let modelChanged = false;
  if (typeof settings.model === 'string' && settings.model.startsWith('claude-')) {
    settings.model = liveIds[0];
    modelChanged = true;
  }

  atomicWriteJson(settingsPath, settings);

  const after = {
    model: typeof settings.model === 'string' ? settings.model : null,
    modelPickerOptions: options.length,
    modelOverridesCount: Object.keys(settings.modelOverrides).length,
    modelChanged,
  };

  logEvent({ event: 'sessionstart-model-sync', routerPath, before, after });
  return { applied: options.length, modelAfter: after.model, modelChanged };
}

function run() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { raw += chunk; });
  process.stdin.on('end', () => {
    let input = {};
    try { input = JSON.parse(raw || '{}'); } catch { input = {}; }
    const sessionId = String(input.session_id || '');
    const source = String(input.source || 'startup');
    try {
      const result = syncOnce();
      const payload = buildPayload(result.applied, result.modelAfter);
      process.stdout.write(JSON.stringify(payload) + '\n');
    } catch (err) {
      logEvent({
        event: 'sessionstart-model-sync-error',
        sessionId: sessionId || null,
        source,
        error: err && err.message ? err.message : String(err),
      });
      // Advisory hook — never block session start on a sync failure.
      process.stdout.write('{}\n');
    }
  });
}

run();
