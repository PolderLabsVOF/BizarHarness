# Changelog

## [10.23.11] - 2026-09-02

### Fixed

- **Global-router resolution** — the model router is operator-owned and
  user-global only. Runtime lookup, the installer, picker/provider
  filtering, settings generation, and SessionStart synchronization
  resolve exclusively through `BIZAR_MODEL_ROUTER_CONFIG` or
  `$BIZAR_HOME/config/claude/model-router.json`. The shipped
  `config/claude/model-router.json` is removed; no `~/.claude` mirror
  participates. The installer creates a model-neutral global router
  only when absent and never overwrites an existing operator router,
  even under `--force`.
- **Transport-compatibility correction (F-201)** — Claude Code's native
  Agent tool rejects raw gateway IDs in its enum-limited `model`
  field. Workflow dispatch now omits `model` and carries the
  Bizar-selected ID as `additionalContext.bizarConfiguredModel`. The
  Agent guard reads the global Claude parent model from
  `$CLAUDE_CONFIG_DIR/settings.json` and only permits inherited
  dispatches when that parent equals the configured Bizar pick AND
  the pick is in `userSelected`; otherwise the guard fails closed.
- **SDK/CLI resolution contract alignment** — `loadModelRegistry` now
  tolerates empty tier model lists when `userSelected` is non-empty,
  matching the CLI's `resolveDispatchModel` fallback path. The SDK's
  `rankUserSelectedForRole` sort key now uses `originalIndex` as the
  primary key, making `userSelected.models` order the authoritative
  dispatch sequence — parity with the CLI. The failover-mirror sort is
  updated to match. Two F-184 tests updated to assert the new contract.

### Regression coverage

- `agent-model-guard` — 18/18 (5 new F-201 cases: allow-inherit on
  matching triple; deny when `additionalContext.bizarConfiguredModel`
  is missing; deny on `configured != parent`; deny on non-user-pick;
  fail closed when `settings.json` cannot be read).
- `workflow dispatch` — 27/27 (3 new `augmentPayload` cases proving
  `model` is omitted and `additionalContext.bizarConfiguredModel` is
  set, merges caller-provided `additionalContext`, and renders `null`
  cleanly when `decision.modelId` is null).
- `models-*` focused suites — 11/11.
- `provision` + `agent-model-registry` — 28/28.
- `make check`, `make verify-repo-structure`, `make check-arch`, and
  `make verify-removed-surfaces` pass. The aggregate Node 24 runner
  isolation issue still prevents claiming `make test` / `make e2e`.

## [10.23.9] - 2026-09-02

### Fixed

- Replace the hard workflow-entry tool gate with adaptive coordination: Mike
  orients, asks one clarification checkpoint, then selects the lightest safe
  direct, isolated-agent, workflow, parallel-agent, or Agent-team mode.
- Keep every dispatch on an explicit configured Bizar model and repair a stale
  parent model from the operator's selected pool at session start.
- Stop model-selection tests from writing synthetic models into operator Claude
  settings.

### Changed

- Make bounded implementation workflows show Scope, Plan, Implement, and
  Review phases with independent scoped research and review workers.
- Remove all shipped fallback model IDs. Fresh installs require discovered or
  selected models; Anthropic remains an explicit provider opt-out that an
  operator can remove from `disabledProviders`.

## [10.23.8] - 2026-09-02

### Fixed

- Make all six native workflow entries self-contained and parser-valid, with
  provisioning and doctor checks plus an absolute installed-path fallback when
  name discovery is unavailable.
- Require every workflow Agent dispatch to use an explicit enabled Bizar model;
  deny missing, inherited, disabled, and out-of-pool models instead of falling
  through to Claude's provider defaults.
- Redirect every recognized Claude Sonnet, Opus, Haiku, and Fable alias into
  the configured custom model pool and synchronize `ANTHROPIC_MODEL` to the
  active configured model.
- Enable gateway model discovery whenever custom configured IDs are installed
  or synchronized so Claude's SDK and subagent paths accept those literal IDs.
- Accept error-free asynchronous native workflow launches in the routing guard
  while keeping nested compilation and execution failures locked.

### Changed

- Spool clean-state command output to bounded temporary files so verbose test
  evidence is not retained in a large shell variable.

## [10.23.7] - 2026-09-02

### Added

- Add direct type-to-search to the interactive `bizar models` picker, matching
  gateway IDs plus Models.dev and gateway display metadata while preserving
  hidden selections and stable gateway order.
- Add `/query` and `search query` filtering to the line-mode picker, with
  visible-result numbering and explicit empty-result feedback.

### Fixed

- Fetch and merge Models.dev model and provider metadata before the picker
  renders, reuse it after confirmation, clear timeout handles promptly, and
  prevent provider-collision metadata from contaminating canonical profiles.
- Preserve cached model profiles across transient metadata failures and
  non-interactive `--set` updates.

## [10.23.6] - 2026-09-01

### Fixed

- Start ordinary Claude sessions as Mike and require a successful native Bizar
  workflow before substantive primary-session mutation; only unmistakably tiny
  single-target copy, style, or formatting edits remain direct.
- Keep failed, blocked, cancelled, budget-exhausted, errored, and status-less
  workflow results locked while allowing narrowly scoped read-only Git review.
- Use one isolated implementation worker for bounded tasks and parallel
  worktree lanes only when writable scopes are genuinely independent.

## [10.23.5] - 2026-09-01

### Added

- Make `bizar install` a guided terminal setup that confirms before mutation,
  detects global provider configuration, and securely prompts only for a
  missing provider URL or key.

### Changed

- Keep `--yes` and `--non-interactive` prompt-free for automation and align
  provider setup, model discovery, and global Claude settings on
  `ANTHROPIC_AUTH_TOKEN` plus `BIZAR_MODEL_ROUTER_URL`.

## [10.23.4] - 2026-09-01

### Fixed

- Preserve the supported recognized-key model override map through the final
  force-provision merge instead of overwriting it with a legacy self-map.

## [10.23.3] - 2026-09-01

### Fixed

- Generate Claude Code `modelOverrides` with recognized Claude model IDs as
  keys and configured gateway IDs as values, including SessionStart repair, so
  print-mode and Agent SDK requests no longer emit unrecognized-model warnings.

## [10.23.2] - 2026-09-01

### Fixed

- Doctor and strict validation now resolve settings-based gateway credentials,
  accept global explicit model picks, and validate the current wildcard hook
  and hook-enforced permission policy instead of obsolete settings shapes.

## [10.23.1] - 2026-09-01

### Fixed

- Use npm's PATH-resolved `vitest` executable in SDK test scripts so package
  publication no longer needs to auto-correct the manifest.

## [10.23.0] - 2026-09-01

Productivity and reliability audit for autonomous Claude Code development.

### Added

- Default compact `i-have-adhd` response guidance and proactive installed-skill
  selection with a reviewed skills.sh fallback for hard or stuck work.
- Global `/artifact on|off|status` completion reports and bounded global-user /
  project-debugging learning stores through `bizar learn`.
- Global Bizar config-path resolution, traversal-safe integrity-checked backups,
  and complete command, hook, agent, rule, and skill installation diagnostics.
- Installer tests are fully fixture-confined and cannot wipe or re-sync an
  operator's live Claude configuration.
- Native copied workflows remain self-contained, v2 restores reject integrity
  drift, npm test flags forward correctly, and selected-model context metadata
  prevents Claude Code unknown-window warnings.

### Changed

- Small deterministic local work now takes a direct fast path; shaped workflows
  and parallel worktree workers are reserved for scopes that benefit from them.
- Every orchestrated Agent call uses an enabled configured model or fails closed;
  disabled providers can no longer leak through Claude Code defaults.
- Worker completion is terminal, repeated idle events trigger intervention, and
  independent workflow lanes execute concurrently with isolated worktrees.
- Auto-compaction is enabled and PreCompact writes a bounded recovery checkpoint.
- Models.dev parsing supports current flat and nested catalog envelopes while
  retaining richer capability, cost, benchmark, and reasoning metadata.
- The shipped MCP and E2E inventories now cover all 14 tools and all lifecycle
  events; the CLI help audit covers every routed command.

### Removed

- Automatic prompt-to-rule learning and legacy unbounded instinct extraction.

## [10.22.0] - 2026-08-31

Phase 4 dynamic disable-providers mechanism. Adds an operator-controlled `disabledProviders: string[]` config key that filters out providers at every reader site. Adding or removing a blocked provider is a single JSON edit on the operator's `model-router.json` — no in-code `BLOCKED_PROVIDERS` constant, no `if (id === 'claude-opus-5')` branch, no compiled-in family allowlist.

### Added

- **`cli/commands/models.mjs`** — new exports:
  - `normalizeDisabledPrefix(raw)` — trim + lowercase; case-insensitive input normalization.
  - `extractDisabledProviders(parsed)` — safe reader off a parsed router block; tolerates missing/non-array/non-string entries.
  - `readDisabledProviders({ routerPath })` — global-only reader. The Bizar path (`~/.config/bizar/config/claude/model-router.json`) is the sole source; an explicit empty `[]` is a valid operator policy.
  - `filterCandidatesByDisabledProviders(candidates, disabledProviders)` — case-sensitive prefix filter; returns `{ kept, stripped }` so the CLI can surface what was dropped without crashing on the disable list.
  - `disabledProviders` parameter on `applyModels`, `applyModelOverrides`, `applyModelPicker`, `partitionStalePicks`, `applyRefresh`, `currentSelection` — optional override for deterministic tests; production callers omit it and read from disk.
