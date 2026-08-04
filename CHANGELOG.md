# Changelog

## Unreleased

- F-163: Repoint the agent registry at the new 9router gateway IDs:
  orchestrator (`@mike`), planning (`@paul`), and last-resort debugging
  (`@carl`) now run on `claude-qwen/qwen3.8-max`; MiniMax tiers are
  re-prefixed as `claude-minimax/MiniMax-{M3,M2.7,M2.5}`; design and
  high-implementation tiers remain on `cx/gpt-5.6-{terra,luna}`.
  `.claude/model-router.json` version bumped 11.0.0 → 11.1.0; 16 agent
  frontmatter lines, `scripts/agent-model-registry.test.mjs`,
  `packages/sdk/tests/agent-model-registry.test.mjs`,
  `cli/__tests__/workflow-state.test.mjs`, `cli/__tests__/model.test.mjs`,
  `cli/commands/model.mjs`, `cli/provision.mjs:935`, `docs/architecture.md`,
  `.claude/commands/use-default.md`, `.claude/commands/use-premium.md`,
  `PROGRESS.md`, `feature_list.json`, and `CHANGELOG.md` updated for
  consistency. `node --test scripts/agent-model-registry.test.mjs` → 7/7.

## [10.13.0] - 2026-08-03

- F-146: bundle `i-have-adhd` skill (always-on) from ayghri upstream; add
  4-assertion regression test.
- F-146: expose `bizar task / workflow / control / audit / model list`
  as MCP tools so agents don't shell out for CLI.
- F-147: 9router picker proxy (`127.0.0.1:20129` → gateway `20128`)
  rewrites upstream IDs to `claude-...` on `GET /v1/models` so Claude
  Code's `/model` picker surfaces every gateway model.
- F-148: primary session now IS `@mike` (no recursive dispatch);
  `/quick` sets `.bizar/.quick-once` for one-turn routing bypass;
  session-end clears the sentinel.
- F-149: `bizar worktree-merge <branch>` tags the source branch tip as
  `merge-archive/<branch>-<sha>` before `git merge --no-ff`, so parallel
  pipeline work is never lost on conflict resolution and merge topology
  stays visible in `git log --graph`.
- Versions synchronized at 10.13.0 across root `package.json`,
  `packages/sdk/package.json`, `packages/sdk/src/version.ts`, and
  `.claude-plugin/plugin.json`.

## [10.12.2] - 2026-08-03

- Loosened Bizar hook rules so agents stop getting hung up on redundant
  per-tool-call leaves:
  - Dropped `content-style-guard` and `simplify-guard` from the
    pre-tool-use chain. Edit/Write now runs 2 leaves (was 3). Bash now
    runs 2 leaves (was 4).
  - `path-ownership-guard.mjs` no longer forks `git worktree list` on
    every edit. The worktree-bootstrap hook already establishes task
    scope on session start. The hook is now a single in-memory ledger
    lookup.
  - `simplify-guard.mjs` freshness window extended 30 min to 4 hours
    and skips the gate when the staged diff is exclusively CHANGELOG,
    version-bump, or lockfile-only changes.
  - `git-workflow-guard.mjs` dropped the AI-attribution trailer deny
    (the trailers never appear because `attribution.commit` is empty).
    The conventional-commit subject check is now a soft `additionalContext`
    warning attached to the same `ask` response (no separate deny).
    Force-push, rebase, and shell-indirection around guarded actions
    still deny.
  - `pretooluse-editwrite.mjs` dropped the always-on `additionalContext`
    line that told the model which tool and path it just called.
- All security-critical denies preserved: dangerous bash patterns,
  writes to `.env` / `.envrc` / `secrets/` / `credentials/` /
  `node_modules/`, commit/push/merge/release/publish/deploy via `gh`,
  `npm`, `vercel`, `wrangler`, `flyctl`.
- `cli/install/prune.test.mjs` replaces a tautological indirect test
  with two direct unit tests against the shared `parseFlags()` helper.
- Internal: `pruneReport(srcDir, destDir, filter, force)` extracted
  in `cli/provision.mjs` to consolidate five copies of the prune
  block across the sync helpers.

## [10.12.1] - 2026-08-03

- Fixed `bizar install --force` so it actually prunes stale entries in
  `~/.claude/{agents,skills,commands,rules,hooks}` against the bundled
  source. Previously the `--force` / `--dry-run` / `--quiet` / `--yes`
  flags were dropped at the `runInstaller` boundary, so `bizar install --force`
  silently ran the default non-pruning path and left stale F-112
  Norse → 90s office rebrand agents behind.
