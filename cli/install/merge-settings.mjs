/**
 * cli/install/merge-settings.mjs
 *
 * Canonical settings-merge contract for `~/.claude/settings.json`.
 *
 * Extracted from `cli/provision.mjs:writeClaudeSettings` so the merge logic
 * is testable in isolation and reusable from `cli/install/index.mjs` once
 * the wizard lands. Behavior is byte-equivalent to the prior inline
 * implementation — the canonical regression contract is asserted by
 * `cli/install/__tests__/merge-settings.test.mjs`, which exercises the
 * merge through `writeClaudeSettings` end-to-end.
 *
 * ## Merge strategy
 *
 * The merge preserves operator-added entries under Bizar-owned keys
 * (`mcpServers`, `permissions`, `hooks`) while refreshing Bizar-owned
 * defaults on every run. The `__bizar_managed__: true` marker (defined
 * on `mcpServers.bizar`, `permissions.allow` Bizar-managed entries,
 * and the `hooks` groups tagged via `isBizarOwnedHook`) lets future
 * updates distinguish operator-installed entries from Bizar-installed
 * ones so neither is silently dropped.
 *
 * Precedence (per key) for a normal update:
 *
 *   operator-existing value  >  shipped template default  >  undefined
 *
 * For a forced refresh (`force: true`), Bizar-managed keys are
 * refreshed while operator-added entries (e.g. unrelated env vars)
 * survive intact. The function never silently deletes operator data.
 *
 * The function is pure: it does not read `process.env`, write to disk,
 * or mutate either input object. The caller (`writeClaudeSettings`) is
 * responsible for the disk read/write and process-env cleanup. The
 * canonical regression test exercises the merge end-to-end through
 * `writeClaudeSettings` so the disk boundary stays covered.
 */

import { join } from 'node:path';

const LEGACY_BIZAR_HOOK_FILES = new Set([
  'advisor-context.mjs',
  'agent-grounding.mjs',
  'auto-instinct.sh',
  'content-style-guard.mjs',
  'control-inbox.mjs',
  'git-workflow-guard.mjs',
  'git-command-parser.mjs',
  'keyword-router.mjs',
  'learning-extract.mjs',
  'path-ownership-guard.mjs',
  'permission-request.mjs',
  'persistent-mode.mjs',
  'posttooluse-editwrite.mjs',
  'post-tool-use-failure.mjs',
  'precompact-priorities.sh',
  'pretooluse-bash.mjs',
  'pretooluse-editwrite.mjs',
  'sessionend-recall.mjs',
  'sessionstart-prime.mjs',
  'simplify-guard.mjs',
  'telemetry.mjs',
  'verify-deliverables.mjs',
  'worker-suggest.mjs',
  'workflow-route-guard.mjs',
  'workflow-route-state.mjs',
  'worktree-bootstrap.mjs',
]);

/**
 * Build a `isBizarOwnedHook(hook)` predicate scoped to the operator's
 * Claude hooks directory. The original `provision.mjs` used the runtime
 * `CLAUDE_HOOKS_DIR` constant; we accept it as a parameter so the merge
 * stays pure and the same `mergeSettings` body works for any
 * `CLAUDE_CONFIG_DIR` layout the host uses.
 */
export function buildIsBizarOwnedHook(claudeHooksDir = join('.claude', 'hooks')) {
  return function isBizarOwnedHook(hook) {
    if (!hook || typeof hook !== 'object' || typeof hook.command !== 'string') return false;
    const command = hook.command.trim();
    if (/^(?:"[^"]*bizar"|'[^']*bizar'|bizar)\s+hook\s+[a-z0-9-]+(?:\s|$)/i.test(command)) {
      return true;
    }
    return [...LEGACY_BIZAR_HOOK_FILES].some((name) =>
      command.includes(`/.claude/hooks/${name}`)
      || command.includes(`\\.claude\\hooks\\${name}`)
      || command.includes(join(claudeHooksDir, name)),
    );
  };
}

/**
 * Merge Bizar-owned hook groups with operator-installed hooks. Returns a
 * new hooks object with Bizar-owned entries dropped from the operator's
 * hooks (so they can be replaced by the desired set) and operator-installed
 * entries preserved. Exposed so callers can reuse the hook-merge policy
 * outside of the settings-merge path.
 *
 * @param {object} existingHooks Existing hooks object (may be undefined).
 * @param {object} desiredHooks  Hooks object Bizar wants to install.
 * @param {object} [options]
 * @param {Function} [options.isBizarOwnedHook]
 *   Predicate used to recognise Bizar-owned hook entries. Built by
 *   `buildIsBizarOwnedHook({ claudeHooksDir })`.
 */
export function mergeBizarHooks(existingHooks = {}, desiredHooks = {}, options = {}) {
  const isBizarOwnedHook = options.isBizarOwnedHook || buildIsBizarOwnedHook();
  const cleaned = {};
  for (const [eventName, groups] of Object.entries(existingHooks || {})) {
    if (!Array.isArray(groups)) {
      cleaned[eventName] = groups;
      continue;
    }
    cleaned[eventName] = groups.flatMap((group) => {
      if (!group || typeof group !== 'object' || !Array.isArray(group.hooks)) return [group];
      const hooks = group.hooks.filter((entry) => !isBizarOwnedHook(entry));
      return hooks.length > 0 ? [{ ...group, hooks }] : [];
    });
  }

  for (const [eventName, desiredGroups] of Object.entries(desiredHooks || {})) {
    const target = Array.isArray(cleaned[eventName]) ? [...cleaned[eventName]] : [];
    for (const desired of desiredGroups) {
      const desiredMatcher = desired.matcher;
      const index = target.findIndex((group) =>
        group && typeof group === 'object' && group.matcher === desiredMatcher && Array.isArray(group.hooks),
      );
      if (index === -1) target.push(structuredClone(desired));
      else target[index] = { ...target[index], hooks: [...target[index].hooks, ...structuredClone(desired.hooks)] };
    }
    cleaned[eventName] = target;
  }
  return cleaned;
}