- **`config/claude/hooks/sessionstart-model-sync.mjs`** — inline dual-path reader + `filterDisabled` helper. Strip disabled-provider ids from `settings.modelPicker.options` AND from `settings.model` (replace with first surviving pick) so Claude Code's `/model` picker never surfaces a disabled option.
- **`config/claude/hooks/agent-model-guard.mjs`** — `readDisabledProvidersFromRegistry`, `isDisabledId`, and silent-filter early-return. `configuredModels` and `userSelectedModels` filter disabled-provider ids before the live-discovery check. The picker IS still the discovery surface for user picks, but the operator's disable intent overrides user intent at config time, not dispatch time.
- **`cli/commands/model.mjs`** — replaced hardcoded `PROVIDER_GROUPS` with `classifyKind` from `models.mjs`. Provider group names are derived from the canonical family classifier; no compiled-in family allowlist.
- **`cli/provision.mjs`** — install-banner premium model now derives from `userSelected.tierHints.premium[0]`; `settings.json#model` and `settings.json#modelOverrides` derive from `userSelected.models[0]` (omitted when empty). Install never pins a literal model id.
- **`cli/commands/upgrade-defaults.mjs`** — replaces hardcoded `model: 'claude/minimax/MiniMax-M3'` with derivation from `userSelected.models[0]`; omits the key when the picker has no entries.
- **Global model router** — `disabledProviders: ["anthropic"]` is created in the operator's Bizar config; the repository ships no runtime model router.
- **`.claude/agents/office-manager.md`** — JSDoc example model ids (`claude-minimax/MiniMax-M3`, `claude-qwen/qwen3.8-max`) replaced with `<pick-from-default-tier>` / `<pick-from-premium-tier>` placeholders so the documentation is decoupled from any specific provider.
- **`cli/__tests__/models-disabled-providers.test.mjs`** (new, 4 cases) — `normalizeDisabledPrefix` / `extractDisabledProviders` units; dual-path empty-array precedence; `filterCandidatesByDisabledProviders` kept/stripped split.
- **Regression coverage extended** (12 new tests across 6 files):
  - `cli/__tests__/models-picker.test.mjs` (+2) — `applyModels` / `applyModelPicker` strip `anthropic/*` ids via the `disabledProviders` parameter.
  - `cli/__tests__/models-namespace-sync.test.mjs` (+3) — `applyModelOverrides`, `partitionStalePicks`, `applyRefresh`, `currentSelection` honour the disabled list.
  - `cli/__tests__/models-cli.test.mjs` (+1) — subprocess end-to-end: `bizar models --list` filters `anthropic/*` when the staged router pins `anthropic`.
  - `config/claude/hooks/__tests__/sessionstart-model-sync.test.mjs` (+1) — SessionStart sync filters `anthropic/*` from `settings.modelPicker.options`.
  - `config/claude/hooks/__tests__/agent-model-guard.test.mjs` (+1) — silent-filter contract: orchestrator-picked disabled ids fall through without advisory `additionalContext`.

### Changed

- **`config/claude/settings.json`** — removed hardcoded `model` and `modelOverrides` keys; install-time derivation populates them from `userSelected.models[0]`.
- **`packages/sdk/package.json`** — bumped to `10.22.0` for parity with the harness version.

### Hard constraint

> *make sure bizar doesnt hardocdee things like this. eveyrhting should be dynamic*

There is no in-code list of blocked providers, no per-id branch, no compiled-in family allowlist. Adding a provider to the disable list is a single JSON edit; removing it is a single JSON edit. The 12 new tests pin the contract at every reader site.

### Migration note

`disabledProviders` is a new optional key. Existing `model-router.json` files without the key continue to behave as before — every candidate is kept. Operators who want to start filtering can add `"disabledProviders": ["anthropic"]` (or any other prefix) to their existing router file; whitespace and case are normalized at read time.

## [10.21.0] - 2026-08-31

Phase B workflow re-architecture: artifact-on-disk barriers. Every Claude-Code-native workflow script (`config/workflows/*.js`) now writes prior agent outputs to `.bizar/runs/<run-id>/<phase-slug>__<label-slug>.json` and passes a 4-line `barrierRef()` block to the next agent instead of re-inlining the full JSON. Phase A (v10.20.0) recovered ~14-16 KB of static prompt bloat per orchestrator turn; Phase B collapses the remaining 15-40 KB of structural workflow bloat.

### Added

- **`config/workflows/lib/dispatch.js`** — new exports: `writeArtifact`, `readArtifact`, `listArtifacts`, `listRuns`, `barrierRef`, `slugify`, `WorkflowStateError`. Atomic write (`tmp` + `fsync` + `rename(2)`); fail-soft stale semantics per Q4 audit recommendation; manifest schema `{schemaVersion, runId, createdAt, updatedAt, phases:[{phase, label, artifactPath, summaryHash, stale, wroteAt}]}`. Naming is fully data-driven (`meta.phases[i].title` + `label:` field, kebab-cased, capped at 64 chars) — no hardcoded workflow or phase lists.
- **`cli/commands/workflow-gc.mjs`** (new) — sweeps `.bizar/runs/<run-id>/` directories older than the 14-day TTL. In-progress gate (`feature_list.json#in_progress`) blocks all deletions. Permission failures skip + warn without aborting. Emits `.bizar/runs/gc.json` audit log per sweep.
- **`cli/__tests__/workflow-write-artifact.test.mjs`** (new, 10 cases) — atomicity (orphan tmp from a crash does not surface), idempotency (same payload → same sha256), manifest freshness, naming derivation across 5 (phase, label) combos, summaryHash stability, Q4 stale flag, barrierRef block under `MAX_BARRIER_BYTES=3072`, slugify normalizer, listRuns walk, WorkflowStateError.
- **`cli/__tests__/workflow-bloat-pin.test.mjs`** (new, 7 cases) — pins every dispatch prompt in all six workflows to ≤3072 bytes. Reports measured max + total bytes per workflow.
- **`cli/__tests__/workflow-barrier-ref.test.mjs`** (new, 4 cases) — snapshots the 4-line block format; truncation flag for summaries >200 chars; path alignment between `barrierRef` and `writeArtifact`/`readArtifact`.
- **`cli/__tests__/workflow-gc.test.mjs`** (new, 5 cases) — empty runs dir, in-progress exclusion, 14-day boundary, permission-denied handling, gc.json audit log shape.
- **`Makefile`** — `workflow-gc` and `workflow-gc-dry` targets added next to `cleanup`.
- **`package.json`** — `scripts.workflow:gc` and `scripts.workflow:gc:dry` entries (no new dependency).
- **`.harness/arch-rules.json`** — `workflow-bloat-pin` rule: total `JSON.stringify` count across `config/workflows/*.js` (excl. `lib/`) must remain ≤5. Baseline of 5 is the `args || {}` fallback at script start (one per script); any new `JSON.stringify` re-introduces the inline-JSON re-serialization Phase B eliminated.

### Changed

- **`config/workflows/{bizar-debug,bizar-implement,bizar-research,ultracode,ultracode-research,ultracode-review}.js`** — every barrier prompt's `JSON.stringify(prior)` replaced with `barrierRef({runId, phase, label, summary}).promptBlock`. Each script now generates a single `RUN_ID = randomUUID()` and writes prior results via `writeArtifact()` before the next dispatch's prompt is assembled. Total `JSON.stringify` calls across the six scripts dropped from 23 to 5 (the 5 are the `args || {}` fallback at script start — not barrier re-serialization).
- **`config/workflows/__tests__/workflow-payload-capture.test.mjs`** — extended to inject `randomUUID` + stub `writeArtifact`/`barrierRef` so the existing routing capture harness still exercises the workflow bodies without performing real fs side effects.
- **`config/workflows/__tests__/dispatch.test.mjs`** — role-grep search window expanded from 800 to 1600 chars so the Phase B `barrierRef()` expansion inside prompt templates does not push the trailing options object beyond the regex reach.

### Measured impact

Barrier prompt size AFTER Phase B (max bytes per workflow, was inline JSON):
- `bizar-debug`: 370 bytes (was ~3-6 KB)
- `bizar-implement`: 572 bytes (was ~5-10 KB)
- `bizar-research`: 805 bytes (was ~5-15 KB)
- `ultracode`: 807 bytes (was ~5-15 KB)
- `ultracode-research`: 580 bytes (was ~3-6 KB)
- `ultracode-review`: 237 bytes (was ~3-6 KB)

All six stay under the 3072-byte `MAX_BARRIER_BYTES` budget. Aggregate per-workflow prompt bytes (sum of every dispatch prompt) range from 897 B (`ultracode-review`, 4 dispatches) to 2674 B (`ultracode`, 7). Phase A recovered ~50% via static trim; Phase B recovers an additional ~80-90% on top by closing the structural gap.

### Migration note

`.bizar/runs/` did not exist at plan time. The GC tool starts with an empty candidate set; no migration needed. Any future tooling that writes to `.bizar/runs/` MUST conform to the manifest schema or be added to GC's ignore list.

### Stale-artifact fallback

