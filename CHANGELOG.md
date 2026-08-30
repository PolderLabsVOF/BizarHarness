# Changelog

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
