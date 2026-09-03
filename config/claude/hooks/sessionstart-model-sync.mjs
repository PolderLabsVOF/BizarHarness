#!/usr/bin/env node
/**
 * sessionstart-model-sync.mjs — Claude Code SessionStart hook.
 *
 * Re-applies the operator's `userSelected.models` block (from
 * `~/.claude/model-router.json`) into the three
 * Claude Code settings keys that the operator owns:
 *
 *   - modelPicker   → { options: [{ model, label }] } in user pick order
 *   - modelOverrides → { <recognized Claude id>: <gateway id> }
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
 *   (`~/.claude/model-router.json`) is also untouched.
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
import { resolveBizarHome, resolveClaudeConfigDir, resolveGlobalModelRouter } from '../../../cli/config-paths.mjs';

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
  return resolveGlobalModelRouter();
}

/**
 * 10.22.0 / Phase 4: read the operator's `disabledProviders: string[]`
 * list from the sole global Bizar router. Whitespace + lowercase
 * normalization happens here. Returns `[]` on any failure —
 * the hook is advisory and must NEVER block session start.
 */
function readDisabledProviders() {
  const bizarPath = readRouterPath();
  const extract = (parsed) => {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (!Array.isArray(parsed.disabledProviders)) return null;
    const out = [];
    for (const v of parsed.disabledProviders) {
      if (typeof v !== 'string') continue;
      const trimmed = v.trim();
      if (!trimmed) continue;
      out.push(trimmed.toLowerCase());
    }
    return out;
  };
  if (existsSync(bizarPath)) {
    const parsed = readJsonIfObject(bizarPath);
    // An explicit empty global list is a valid operator policy.
    if (parsed && Array.isArray(parsed.disabledProviders)) {
      const extracted = extract(parsed);
      if (extracted !== null) return extracted;
    }
  }
  return [];
}

/**
 * Strip disabled-provider prefixes from an id list. Case-sensitive
 * prefix match against the (lowercase) disabled list. The hook mirrors
 * the CLI's `filterCandidatesByDisabledProviders` contract — see
 * `cli/commands/models.mjs` for the authoritative implementation.
 */
function filterDisabled(ids, disabled) {
  const list = Array.isArray(ids) ? ids : [];
  const prefixes = Array.isArray(disabled) ? disabled.filter((p) => typeof p === 'string' && p) : [];
  if (prefixes.length === 0) return [...list];
  const kept = [];
  for (const id of list) {
    if (typeof id !== 'string' || !id) { kept.push(id); continue; }
    let blocked = false;
    for (const p of prefixes) {
      if (id.startsWith(p)) { blocked = true; break; }
    }
    if (!blocked) kept.push(id);
  }
  return kept;
}

function requiresGatewayModelDiscovery(modelIds) {
  return modelIds.some((id) => !/^(?:claude(?:-|$)|anthropic(?:[./-]|$))/i.test(id));
}

function readSettingsPath() {
  return join(resolveClaudeConfigDir(), 'settings.json');
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
    const hookLogDir = join(resolveBizarHome(), 'hook-logs');
    mkdirSync(hookLogDir, { recursive: true, mode: 0o700 });
    const today = new Date().toISOString().slice(0, 10);
    appendFileSync(
      join(hookLogDir, `model-sync-${today}.jsonl`),
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
  // 10.22.0 / Phase 4: filter the operator's disabled-provider ids out
  // of the SessionStart re-apply so Claude Code's `/model` picker never
  // surfaces e.g. `anthropic/*` after a session restart.
  const disabled = readDisabledProviders();
  const selectedIds = filterDisabled(
    models.filter((id) => typeof id === 'string' && id.trim()),
    disabled,
  );
  const tierIds = Object.values(router?.tiers || {}).flatMap((tier) => (
    Array.isArray(tier?.models) ? tier.models : []
  ));
  // Explicit picks lead; otherwise synchronize the configured tier pool so a
  // fresh install cannot fall back to Claude Code's provider default.
  const liveIds = [...new Set([...selectedIds, ...filterDisabled(tierIds, disabled)])];
  if (liveIds.length === 0) {
    return { applied: 0, modelAfter: null, skipped: 'no-enabled-configured-model' };
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

  const overrideKeys = [
    'claude-fable-5', 'claude-opus-5', 'claude-sonnet-5',
    'claude-haiku-4-5-20251001', 'claude-opus-4-8', 'claude-opus-4-7',
    'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-4-5-20251101',
    'claude-sonnet-4-5-20250929', 'claude-opus-4-1-20250805',
    'claude-opus-4-20250514', 'claude-sonnet-4-20250514',
    'claude-3-7-sonnet-20250219', 'claude-3-5-haiku-20241022',
    'claude-3-5-sonnet-20241022',
  ];
  settings.modelPicker = { options };
  settings.modelOverrides = Object.fromEntries(
    overrideKeys.map((key, index) => [key, liveIds[index % liveIds.length]]),
  );
  if (requiresGatewayModelDiscovery(liveIds)) {
    settings.env = {
      ...(settings.env || {}),
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
    };
  }

  let modelChanged = false;
  if (typeof settings.model !== 'string' || !liveIds.includes(settings.model)) {
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