When `dispatch.js` writes a barrier artifact and the read site finds a stale or partially-written file, the writer returns `{ stale: true }` (fail-soft). The reader decides whether to re-render the upstream phase. Pinned by `cli/__tests__/workflow-write-artifact.test.mjs#6. Q4 stale flag`.

## [10.20.0] - 2026-08-31

Phase A token-reduction trim of the Bizar harness prompt surface. Mechanical, zero behavior change. ~50% reduction in per-orchestrator-turn token spend.

Per `docs/plans/2026-08-31-prompt-token-reduction.md`, every Bizar agent dispatch re-pays the cost of static prompt text injected into the subagent context. A previous version of the harness shipped ~14-16 KB of recoverable bloat per orchestrator turn — duplicated tool-shape pointers on every agent file, a 700-char grounding payload, 6 KB advisor-context dumps, verbose Mike self-improvement walkthroughs, and Skill-delegate command bodies that grew past their budget. Phase A trims that surface to ~50% of the previous size with zero behavior change.

### Added

- **`config/claude/agents/_shared/AGENT_BASELINE.md`** (new, 79 lines) — canonical baseline shared across every agent. Contains `## External APIs` (WebSearch / WebFetch / Semble rules) + `## Git` (auto-approve / HITL floor) sections. Agents reference it instead of restating the rules. Within the ≤80 line budget.
- **`cli/provision.mjs#syncAgentFiles`** — new `_shared/*.md` copy block (R0 precondition). The `syncDir` filter only accepted files, so `_shared/` was never shipped to the user's `~/.claude/agents/_shared/` directory, breaking the AGENT_BASELINE pointer in every agent. The new block walks `src/_shared`, copies every `.md` file into `dest/_shared/`. Pinned by `cli/__tests__/prompt-trim.test.mjs#syncAgentFiles copies _shared/*.md into the dest tree`.
- **`cli/__tests__/prompt-trim.test.mjs`** (new, 10 cases) — pins every Phase A budget.
- **`config/claude/hooks/__tests__/agent-grounding.test.mjs`** (new) — verifies the trimmed SubagentStart payload.
- **`cli/__tests__/advisor-context.test.mjs`** (new) — pins the advisor context `TOTAL_CAP` and `MAX_RECORDS` budgets.

### Changed

- **`config/claude/agents/office-manager.md`** — trimmed from ~500 lines to 291 lines (within the ≤300 budget). Cut `Prior Shape (Reference Only)`, `Legacy Detail (4 Steps, Deprecated)`, and most of the `PARALLEL EXECUTION CONTEXT` block. Pinned by `cli/__tests__/prompt-trim.test.mjs#office-manager.md is under 300 lines`.
- **`config/claude/agents/*.md`** (16 files) — terse `description:` frontmatter (≤100 chars, formerly 200-500 chars of marketing copy). Removed the duplicated `Claude Code tool shapes … CLAUDE_TOOLS.md` footer (shipped in v10.19.x) and the `Follow _shared/AGENT_BASELINE.md` footer from every agent. Fixed name/description pairing on 6 files (`debug-specialist`, `senior-engineer`, `it-lead`, `help-desk`, `exec-assistant`, `research-analyst`) where the description started with a different agent's name. Pinned by `cli/__tests__/prompt-trim.test.mjs#every agent file has description: <=100 chars AND name/description pairing` and the new strengthened cross-check that reads `name:`, title-cases it, and asserts `description:` starts with `${Name} —`.
- **`config/claude/hooks/agent-grounding.mjs`** — SubagentStart payload trimmed from 6 bullets (~960 chars) to 2 lines (113 chars). Within the ≤200 char budget. Pinned by `cli/__tests__/prompt-trim.test.mjs#agent-grounding.mjs hook payload is under 200 chars`.
- **`config/claude/hooks/advisor-context.mjs`** — `TOTAL_CAP` 6144 → 2048, `MAX_RECORDS` 8 → 4. Cuts the worst-case transcript tail from ~24 KB to ~8 KB per dispatch. Pinned by `cli/__tests__/prompt-trim.test.mjs#advisor-context.mjs TOTAL_CAP is 2048 or less` and `#MAX_RECORDS is 4 or less`.

### Regression tests

- **`cli/__tests__/prompt-trim.test.mjs`** (new, 10 cases) — every Phase A budget is pinned: `office-manager.md` ≤300 lines, `AGENT_BASELINE.md` ≤80 lines with `## External APIs` + `## Git`, every agent `description:` ≤100 chars AND starts with `${titleCasedName} —` (cross-check), agent-grounding payload ≤200 chars, advisor-context `TOTAL_CAP === 2048` and `MAX_RECORDS ≤ 4`, no agent body contains the "Claude Code tool shapes" footer, `syncAgentFiles` copies `_shared/*.md`. The strengthened cross-check prevents the description/name swap regression class that Phase A initially missed.
- **`config/claude/hooks/__tests__/agent-grounding.test.mjs`** (new) — verifies the trimmed payload is delivered at SubagentStart.
- **`cli/__tests__/advisor-context.test.mjs`** (new) — pins TOTAL_CAP and MAX_RECORDS budgets.

### Audit references

- F-176 / F-179 — Phase A advances the autonomy-cost audit by reducing per-dispatch token spend by ~50% without behavior change. Phase B (workflow re-architecture, v10.21.0) targets the remaining 15-40 KB of workflow-barrier bloat.

## [10.19.8] - 2026-08-31

Defer catalog fetch until after picker confirmation; per-id enrichment runs in parallel with bounded concurrency. `--list` and `--set` skip the fetch entirely.

The interactive picker path used to call `fetchModelsDevCatalog` BEFORE the picker opened, paying the round-trip on every `--list` and `--set` invocation that never even consulted the catalog. Phase 2 (10.19.8) moves the fetch past picker confirmation and gates per-id lookups behind a bounded-concurrency runner with a per-id timeout.

### Added

- **`cli/commands/models.mjs#enrichPicksByMetadata`** (new, exported) — Phase 2 lazy enrichment helper. Fetches the catalog once, then enriches the picked IDs in parallel with a bounded worker pool (`concurrency`, default 8) and a per-id timeout (`timeoutMs`, default 3000ms). Per-id failures fall back to the candidate's `_gateway.name` contract (Phase 1). Wholesale catalog fetch failures degrade to `_gateway.name` (or `null` when no `_gateway` block is attached). Returns `{ profiles: Map<string, object|null>, modelsDev: object }`.
- **`cli/commands/models.mjs#run`** — accepts an optional fourth `deps` argument (`{ pickModels, fetchModelsDevCatalog, listModels }`) for test injection. Production callers see no change. The interactive branch uses the injected picker when provided and bypasses the `process.stdin.isTTY` guard, so unit tests can drive the picker without a real TTY.
- **`cli/commands/models.mjs#run`** interactive `--json` output gains an `enriched: string[]` key naming the picked IDs that received Models.dev enrichment. Phase 2 emits `picks` as-is (no filtering); Phase 4 will filter to only the IDs that received a profile.

### Changed

- **`cli/commands/models.mjs#run`** — `fetchModelsDevCatalog` is no longer called before the picker opens. The interactive branch calls `enrichPicksByMetadata` AFTER `pickModels` resolves; `--list` and `--set` skip the fetch entirely. `--list` JSON output now reports `modelsDev.status === 'skipped'`.
- **`cli/commands/models.mjs#run`** interactive branch — the per-id enrichment is parallel with bounded concurrency (8 workers by default) and a per-id timeout of 3000ms. The wholesale catalog fetch inherits the same timeout so a hung stub cannot block picker confirmation.

### Regression tests

- **`cli/__tests__/models-picker.test.mjs`** (+1) — `run()` interactive picker defers `fetchModelsDevCatalog` until after confirmation. Pins the call order via a monotonic counter: `listModels` < `pickModels:start` < `pickModels:end` < `fetchModelsDevCatalog`.
- **`cli/__tests__/models-refresh.test.mjs`** (+3) — `enrichPicksByMetadata` returns one profile entry per picked id with bounded concurrency (wholesale fetchFn called exactly once); per-id timeout falls back to `_gateway.name` with `metadata.source === 'gateway-fallback'`; wholesale catalog fetch failure degrades to `_gateway.name`.
- **`cli/__tests__/models-namespace-sync.test.mjs`** (+1 subprocess) — `bizar models --list` does NOT contact `models.dev`. Spins up a stub models.dev server that records every hit (via side-channel file counter), asserts `mdHits === 0` after `--list` exits cleanly.

## [10.20.1] - 2026-08-31

`bizar models` interactive picker prints a per-row ✔ / ✖ / ⤳ status screen after confirmation, mirroring the per-row pattern in `cli/doctor.mjs#runDoctor`.

After the operator confirms a picker selection, the interactive path now prints one row per picked id with a ✔ (Models.dev profile retrieved, or carried over via the Phase 1 `_gateway.name` fallback), ✖ (Models.dev miss AND no `_gateway.name` fallback), or ⤳ (id was already in `userSelected.models` before this run — a re-confirmed pick). The screen ends with a footer `N passed, M failed, K skipped`. In a TTY the screen is multi-row; in a pipe it collapses to a single line appended to the existing "Saved N model(s)" block so non-interactive shells see one summary line, not a flood of rows.

### Added