export function normalizePermissionLists(existing = {}, desired = {}) {
  return {
    defaultMode: existing.defaultMode || desired.defaultMode,
    allow: [...new Set([...(existing.allow || []), ...(desired.allow || [])])],
    deny: [...new Set([...(existing.deny || []), ...(desired.deny || [])])],
    ask: [...new Set([...(existing.ask || []), ...(desired.ask || [])])],
  };
}

/**
 * Merge an existing on-disk Claude Code settings object with the Bizar
 * "shipped" settings template (the desired defaults produced by
 * `writeClaudeSettings`). The merge preserves operator-added entries
 * while refreshing Bizar-owned defaults on every call.
 *
 * @param {object} existing      The current `~/.claude/settings.json` object (may be empty).
 * @param {object} bizarSettings The desired Bizar-shipped settings object.
 * @param {object} [options]
 * @param {boolean} [options.force=false]
 *   `true` forces a refresh of Bizar-managed keys (gateway URL, MCP
 *   servers, hooks, permissions) while still retaining unrelated env
 *   entries. `false` (the default for normal updates) fills missing
 *   Bizar defaults without replacing values a user has deliberately
 *   configured.
 * @param {string} [options.claudeHooksDir]
 *   Absolute or relative path to the operator's Claude hooks directory;
 *   used to recognise legacy Bizar-owned hook commands. Defaults to
 *   `.claude/hooks`, which matches the standard `~/.claude/hooks/`
 *   layout. The caller (`writeClaudeSettings`) passes the resolved
 *   `CLAUDE_HOOKS_DIR` so the merge stays correct under non-default
 *   `CLAUDE_CONFIG_DIR` values.
 * @returns {object} A new merged settings object.
 */
export function mergeSettings(existing = {}, bizarSettings = {}, options = {}) {
  const { force = false, claudeHooksDir = join('.claude', 'hooks') } = options;
  const isBizarOwnedHook = buildIsBizarOwnedHook(claudeHooksDir);

  const merged = { ...existing };
  if (force) {
    Object.assign(merged, bizarSettings);
    merged.env = { ...(existing.env || {}), ...bizarSettings.env };
    merged.hooks = mergeBizarHooks(existing.hooks, bizarSettings.hooks, { isBizarOwnedHook });
    // F-176: the floor is enforced by the permission-request.mjs hook, not by
    // Claude Code prompts. `Object.assign` above replaced `merged.permissions`
    // with the template's (empty) arrays — re-union-merge so an operator's
    // existing `allow`/`ask`/`deny` survive a force re-install.
    merged.permissions = normalizePermissionLists(existing.permissions, bizarSettings.permissions);
  }
  else {
    merged.$schema   = merged.$schema || bizarSettings.$schema;
    merged.mcpServers = { ...(existing.mcpServers || {}), ...bizarSettings.mcpServers };
    merged.permissions = normalizePermissionLists(existing.permissions, bizarSettings.permissions);
    // A normal update fills missing Bizar defaults without replacing values a
    // user has deliberately configured. `force` refreshes Bizar-owned keys but
    // still retains unrelated environment entries.
    merged.env   = { ...bizarSettings.env, ...(existing.env || {}) };
    merged.hooks = mergeBizarHooks(existing.hooks, bizarSettings.hooks, { isBizarOwnedHook });
    merged.autoMode = existing.autoMode || bizarSettings.autoMode;
    merged.attribution = existing.attribution || bizarSettings.attribution;
    merged.worktree = { ...(bizarSettings.worktree || {}), ...(existing.worktree || {}) };
    for (const key of ['enableWorkflows', 'disableWorkflows', 'workflowSizeGuideline', 'alwaysThinkingEnabled', 'autoDreamEnabled', 'showThinkingSummaries']) {
      if (merged[key] === undefined) merged[key] = bizarSettings[key];
    }
  }

  // The installed harness owns the default main-thread role. Operators can
  // still override it for one session with `claude --agent <name>`.
  merged.agent = 'mike';

  // The alias binding (`model`, `modelOverrides`, `ANTHROPIC_DEFAULT_*_MODEL`)
  // is Bizar-owned template content. Refresh it predictably on every run
  // without erasing unrelated env entries (e.g. an operator's
  // `ANTHROPIC_API_KEY` survives a force update). The provisioner never
  // synthesizes `ANTHROPIC_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`, or any
  // router-derived projection.
  merged.model = bizarSettings.model;
  merged.modelOverrides = bizarSettings.modelOverrides;
  if (merged.env && typeof merged.env === 'object') {
    delete merged.env.ANTHROPIC_MODEL;
    delete merged.env.CLAUDE_CODE_SUBAGENT_MODEL;
    delete merged.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY;
    delete merged.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS;
  }

  // Auto-compaction is part of the Bizar reliability contract. Remove legacy
  // opt-out environment flags when provisioning so long sessions compact
  // before the context limit; `/compact` remains available for manual use.
  if (merged.env && typeof merged.env === 'object') {
    delete merged.env.DISABLE_AUTO_COMPACT;
    delete merged.env.DISABLE_COMPACT;
  }
  merged.disableAutoCompact = false;

  return merged;
}