- Added `pruneStale()` in `cli/provision.mjs` (recursive, filter-aware)
  wired into all five sync functions. Skills and hooks use extension
  filters so user-owned `.txt` / `.json` are preserved; agents,
  commands, and rules prune every dest entry not in source.
- Consolidated the install/update flag parser into `parseFlags()` in
  `cli/provision.mjs` so the two commands stay in lockstep.
- Added `cli/install/prune.test.mjs` (10 tests) pinning prune semantics,
  flag wiring, and the shared parser.

## [10.12.0] - 2026-08-02

- Added a Claude Code-native Bizar plugin manifest and stable `bizar hook`
  dispatcher so agents, skills, commands, MCP registration, and lifecycle
  hooks use the same portable installed boundary.
- Added durable, session/project-bound workflow state and an `/autopilot`
  lifecycle spanning research/specification, consensus planning, implementation
  waves, bounded QA/fix cycles, validation, resume, completion, failure, and
  cancellation.
- Made Mike the sole GPT-5.6 Sol orchestrator and moved workers to a strict,
  skill/difficulty-based GPT/MiniMax registry with immutable per-run routing
  snapshots and explicit gateway-availability failures rather than silent
  substitution.
- Preserved the guarded-autonomy boundary: no note-vault or general memory
  subsystem, no persistent daemon, no automatic commit/push/release/publication,
  and no embedded HTTP/WebSocket UI. OpenKan remains optional through
  `bizar control`.

## [10.10.2] - 2026-07-31

- Installer now enables gateway model discovery by default: user-level
  `~/.claude/settings.json` is populated with `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`,
  `ANTHROPIC_AUTH_TOKEN=sk_9router`, and the existing `ANTHROPIC_BASE_URL` /
  `BIZAR_MODEL_ROUTER_URL`. Existing user env vars are preserved (no
  removal of `ANTHROPIC_DEFAULT_*_MODEL` per-tier overrides).
- Removed duplicate per-tier `ANTHROPIC_DEFAULT_*_MODEL` entries from the
  project settings template (the discovery mechanism surfaces the correct
  models where the gateway serves Claude-prefixed IDs).
- Added `bizar model list` CLI command: hits `GET /models?limit=1000` against
  the 9Router gateway, groups output by provider prefix (`cx/`, `bizar/`,
  `oc/`, `claude/`, `anthropic/`, `(no prefix)`), and prints a table or JSON.
  3-second timeout; retries without auth on 401. Run `bizar model list` to
  see all available models including ones the /model picker filters out.

## [10.10.1] - 2026-07-30

- Fixed broken relative imports in UserPromptSubmit hooks (`control-inbox.mjs`,
  `worker-suggest.mjs`) that failed with `ERR_MODULE_NOT_FOUND` after
  installation when the project source lived at any path other than the
  build-time assumption. Imports are now resolved via `import.meta.url` +
  dynamic `import()` anchored to the script's own location.



- Made Bizar-agent routing mandatory for every primary request and added
  all-subagent official-documentation grounding with mechanically verified
  `WebSearch` access.

## 10.9.0 — 2026-07-30

- Removed the retired web control plane, bundled browser extensions, local artifact editor, service/deployment plumbing, and their dependencies and tests.
- Removed the Bizar note-vault/search subsystem, its MCP tools, CLI commands, skills, configuration, and SDK exports.
- Added guarded Git/GitHub publication, simplify-before-commit, prose-quality, intelligent compaction, local telemetry, and reviewer-context hooks.
- Added approval-aware GitHub workflow skills and executable removed-surface verification.
- Updated optional browser verification to the official `agent-browser` CLI/MCP lifecycle and CubeSandbox to the current E2B-compatible API.
- Re-audited the retained Claude Code harness, removed a duplicate agent identity and nonexistent visual-plan command, and replaced stale architecture and feature state.
- Removed abandoned install/plugin/scheduler/eval fixtures, committed runtime and editor metadata, generated package residue, and a broken external skill-cache symlink.
- Narrowed the npm publication boundary from 427 to 260 files, eliminating tests, duplicate skills, and local-state leakage; added executable structure/package checks and synchronized version metadata.
- Isolated editing agents in Git worktrees rooted at the current `HEAD`, with safe shared-dependency bootstrap and mechanically verified agent policy.
- Added a durable SQLite task DAG with dependency-aware claims, expiring leases, workspace ownership, conservative path collision checks, and edit-hook enforcement.
- Added a serialized integration queue with single-consumer ordering, verification evidence, repair routing, and no implicit merge, push, or publication side effects.
- Documented the 2026 multi-agent harness comparison and prioritized roadmap for collision-free collaboration, replayable execution, and stronger observability.

Earlier release history remains available in Git history and published package release notes.