- **`cli/commands/models.mjs#classifyPickStatus`** (new, exported) — pure 4-state classifier. Returns `'fresh'` (profile.metadata.source === 'models.dev'), `'refreshed'` (profile.metadata.source === 'gateway-fallback'), `'unavailable'` (profile === null AND no `_gateway.name` fallback), or `'preexisting'` (id was already in userSelected.models before this run). `'preexisting'` always wins over the other branches; otherwise `'unavailable'` is reserved for the strict-null-profile case (the Phase 1 plumbing makes the latter rare).
- **`cli/commands/models.mjs#renderPickStatusScreen`** (new, exported) — the renderer. Accepts `{ picked, profiles, preExisting, fetchSummary, out, isTTY }`. When `isTTY=true` prints one `  <icon> <id>  (<label>)` line per picked id plus a footer; when `isTTY=false` prints a single `  v N passed, M failed, K skipped` collapsed line. Always returns `{ perPick: [{id, status, hasProfile}], totals: {passed, failed, skipped}, exitCode: 0 when any ✔, 2 when every row is ✖ }` so `--json` callers can embed the data in the JSON envelope without re-implementing the classification. The injected `out` writable lets tests stub without monkey-patching `process.stdout`.
- **`cli/commands/models.mjs#run`** — captures a `preExisting = new Set(currentSelection(router).models)` snapshot BEFORE `applyModels` overwrites the block, so the classifier can detect re-confirmed picks (⤳) versus freshly-picked ids (✔). Calls `renderPickStatusScreen` after the existing "Saved N model(s)" block in the interactive non-JSON branch. Empty-pick early-return (the `picked.length === 0` branch) intentionally skips the screen — the existing `chalk.yellow` "No models selected" message stays the only operator feedback there.
- **`cli/commands/models.mjs#run`** interactive `--json` output gains a `status: { perPick, totals }` key. The renderer is invoked with a no-op `out` writable so nothing leaks into the JSON stream. Existing keys (`applied`, `endpoint`, `endpointSource`, `enriched`, `profiles`, `modelsDev`, `sync`, `picker`) are unchanged.
- **`cli/commands/models.mjs#showHelp`** — documents the new screen: the per-row ✔ / ✖ / ⤳ mapping, the footer, the non-TTY collapse, the `--json` envelope keys, and the exit-code contract.

### Changed

- **`.harness/arch-rules.json`** — new rule `arch-status-icons` pins the per-row ✔ / ✖ / ⤳ glyphs to `cli/commands/models.mjs#renderPickStatusScreen` and `cli/doctor.mjs#runDoctor`. Any other source file that prints those glyphs fails `make check-arch` (Phase 4 hooks must not import the renderer).
- **`cli/commands/models.mjs`** — `classifyPickStatus` and `renderPickStatusScreen` are exported from the module root. Both are CLI-only; the SessionStart hook has no TTY and no outbound HTTP and must NOT import them (pinned by JSDoc and the new grep fence).

### Risks

- **Exit code 2 collision with bash convention.** Bash reserves exit code 2 for "misuse of shell builtins". Phase 3 reserves it for "every pick unavailable" — a meaningful operator signal that every confirmed id had no Models.dev profile and no `_gateway.name` fallback. Documented in the new `showHelp` paragraph.
- **Icon glyph rendering on Windows.** ✖ (U+2716) may render as a fallback on legacy Windows consoles (cp437). The ✔ / ⤳ glyphs are BMP and render correctly under all modern terminals. Phase 3 does not add a Windows-specific code page; operators on legacy consoles may see `?` instead of ✖.
- **`preexisting` precedence.** A pick that already existed in `userSelected.models` is always ⤳, even when Models.dev returns a fresh profile. The classifier intentionally prioritises "this pick survived a prior run" over "the catalog just succeeded" — operators use ⤳ to verify their saved picks are still present, not to re-check catalog freshness. Phase 4 (`disabledProviders`) filters disabled picks BEFORE this classifier runs, so a disabled re-confirmed pick never surfaces as ⤳.
- **SessionStart hook limitation.** The hook cannot render the status screen — it has no TTY and no outbound HTTP. The grep fence prevents the hook from accidentally importing the renderer.

### Regression tests

- **`cli/__tests__/models-picker.test.mjs`** (+5) — pins the full renderPickStatusScreen contract: ✔ for every pick with `profile.name` (totals + perPick + exitCode(0)); ✖ when `profile === null` AND no `_gateway.name` fallback (exitCode 2); ⤳ when the pick was already in `userSelected.models` BEFORE this run (preexisting always wins); non-TTY single-line collapse (`isTTY=false` prints one `v N passed, M failed, K skipped` line and zero per-row ✔ lines); exit code propagation (mixed ✔+✖ exits 0; all-✖ exits 2; `classifyPickStatus` returns each of the four states from the right input).
- **`cli/__tests__/models-namespace-sync.test.mjs`** (+1 subprocess) — `bizar models --json` interactive path exposes `status.perPick` and `status.totals` after a 1-pick confirmation against a stubbed gateway AND a stubbed models.dev catalog. Asserts the JSON envelope contains a `status` block with the picked id's `{status, hasProfile}` and the running totals.

### Audit references

- F-192 / docs/plans/2026-08-31-models-picker-ux.md Phase 3 (lines 481-594).

## [10.19.7] - 2026-08-31

`bizar models` picker rows carry richer label/description metadata — operator-visible behaviour unchanged.

10.19.6 closed the `bizar update` flag-wiring gap, but the picker metadata plumbing was still lossy: `normalizeModels` stripped the gateway's `name` / `display_name` / `description` payload, and `toCapabilityProfile` only surfaced `name` / `family` / `capabilities` / `limits` — never `description` or `summary`. When the Models.dev catalog missed (or the gateway payload was sparse), the picker had no name to fall back to. 10.19.7 plumbs those fields through without changing any operator-visible behaviour.

### Added

- **`cli/commands/models.mjs#normalizeModels`** — preserves gateway `name` / `display_name` / `description` under a new `_gateway` sub-object on each candidate. Field is in-memory only; `applyModels` does NOT persist it to `model-router.json`. Pinned by `cli/__tests__/models-namespace-sync.test.mjs#normalizeModels does not persist _gateway into userSelected on round-trip`.
- **`cli/commands/models.mjs#toCapabilityProfile`** — propagates `match.description` (Models.dev) and `match.summary` (Models.dev) onto the returned profile. Both fields default to `null` when the source row omits them. Pinned by `cli/__tests__/models-picker-context.test.mjs#toCapabilityProfile propagates Models.dev description and summary`.
- **`cli/commands/models.mjs#enrichModelsWithCapabilities`** — on Models.dev miss with gateway-supplied `_gateway.name` or `_gateway.description`, builds a minimal `profile` so the picker row renderer can read `profile.name` / `profile.description` without dereferencing `_gateway`. Candidates whose `normalizeModels` output had no `_gateway` data keep the legacy `profile === null` contract so `capabilityLabel(null)` still returns `'metadata unavailable'`. Pinned by `cli/__tests__/models-namespace-sync.test.mjs#enrichModelsWithCapabilities promotes _gateway.name into profile.name on Models.dev miss`.
- **`cli/commands/models.mjs#normalizeModels`** and **`#toCapabilityProfile`** — exported so the test files can import them directly (previously module-local).

### Changed

- **`cli/__tests__/models-namespace-sync.test.mjs`** — added 4 new cases pinning the `_gateway` plumbing: preserves name/display_name/description, omits sub-keys when gateway omits them, does not persist `_gateway` into `userSelected` on round-trip, and promotes `_gateway.name` into `profile.name` on Models.dev miss.
- **`cli/__tests__/models-picker-context.test.mjs`** — added 1 new case pinning `toCapabilityProfile`'s propagation of Models.dev `description` and `summary`.

### Risks

- The `_gateway` field is intentionally in-memory only. `applyModels` writes `models`, `tierHints`, `profiles`, `lastUpdated`, `source` — NOT `_gateway`. Operators on 10.19.7 will see zero behavioural difference in `bizar models` until Phase 2 (10.19.8) starts reading the new field.

### Audit references

- F-192 (context-window plumbing) — extension for label / description metadata.

## [10.19.6] - 2026-08-30

`bizar update` is honest now — every documented flag actually does what it claims.

10.19.5 closed the `/model` picker-sync loop, but `bizar update` itself was still broken: `cli/commands/install.mjs#update` called a legacy `runUpdate(args)` alias that ignored every flag. `bizar update --dry-run --force --yes` was functionally identical to plain `bizar update`. The settings.json union-merge path (F-183) was unreachable, `runRepair` was skipped, and the post-update `bizar doctor` check never ran. The help text also advertised `--check`, `--channel=stable|beta`, and `--all`, none of which were ever wired into `parseFlags` or `runInstaller`.

### Fixed

- **`cli/commands/install.mjs#update`** — now routes through the same `parseFlags` + `runInstaller` + `runRepair` pipeline as `install()`. Every documented flag (`--dry-run`, `--force|--deep`, `--yes|-y|--non-interactive`) is forwarded. The post-update `bizar doctor` check (run by `runInstaller`) and the bin-symlink repair (run by `runRepair`) both fire after every successful update. The previous `runUpdate(args)` import was removed.
- **`cli/commands/install.mjs#install`** — symmetric exit-code propagation added: `bizar install` and `bizar update` now both call `process.exit(1)` when `runInstaller` returns `{ ok: false }`, so `bizar update && bizar doctor` short-circuits on install errors.
- **`cli/commands/install.mjs#runUpdateWithFlags`** (new) — testable, dependency-injected core of `update()`. Signature: `runUpdateWithFlags({ args, runInstaller, parseFlags, runRepair })`. Default arguments bind to the real `runInstaller` / `parseFlags` / `runRepair` from the module; tests inject stubs to assert the wiring without touching disk.
- **`cli/commands/install.mjs#runPostInstallerRepair`** (new) — extracted shared teardown so `install()` and `update()` share the same bin-symlink repair block.
- **`cli/commands/util.mjs`** — deleted the dead `case 'update':` branch in the dispatcher. The branch imported `runUpdate` from `./install.mjs`, which never exported it; the import would have thrown at runtime if it were ever reached. `cli/bin.mjs` routes `update` directly to `cli/commands/install.mjs`, so the deletion is a no-op for callers.
- **`cli/commands/install.mjs#showUpdateHelp`** — rewrote to advertise ONLY the flags that actually work after this fix: `--dry-run`, `--force|--deep`, `--yes|-y|--non-interactive`, `--help`. Dropped `--check`, `--channel=stable|beta`, and `--all` (none of which were wired up; will return when implemented). Updated synopsis, behavior prose, and examples to match `runInstaller({ mode: 'update' })`.

### Changed

- **`cli/install/prune.test.mjs`** — added two new `parseFlags` contract tests (exhaustive flag pin + defaults pin). The existing two tests stay.
- **`cli/install/update-wrapper.test.mjs`** (new, 10 cases) — pins the `runUpdateWithFlags` wiring: every documented flag is forwarded to `runInstaller`; `runRepair({})` runs once after `runInstaller` even under `--dry-run` (A6 regression); `runInstaller` returning `{ ok: false }` triggers `process.exit(1)`. Uses `mock.method(process, 'exit')` from `node:test/mock` for the exit-code assertion and `mock.fn` for the dependency stubs.
- **`cli/commands/__tests__/update-help-contract.test.mjs`** (new) — help-text fence test. Reads `cli/commands/install.mjs`, extracts the `showUpdateHelp` template literal, asserts every `--<word>` token in the help body is recognized by `parseFlags`, and asserts `--check` / `--channel` / `--all` are absent. Pairs with the `parseFlags` contract in `cli/install/prune.test.mjs` to catch future help/parser drift.

### Audit references

- A1 (no-op flags) — fixed by routing update through parseFlags + runInstaller.
- A2 (settings.json union-merge unreachable) — fixed (under `--force`).
- A5 (post-update doctor never runs) — fixed (runInstaller calls runDoctor at `cli/install/index.mjs:77-95`).
- A6 (runRepair skipped after update) — fixed (runUpdateWithFlags calls runPostInstallerRepair after runInstaller).
- A7 (help-text drift) — fixed by showUpdateHelp rewrite + update-help-contract.test.mjs pin.

## [10.19.5] - 2026-08-30

`SessionStart` picker-sync hook — `/model` picker survives Claude Code rewrites.

10.19.4 fixed the `modelPicker` schema, but the picker kept disappearing
after every Claude Code session because Claude Code's `/model` picker
rewrites `~/.claude/settings.json` on each user pick and the rewrite
drops `modelPicker`, replaces `model` with the dead gateway alias
(`claude-minimax/MiniMax-M3[1m]`), and leaves a single self-map in
`modelOverrides`. The operator's picker therefore reset to the gateway
default between every Claude Code session, and `model` was pinned to a
model the gateway rejects with `model_not_found`.

### Fixed

- **`config/claude/hooks/sessionstart-model-sync.mjs`** (new) —
  SessionStart hook that re-applies the operator's `userSelected.models`
  block from `~/.config/bizar/config/claude/model-router.json` into
  `~/.claude/settings.json` under three keys: `modelPicker` (rebuilt as
  `{ options: [{ model, label }] }` in pick order), `modelOverrides`
  (rebuilt as a self-map for every live pick), and `model` (reset to the
  first live pick if and only if the current value starts with the dead
  `claude-` namespace prefix). The hook is registered into the
  `session-start` chain in `cli/commands/hook.mjs` so it runs once at
  every Claude Code session start.
- **`cli/commands/hook.mjs`** — `HOOK_PROGRAMS` now maps
  `sessionstart-model-sync` to the new hook file; `EVENT_CHAINS.session-start`
  fires the new leaf ahead of `sessionstart-prime` so the picker is
  rebuilt before the briefing is built.
- The new hook reads the operator's picks **dynamically** from
  `~/.config/bizar/config/claude/model-router.json#userSelected` —
  it never types out a model list, never hardcodes labels, and never
  hardcodes live-vs-stale classification. It reuses the same
  `deriveModelLabel` logic that powers `applyModelPicker` (drop the
  leading provider segment, split on word boundaries) so picker labels
  stay in lock-step with `bizar models`. Operator pick changes
  automatically propagate on the next SessionStart — no SDK release
  required.

### Scope guarantee

The hook ONLY touches `modelPicker`, `modelOverrides`, and `model`.
Every other operator key (`env`, `mcpServers`, `permissions`, `hooks`,
…) is left untouched, and the source-of-truth file
(`~/.config/bizar/config/claude/model-router.json`) is also never
written by the hook. Failure modes (corrupt router, missing router,
unwritable settings, malformed JSON) are logged to
`~/.config/bizar/hook-logs/model-sync-DATE.jsonl` and swallowed — the
hook always exits 0, so a broken sync never blocks session start.

### Added

- **`config/claude/hooks/__tests__/sessionstart-model-sync.test.mjs`** —
  9 new tests covering the happy path (3 picks → 3 picker options +
  3 self-maps + dead-`claude-` alias reset to first pick), the
  derived-label contract (`openrouter/nvidia/...:free` →
  `nvidia nemotron 3 ultra 550b a55b free`), operator-key preservation
  (`env` / `mcpServers` / `permissions` left verbatim), missing-router
  noop, malformed-router swallow, missing-settings auto-create, and a
  source-fence regression check on the contract strings.

## [10.19.4] - 2026-08-30

`/model` picker schema fix — `modelPicker` is an OBJECT, not an array.

10.19.3 wired the picker sync but got the `modelPicker` shape wrong. Claude
Code's settings schema requires `modelPicker: { options: [{ model, label?,
description? }] }`; 10.19.3 wrote a bare top-level array
`[ { id, label } ]`. The result was a `"modelPicker" must be an object with
an "options" array …; received array. This field was ignored.` diagnostic at
startup and no picker contents. The sync itself worked — Claude Code just
refused to honour the malformed key.

### Fixed

- **`cli/commands/models.mjs#applyModelPicker`** — now writes
  `settings.modelPicker = { options: [...] }` (object, not array). Each row
  uses `model` (not `id`) as the field name, matching Claude Code's `Settings
  { model, label?, description? }` per-option schema. Adds optional
  `description` rendering when the gateway profile carries one.
- **`cli/commands/models.mjs#run`** — picker-sync log line now reports
  `${picker.options.length}` rows (was `${picker.entries.length}`).

### Changed

- **`cli/__tests__/models-namespace-sync.test.mjs`** — 10 existing tests
  rewritten to assert `{ options: [{ model, label, description? }] }` shape.
  Added one new test covering `description` surfacing.

## [10.19.3] - 2026-08-30

`/model` picker now driven by operator picks, not gateway discovery.

10.19.2 fixed the picked IDs reaching `settings.json#modelOverrides`, but
`modelOverrides` only silences `[claude-code:unrecognized_model]`
diagnostics — it does NOT populate the `/model` picker. Claude Code's
picker is driven by a separate `modelPicker` array (User-or-managed
scope), which 10.19.2 left untouched. After upgrading to 10.19.2, the
operator still saw only the gateway's default Claude models in `/model`
because nothing told Claude Code "use these specific IDs for the picker".

### Fixed

- **`cli/commands/models.mjs#applyModelPicker`** (new) — after every picker
  save (interactive + `--set`), the picked IDs are written into
  `~/.claude/settings.json#modelPicker` as an array of `{id, label}`
  entries. `label` is derived from the gateway's `name` field when the
  picker profile carries one, falling back to a simple "drop the provider
  segment, split on word boundaries" rendering of the ID
  (`minimax/MiniMax-M3` → `MiniMax M3`, `codex/gpt-5.6-sol` → `gpt 5.6 sol`).
  Same atomic write + corrupt-settings refusal + `null`-skip contract as
  `applyModelOverrides`. Filters out stale IDs (live-gateway gate) so the
  picker stays in sync with what the orchestrator can actually dispatch.
- **`cli/commands/models.mjs#deriveModelLabel`** (new) — the label
  derivation helper. Profile-reported names win; ID-derived fallback
  preserves brand casing verbatim (no invented Title-Case rules).
- **`cli/commands/models.mjs#run`** — picker save flows (interactive
  empty / interactive full / `--set`) now invoke `applyModelPicker` in
  lock-step with `applyModelOverrides`, and the empty-pick path clears
  both keys together.

### Added

- **`cli/__tests__/models-namespace-sync.test.mjs`** — 10 new tests
  covering `deriveModelLabel` (provider-segment drop, brand-case
  preservation, profile-name wins, empty / null), `applyModelPicker`
  (write shape, stale-ID filtering, empty-array write, profile-name
  precedence, `null` skip, corrupt-settings refusal, subprocess wiring
  through `bizar models --set`).

## [10.19.2] - 2026-08-30

Model router gateway-namespace alignment.

The shipped `config/claude/model-router.json#tiers` table and
`cli/commands/models.mjs#classifyKind` both referenced a gateway namespace
(`claude-minimax/*`, `claude-qwen/*`, `cx/*`, `oc/*`) that the live OmniRoute
gateway at `route.polderlabs.io` no longer serves (every legacy ID returns
`404 model_not_found`). Picker picks persisted into the user-selected pool
worked at the dispatch layer only because `bizar models explain` ranks
`userSelected.models` directly without intersecting the stale tier table.
The remaining manual fix — self-mapping picks into
`~/.claude/settings.json#modelOverrides` to silence Claude Code's
`[claude-code:unrecognized_model]` diagnostic — is now built into the
picker.

### Fixed

- **`config/claude/model-router.json#tiers`** — replaced six gateway-dead
  IDs (`claude-qwen/qwen3.8-max`, `cx/gpt-5.6-terra`,
  `claude-minimax/MiniMax-M3`, `claude-minimax/MiniMax-M2.7`,
  `claude-minimax/MiniMax-M2.5`, `cx/gpt-5.6-luna`) with the live namespace
  exposed by the gateway: `qct/qwen3.8-max-preview`, `codex/gpt-5.6-sol`,
  `codex/gpt-5.6-luna`, `minimax/MiniMax-M3`, `minimax/MiniMax-M2.7`,
  `minimax/MiniMax-M2.7-highspeed`, `glm/glm-5.3-flash`,
  `qct/deepseek-v4-pro`, `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free`.
  Tier table now matches what the operator's picker actually selects, so a
  fresh install with no `userSelected` block resolves each tier to a model
  the gateway serves.
- **`cli/commands/models.mjs#classifyKind`** — extended to recognize the
  live provider prefixes (`minimax/`, `codex/`, `glm/`, `qct/`,
  `openrouter/`, `a/`). The previous implementation only knew about the
  six legacy prefixes and tagged every live ID as `kind: "other"`, hiding
  them from any UI that grouped the picker by provider family.
- **`cli/commands/models.mjs#applyModelOverrides`** (new) — after every
  picker save (interactive + `--set`) the picked IDs are synced into
  `~/.claude/settings.json#modelOverrides` using the self-map pattern
  (`<id>` → `<id>`). This is the same workaround Claude Code documents for
  silencing `[claude-code:unrecognized_model]` and turns the previous
  one-time manual fix into part of the standard picker flow. When the
  picker is emptied, `modelOverrides` is cleared in lock-step.
- **`cli/commands/models.mjs#partitionStalePicks`** (new) — stale-ID
  detection for the picker. Each pick is intersected against the live
  gateway pool; IDs that were never returned (e.g. `a/1`) are persisted
  under `userSelected.staleIds` for audit and excluded from the
  settings.json sync so the unrecognized-model diagnostic still surfaces
  them. Operators see `Settings sync skipped N stale id(s): ...` in the
  picker banner and can re-run `bizar models` to drop them.
- **`config/claude/commands/use-premium.md`** — example commands now
  reference `qct/qwen3.8-max-preview` (premium) instead of the legacy
  `claude-qwen/qwen3.8-max`; "when NOT to use premium" section references
  `minimax/MiniMax-M3` (default) and `minimax/MiniMax-M2.7` (mid).

### Added

- **`cli/__tests__/models-namespace-sync.test.mjs`** (new) — regression
  tests covering `partitionStalePicks`, `applyModelOverrides` (atomic
  write + self-map pattern + corrupt-settings refusal + `null` skip),
  `applyModels → applyModelOverrides` wiring, and picker `--set` flow
  sync.

## [10.19.1] - 2026-08-30

Installer verification + dispatcher fix.

### Fixed

- **`cli/bin.mjs` help dispatch routing**: the `--help` dispatcher routed every command — including direct command modules like `bench`, `release-provenance`, `verify-release`, `spec-list` — through `mod.run(cmd, cmdArgs, true)`, a 3-arg signature reserved for `util.mjs` / `install.mjs` / `claude-cmd.mjs` / `migrate.mjs`. Direct command modules export `run(subargs)` and threw `subargs.find is not a function` when their first arg became the literal command name (`"bench"`) instead of the args array. The catch-all `else` branch is removed; direct commands now fall through to the switch statement (which already calls `mod.run(cmdArgs)` correctly). `bizar bench --help`, `bizar release-provenance --help`, `bizar verify-release --help`, and `bizar spec-list --help` now print their usage banner instead of crashing.
- **`cli/__tests__/bin-help-dispatch.test.mjs`** (new): 7 regression tests cover both the direct-command fall-through (bench / release-provenance / verify-release / spec-list) and the legacy util-routed commands (audit / doctor).

## [10.19.0] - 2026-08-29

Production-autonomy audit chain (Milestones 3-4 of `docs/audits/production-autonomy-improvements-2026-08-28.md`). Ships the remaining three audit recommendations (#83 SBOM + provenance + signed-known-good, #84 spec-sprawl reduction, #85 efficiency benchmarks + auto-fan-out rule) as additive public surface.

### Added — 10.19.0-A (release provenance, audit #83)

- `packages/sdk/src/release/sbom.ts`: CycloneDX 1.5 SBOM builder (`buildSbom`).
- `packages/sdk/src/release/provenance.ts`: SLSA v0.2 provenance attestation (`buildProvenanceAttestation`).
- `packages/sdk/src/release/signature.ts`: minisign ed25519 verify / sign (`parseMinisign`, `verifyMinisign`, `signWithEd25519`).
- `packages/sdk/src/release/known-good-releases.ts`: frozen `KNOWN_GOOD_RELEASES` allowlist + `verifyRelease()` (UNKNOWN_RELEASE → RELEASE_REVOKED → TARBALL_HASH_MISMATCH → SBOM_HASH_MISMATCH → PROVENANCE_HASH_MISMATCH × 2 → SIGNATURE_INVALID).
- `cli/commands/release-provenance.mjs`: `bizar release-provenance` writes `<version>.sbom.cdx.json`, `<version>.provenance.intoto.jsonl`, `<version>.minisig` with 0o700 `outDir`.
- `cli/commands/verify-release.mjs`: `bizar verify-release` checks a release artifact set against the pinned allowlist.
- 15 regression tests in `scripts/__tests__/release-provenance.test.mjs`.

### Added — 10.19.0-B (spec-sprawl reduction, audit #84)

- Three SDK schemas export `<NAME>_SCHEMA_VERSION` constants:
  - `OBJECTIVE_RUN_SCHEMA_VERSION = "1.0.0"` (`autonomy/objective-run.ts`)
  - `EVIDENCE_BUNDLE_SCHEMA_VERSION = "1.0.0"` (`autonomy/evidence-bundle.ts`)
  - `OUTCOME_LEARNER_SCHEMA_VERSION = "1.0.0"` (`autonomy/outcome-record.ts`)
- Each factory stamps `schemaVersion` on new records.
- `docs/decisions/AUTONOMY_CONTRACT.md` carries YAML frontmatter (`owner: orchestrator`, `review-cadence: release-cut`, `schema-version: autonomy-contract/v1`).
- `cli/commands/spec-list.mjs`: `bizar spec-list` emits a JSON / human inventory of every schema, every canonical doc, and every `AGENTS.md` mirror sync status.
- 17 regression tests in `scripts/__tests__/spec-sprawl.test.mjs` (mirror parity, frontmatter presence, `bizar spec-list` shape).

### Added — 10.19.0-C (efficiency benchmarks + auto-fan-out rule, audit #85)

- `packages/sdk/src/bench/efficiency.ts` (`EFFICIENCY_BENCH_SCHEMA_VERSION = "1.0.0"`): synthetic harness with `runBench`, `compareConfigurations`, `efficiencyFromRealRuns`. Headline metrics: `costPerVerifiedUsd`, `wallClockPerVerifiedMs` (the audit's "verified outcomes per euro and per wall-clock minute" axes). Deterministic Mulberry32 PRNG keyed by `seed`.
- `packages/sdk/src/bench/auto-reduction.ts` (`AUTO_REDUCTION_SCHEMA_VERSION = "1.0.0"`): `recommendFanOut` / `recommendFanOutBatch` — the audit's "automatically reduce fan-out when coordination overhead exceeds expected benefit" rule, as a pure function. Three stable reasons: `verifier-cannot-certify`, `coordination-overhead-exceeds-benefit`, `single-worker-fan-out`, `keep-current`.
- `cli/commands/bench.mjs`: `bizar bench` with five subcommands (`single-vs-multi`, `sequential-vs-parallel`, `reviewers`, `worktree`, `recommend-fan-out`) and JSON / human output.
- SDK `package.json` gains `./bench` → `./dist/bench/index.js` export.
- 22 regression tests in `scripts/__tests__/efficiency-bench.test.mjs`.

## [10.18.0] - 2026-08-29

Mega-release: 9Router removal + evidence/learning ledger + bounded self-edit + worker-suggest write side.

### Removed

- **9Router and `mcp__9router__*` references** across the shipped harness (config, doctor, validate, settings, prompts, skills). Bizar is now router and provider agnostic. Drift guard (`make verify-removed-surfaces`) asserts no 9Router surface returns.

### Added — 10.18.0-A (9Router cleanup)

- `feat(10.18.0-A.2)`: strip 9Router from shipped config + doctor + validate.
- `feat(10.18.0-A.3+A.4)`: strip 9Router from runtime + retire `9router-*` skills.
- `feat(10.18.0-A.5)`: drift guard against 9Router reappearing.

### Added — 10.18.0-B (evidence + learning ledger)

- `feat(sdk): 10.18.0-B.1`: typed `ObjectiveRun` / `EvidenceBundle` / `OutcomeLearnerOutcome` schema (F-194).
- `feat(cli): 10.18.0-B.2`: typed `EvidenceBundle` ledger at `~/.config/bizar/evidence/` (mode 0o700, single source of truth via `cli/commands/secure-dir.mjs`).
- `feat(sdk+cli): 10.18.0-B.3+D.5`: `worker-suggest` reads `behavior.jsonl` + `instincts.jsonl` + `reject-feedback.jsonl` (structural fingerprint only, no prompt text ever persisted — Q4 invariant).
- `feat(policy): 10.18.0-B.4`: `AUTONOMY_CONTRACT.md` extended for `secure-dir` + learning/evidence enforcement surfaces; `autonomy-contract.test.mjs` regression test pins the file-system contract.

### Added — 10.18.0-C (bounded self-edit)

- `feat(cli): 10.18.0-C`: `bizar improve` subcommand with `propose | run | verify | rollback | list`. Floor: `--apply --yes` + sha256 drift detection + find-exactly-once + verification exit 0. Forbidden proposal keys: `prompt`, `promptRedacted`, `rawPrompt`, `promptText`, `userInput`, `rawInput`, `rawInputBytes`. `improve.jsonl` lives under the same 0o700 evidence dir.
- `bizar improve (run|rollback) ... --(apply|yes)` triggers a `git-workflow-guard.mjs` advisory so the operator reads the proposal before confirming.

### Added — 10.18.0-D (worker-suggest write side + pattern catalog v2)

- `feat(cli+hooks): 10.18.0-D`: `appendWorkerSuggestion()` writes fingerprint-only `worker-suggest` rows to `behavior.jsonl` so future sessions can learn from operator accept/reject. `cli/worker-dispatcher.mjs:recordSuggestion()` bridges the dispatcher to the learning module. `config/claude/hooks/worker-suggest.mjs` invokes `recordSuggestion()` after `dispatch()`. Failure is silent — never throws from the hook path.
- `config/trigger-patterns.json` v2: 11 → 27 workers. Coverage: every shipped Bizar agent (mike, brenda, greg, oscar, paul, linda, todd, karen, pam, steve, susan, janet, carl, kevin, brad, ria) is reachable via a worker prompt.
- `scripts/__tests__/worker-suggest-write-drift.test.mjs`: 5-test drift guard for the write side.
- `scripts/__tests__/autonomy-contract.test.mjs`: +2 Phase D drift tests.

### Fixed

- `packages/sdk/src/router/outcome-learner.ts`: `bucketKey()` was serializing every optional field via `key.X ?? null`, producing `"provider":null` for keys where `provider` was undefined. The selector's `modelToContextKey()` produces keys with explicit `undefined` for `provider` and `contextSizeBucket`; training signals omit those fields entirely. After `?? null` both shapes contained the key but with different values, silently splitting the posterior space — the "sequential record updates the next call's ranking" acceptance test flaked ~20% of runs because the lookup fell into a different bucket than the one being updated. Fixed `bucketKey()` to drop undefined fields so the JSON shape matches what callers pass.

## [10.17.4] - 2026-08-28

- **Feature (MiniMax-M3 1M context window plumbing).**
  `cli/commands/models.mjs` `enrichModelsWithCapabilities` now stamps
  `contextWindow: number | null` on every candidate row from the live
  models.dev catalog (`limit.context`), and the picker renders that as
  `(1M ctx)` / `(200k ctx)` next to each model so operators can see the
  context ceiling at selection time. New `formatContextTokens` helper
  rounds to one decimal place and drops trailing zeros (1,048,576
  tokens → `"1M ctx"`, 2,048,576 → `"2M ctx"`, 200,000 → `"200k ctx"`).
  Verified the MiniMax-M3 1M figure against 4 independent sources:
  models.dev catalog (`limit.context: 1048576`), the MiniMax-M3
  HuggingFace model card, the MiniMax engineering blog, and the
  Claude Code `model-config` docs (`https://code.claude.com/docs/en/model-config`)
  which documents `[1m]` as the canonical 1M-window suffix.

- **Settings template (F-176 explicit-allowlist hardening).**
  `config/claude/settings.json` drops the dangerous 8-pattern commit
  family — `Bash(git -C * commit *)`, `Bash(git -C * push *)`,
  `Bash(git -C * rebase *)`, `Bash(git --git-dir=* commit *)`,
  `Bash(git --git-dir=* push *)`, `Bash(git --git-dir=* rebase *)`,
  `Bash(git --git-dir=* push --force *)`, `Bash(git --git-dir=* push -f *)`
  — so a subagent cannot route a destructive command through a
  `-C <dir>` / `--git-dir=<dir>` prefix to bypass the standard
  `Bash(git push *)` / `Bash(git rebase *)` advisories. Also drops
  `mcp__*`; the explicit `mcp__bizar__*` / `mcp__semble__*` /
  `mcp__agent-browser__*` per-tool allowlist is the source of truth.
  Default `model` field rewrites to
  `claude-minimax/MiniMax-M3[1m]` and a new `modelOverrides` block
  maps the bare ID `claude-minimax/MiniMax-M3` to the same suffixed
  string per Claude Code's `[1m]` 1M-window convention. Re-mirror
  live `~/.claude/settings.json` via `bizar provision`.

- **Settings template flatten + installer union-merge (item 5).**
  `config/claude/settings.json` ships `permissions.allow: []`,
  `permissions.deny: []`, `permissions.ask: []`. The F-176 floor is
  enforced by `config/claude/hooks/permission-request.mjs` returning
  `behavior: 'deny'` for Tier-4 destructive shapes; everything else
  surfaces as advisory reminders from `git-workflow-guard.mjs`,
  `pretooluse-bash.mjs`, and `pretooluse-editwrite.mjs` via
  `additionalContext`. Operators opt into specific `allow` patterns
  by adding them to their live `~/.claude/settings.json`; the
  `force: true` path in `cli/provision.mjs:writeClaudeSettings` now
  re-runs `normalizePermissionLists(existing.permissions, …)` so an
  operator's existing arrays survive a force re-install (the prior
  behavior was for `Object.assign(merged, bizarSettings)` to clobber
  them with the template's empty arrays). New test case in
  `cli/install/force-clean.test.mjs` (`force-write (no clean)
  union-merges operator permissions: custom allow rule survives`)
  seeds `Bash(custom-cmd *)` + `Bash(rm -rf /)` on disk, runs
  `writeClaudeSettings({ force: true })`, and asserts both survive.

- **Test coverage.** New `cli/__tests__/models-picker-context.test.mjs`
  (10 cases) covers `formatContextTokens` rounding/trailing-zero
  behavior, exact-ID context propagation through
  `enrichModelsWithCapabilities`, and picker display rendering of the
  `1M ctx` / `200k ctx` suffix. Extended `cli/__tests__/models-picker.test.mjs`
  with `contextWindow` assertions (exact match, ambiguous-alias null,
  MiniMax-M3 1M flow-through). Updated `cli/provision.test.mjs`,
  `cli/install/force-clean.test.mjs`, `cli/__tests__/settings-permissions.test.mjs`,
  `cli/install/__tests__/merge-settings.test.mjs`, and
  `scripts/__tests__/autonomy-contract.test.mjs` to assert the
  new explicit-allowlist shape (negative assertions for `mcp__*` and
  the dropped dangerous patterns).

- **Gateway discovery env dropped from template (Option A).**
  `config/claude/settings.json` no longer carries
  `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY`, and the production
  writer in `cli/provision.mjs:writeClaudeSettings` no longer emits it
  on fresh installs. The key stays in `FORCE_CLEAN_PRESERVE_ENV_KEYS`
  so an operator who set it explicitly retains it across force
  re-installs (operator-controlled surface). Three assertions in
  `cli/install/__tests__/merge-settings.test.mjs` flipped to assert
  `undefined` instead of `'1'` for the production writer's output.

## [10.17.3] - 2026-08-28

- **Fix (`advisor-context` hook — reviewer context bleed).** The
  SubagentStart leaf `advisor-context.mjs` previously dumped up to 30kB
  of raw parent-session transcript into every dispatch of
  `linda|karen|carl|qa-reviewer|principal-engineer|debug-specialist`,
  including spinner/status records, `<system-reminder>` blocks,
  `<total_tokens>` reminders, last-prompt echoes, sidechain records,
  and prior-session content from the same JSONL (Claude Code appends to
  `~/.claude/projects/.../<id>.jsonl` rather than rotating per session).
  Fresh-task implementers (`@karen`) and the legacy alias agents
  (`@qa-reviewer`, `@principal-engineer`, `@debug-specialist`) now get
  no parent dump at all; only the two agents that genuinely need
  context — `@linda` (read-only QA reviewer) and `@carl` (debug
  specialist) — still receive it. The dump itself is bounded to the
  last **8** substantive records (was 60), each clipped to **800**
  chars (was 3000), with a hard **6kB** total cap (was 30kB). Records
  with `isSidechain`, `isMeta`, or `type ∈ {attachment, system,
  last-prompt, ai-title, agent-name, stop_hook_summary,
  queue-operation}` are filtered out; `<system-reminder>`,
  `<total_tokens>`, and CCR compaction markers are stripped from text
  content. When the filtered dump is below `MIN_USEFUL_LENGTH = 100`
  chars, the hook emits the existing
  *"parent transcript could not be reconstructed. State any context
  needed before making a strong claim."* fallback rather than a noisy
  fragment. New regression coverage:
  `cli/__tests__/advisor-context.test.mjs` (6 cases — filter types,
  6kB cap, 8-record window, `isSidechain`/`isMeta` exclusion, empty-input
  fallback, missing-transcript-path fallback). Updated
  `cli/__tests__/hook-portability.test.mjs` event-chain matcher
  assertions for `@linda` (now receives `agent-grounding +
  advisor-context` only; reviewers are read-only and don't bootstrap a
  worktree), `@karen` (now no longer receives `advisor-context`),
  `@carl` (still receives the full chain including worktree bootstrap
  because debug work happens in a worktree).

## [10.17.2] - 2026-08-28

- **Feature (`bizar models` keypress picker).** When stdin is a TTY, the
  picker now renders an interactive arrow-key / space / enter checklist
  instead of the line-mode loop. Bindings: `↑` / `↓` (or `k` / `j`) move
  the cursor (with wrap-around), `space` (or `x`) toggles the row under
  the cursor, `a` selects every row in original order, `n` clears the
  selection, `enter` / `q` / `esc` confirm, `?` toggles a help footer.
  Long lists scroll inside a 20-row viewport with `⋮ N more above` /
  `⋮ N more below` indicators; the cursor stays inside the window as
  the user navigates. Rendering is ANSI-only: `\x1b[?25l` hides the
  cursor on entry, `\x1b[?25h` restores it on exit, `\x1b[<n>A` rewinds
  the cursor for in-place redraws (no scrollback pollution). The
  line-mode loop is preserved unchanged behind the non-TTY branch so
  pipes, CI, and the existing four `models-picker.test.mjs` cases stay
  green untouched. New `cli/__tests__/models-picker-tty.test.mjs`
  (16 cases) drives the TTY branch in-process via a `MockKeyStdin`
  EventEmitter that satisfies the subset of `process.stdin` the picker
  touches (`isTTY`, `setRawMode`, `setEncoding`, `resume`, `pause`,
  `on/off('keypress')`, `on/off('data')`); one test feeds raw escape
  sequences via `data` to exercise `readline.emitKeypressEvents`
  decoding for `↑` / `↓`. The test file ships in
  `cli/__tests__/models-picker-tty.test.mjs` (excluded from the
  published tarball under `!cli/**/__tests__/**`); tarball file
  count: 341 (unchanged — the new behaviour ships inside the existing
  `cli/commands/models.mjs`).

## [10.17.1] - 2026-08-28

- **Fix (`bizar models` install-time `ERR_MODULE_NOT_FOUND`).** v10.17.0
  shipped F-191/F-192/F-193 but the published tarball did not include
  `packages/sdk/dist/router/failover-mirror.mjs`, so
  `cli/commands/models.mjs` blew up with `ERR_MODULE_NOT_FOUND` on the
  first `bizar install --force` because the file was being imported
  from `packages/sdk/src/` (correctly not shipped). `scripts/build-sdk.mjs`
  now copies the mirror into `dist/` before `tsc` runs (replacing the
  older `scripts/clean-sdk-dist.mjs` clean-only shim), and the CLI
  imports from `packages/sdk/dist/router/failover-mirror.mjs` so the
  path resolves in both the repo and the installed tarball. New
  regression test `cli/__tests__/models-mirror-shipped.test.mjs` (3
  assertions) pins the three pieces together: the file ships at the
  dist path, the CLI never re-introduces a `src/` import, and the CLI
  module dynamic-imports without `ERR_MODULE_NOT_FOUND`. Tarball file
  count: 340 → 341 (exactly +1, the mirror).

## [10.17.0] - 2026-08-28

- **F-191 (IMP-018) — Per-dispatch model evidence store.** Append-only
  `DispatchEvidence` ledger (`packages/sdk/src/router/dispatch-evidence.ts`)
  with `fsync()` durability, SHA-256 input-fingerprint integrity, exactly-once
  `attachOutcome`, and idempotent re-attach for identical canonical outcomes.
  Threaded through `selectDispatchModel` (primary dispatch) and `pickFailover`
  (sequence-1 follow-up row carrying the original `routingDecisionId` +
  `failoverFrom`) so every dispatch and every failover writes one row chained
  by monotonic `sequence`. Shipped the CLI `bizar evidence
  {tail,show,verify,run,audit}` subcommands. Drift guard
  `scripts/__tests__/dispatch-evidence-drift.test.mjs` (8 cases) fails CI if
  `evidenceStore` or any append-call is removed. Merge: `6904e52`.
- **F-192 (IMP-020) — Contextual-bandit outcome learner.**
  `packages/sdk/src/router/outcome-learner.ts` learns per
  `(modelId, tier, role, phase, capability, riskLevel, provider,
  contextSizeBucket)` Beta posteriors — replacing the legacy 6-tier
  Thompson-sampling prior and the cross-bucket Q-learning contamination.
  Module exports `ContextKey` / `OutcomeSignal` (verifiedBy discriminated;
  assistant self-report rejected) / `Posterior` (α/β + successes/failures +
  meanReward + lastUpdated) / `OutcomeLearnerState` / `OutcomeLearner` /
  `OutcomeLearnerError`, plus `createInMemoryOutcomeLearner`,
  `createFileOutcomeLearner` (synchronous JSON snapshot, `restore` merges
  by `lastUpdated`), and `newRoutingDecisionId()`. `record()` validates
  UUID + `verifiedBy`, increments only the matching bucket, auto-quarantines
  a `modelId` after 3 strikes in 24h for `{transport, auth, rate-limit,
  model-quality}` failures (timeout + context-overflow do NOT count), and
  decays via `decayHalfLifeDays` toward floor 1. `ranking()` sorts by
  posterior meanReward with deterministic tier-strength tiebreak;
  `NEVER_DOWNGRADE_ROLES` pin to strongest healthy (no exploration);
  low-evidence (α+β<5) low/medium-risk roles explore 10%. `selectDispatchModel`
  accepts optional `outcomeLearner?: OutcomeLearner`, filters quarantined
  models, and re-orders the remainder via `learner.ranking()`. `pickFailover`
  `FailoverVerdict` gains `failoverFrom: string[]`. `model-router.ts` exposes
  `recordContextualOutcome(signal, learner)` with UUID validation + recent-pick
  verification. Drift guard
  `scripts/__tests__/outcome-learner-drift.test.mjs` (5 cases). Merge: `5ab75ce`.
- **F-193 (IMP-022) — Model-selection E2E matrix.** Test-only surface
  (`packages/sdk/tests/e2e/`) covering direct Agent-tool dispatch, workflow
  dispatch across all six shipped workflows (`bizar-debug`, `bizar-implement`,
  `bizar-research`, `ultracode`, `ultracode-research`, `ultracode-review`),
  team-spawn with per-member `routingDecisionId` uniqueness, and a full
  decision matrix. Wires a real `selectDispatchModel` + `dispatchAgent`
  through four deterministic stubs (agent-tool / provider agree-substitute-
  fail-auth modes / team-spawn / F-191-shaped evidence-store-stub) plus a
  `dispatch-context.mjs` factory harness. Drift guard
  `scripts/__tests__/autonomy-contract-e2e.test.mjs` (5 cases — strips
  comments + strings, scans `packages/sdk/src/` for fixture imports, asserts
  drift probe fires when a fixture is injected). Runner
  `scripts/run-e2e-matrix.mjs`. Merge: `6bb6e09`.
- `recentDecisions` field removed from `ModelRouter` (was a leftover from
  the F-192 design iteration; the canonical recent-pick correlation lives
  on the `recordContextualOutcome(signal, learner, recentPicks?)` parameter
  — no instance state required).
- Versions synchronized at **10.17.0** across root `package.json`,
  `packages/sdk/package.json`, and `packages/sdk/src/version.ts`.
  `packages/sdk/dist/` rebuilt with F-191/F-192/F-193 surface:
  `dispatch-evidence.{js,d.ts}`, `outcome-learner.{js,d.ts}`, updated
  `select-dispatch-model.js`, `failover.js`, `index.js`,
  `model-router.js`, `failover-mirror.mjs`. New exports from
  `@polderlabs/bizar-sdk`: `createFileEvidenceStore`,
  `createInMemoryEvidenceStore`, `EvidenceStoreError`, `DuplicateEvidenceError`,
  `OutcomeConflictError`, `EvidenceNotFoundError`, `createInMemoryOutcomeLearner`,
  `createFileOutcomeLearner`, `newRoutingDecisionId`, `OutcomeLearnerError`,
  `NEVER_DOWNGRADE_ROLES`, `recordContextualOutcome`,
  `ContextualOutcomeReceipt`, `RecentPickRecord`.

## [10.14.0] - 2026-08-03

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
- Versions synchronized at 10.14.0 across root `package.json`,
  `packages/sdk/package.json`, `packages/sdk/src/version.ts`, and
  `.claude-plugin/plugin.json`.

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
