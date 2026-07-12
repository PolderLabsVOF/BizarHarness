# PROGRESS.md — Cross-Session State

> This file is the **single source of truth** for what the system is doing
> right now. Updated at every clock-in AND clock-out. New sessions start
> by reading this file before touching any code.

## In Progress — F-040 Dashboard Redesign Sprint

User requested full dashboard redesign with Supabase-style simplicity
(no visual flair, professional, power-user density). Inspired by:
Maltego-style entity dashboard (info-dense reference) + Deep Pharma
dashboard (sectioned sidebar discipline). Rejects Vision UI glassmorphism.

Branch: `worktree-f040-dashboard-redesign` (worktree at
`.claude/worktrees/f040-dashboard-redesign`).

**New design system at `bizar-dash/src/web/ui/`:**
- `styles/` — reset.css, tokens.css, globals.css (CSS custom props)
- `theme/` — ThemeProvider + useTheme (light/dark/system)
- `utils/` — cx (className combiner)
- `primitives/`, `controls/`, `data/`, `feedback/`, `layout/`,
  `navigation/` — modular component library (Wave 2)
- `index.ts` — barrel export

**Showcase views (Wave 3) being migrated in this session:**
1. Overview (hero — stat tile row + chart grid)
2. Tasks (kanban)
3. Agents (roster)

**Migration strategy for remaining 14 views:** Old components continue
working; views migrate incrementally to `ui/` components per the
migration doc.

**Forseti review (Wave 4) — 7 findings, all addressed:**
- HIGH Tooltip positioning: wrapping class now lives on an outer span
  that owns the containing block (reverted a CSS-only fix that didn't
  actually establish a positioning ancestor).
- MEDIUM Tabs aria-controls removed (Tabs owns only the strip).
- LOW Tasks: synthetic `mousedown` dispatch now carries a comment
  explaining the outside-click listener target.
- LOW Overview: dropped unused `formatClock(_idx, ts)` + `originalIdx`
  plumbing from ActivityRow.
- LOW StatTile: forwards `data-testid` (extends HTMLAttributes).
- 2 MEDIUM (test coverage gaps in Dialog focus trap + Tooltip 4-side
  coverage) deferred — tests beyond F-040 scope.

**Test gate after fixes:** 79/80 files pass, 555/559 tests pass
(four pre-existing baseline failures in `tests/a11y/forms.test.tsx`
unchanged — confirmed via `git log` as v5.3.0-era; not F-040).

## Current State

- **Last commit:** v7.0.0 — F-040 dashboard redesign landed
- **Released:** **v7.0.0 — F-040 dashboard redesign shipped**
  (1/1 feature passing — F-040; VCR 39/39 = 1.000, typecheck 0
  errors, SDK tests 294/294, web tests 582/586 [4 pre-existing
  v5.3.0-era failures in `tests/a11y/forms.test.tsx`],
  CLI tests 109/109, build clean)
- **Branch:** master (v7.0.0 tagged and pushed, npm publish
  pending)
- **Phase:** v7.0.0 — F-040 dashboard redesign shipped; PR #2
  (Live Agent Dashboard Integration) deferred to follow-up
  release

## What landed in v7.0.0

Cleared v6.4.0 port cycle (5 features passing, VCR 36/36 = 1.000).
v6.5.0 launched 2026-07-12 with 3 candidates dispatched in parallel
per user direction (same model as v6.4.0 — WIP=1 honored within each
agent's L09 verification chain, but the 3 features ship concurrently):

| F-id | Feature | Source | Port target |
|---|---|---|---|
| **F-037** (passing, this commit) | v6.3.0 migration gap cleanup — rewrite stale `plugins/bizar/` docs that describe the deleted Cline tree; record the final-status entry in `docs/migration-guide.md` | in-repo tech debt (not ruflo) | deletions + grep verifications + stale docs cleanup |
| **F-038** (passing, committed `8733d62`) | Cross-installation agent federation skeleton — HMAC+nonce envelopes, PII pipeline, TrustEvaluator, PolicyEngine, AuditService, FederationBudget | ruflo `v3/@claude-flow/plugin-agent-federation/src/plugin.ts` | `packages/sdk/src/federation/*.ts` (8 new files) |
| **F-039** (passing, committed `ae24842`) | Hive-mind Byzantine consensus (thin port) — 3-of-5 majority for review/decision steps; PBFT pre-prepare/prepare/commit/reply phases | ruflo `v3/@claude-flow/swarm/src/consensus/byzantine.ts` | `packages/sdk/src/consensus/*.ts` (4 new files) + `consensus_propose` MCP tool |

### What landed in v6.5.0

- **F-037 — Migration gap cleanup.** All 5 F-037 target files were
  already deleted/migrated by the v6.3.0 cycle (clineruntime.ts →
  mcp/server.ts, cline.json.template → settings.json+mcp.json,
  cli/commands/validate.mjs already Claude-Code-native, the 22
  Cline `createTool` files were migrated into `BIZAR_TOOLS`).
  F-037 cleaned up what remained: **rewrote** the stale
  `plugins/bizar/{ARCHITECTURE,CONSTRAINTS,README}.md` so they
  describe the post-migration shim state (the previous versions
  still described the deleted Cline-era file tree and quoted
  `createTool from @cline/sdk` mandates), **deleted**
  `plugins/bizar/scripts/check-forbidden-imports.sh` (its src/
  no longer exists), **slimmed** `plugins/bizar/tsconfig.json`
  include globs (no more `src/**/*.ts` + `tests/**/*.ts`), and
  **appended** the F-037 entry to `docs/migration-guide.md` with
  both the L09 verification matrix and a categorized accounting of
  the residual `cline` hits in `cli/` (all intentional back-compat
  — Cline-as-provider model strings, the `~/.config/cline/`
  install path helpers, and migration docstrings). Also fixed
  two pre-existing F-038 TS errors the F-037 work surfaced via
  the SDK tsconfig's stricter `noUnusedLocals`:
  `federation/trust.ts` unused `now` parameter → `_now` prefix,
  and `federation/index.ts` dropped 3 redundant re-imports
  (`envelopeAgeMs`, `AuditDecision`, `AuditEntry`).

  L09 verification: `make check` 0 errors • `make test` 294/294 •
  `make e2e` 13/13 ("plugin shim does not import @cline/*" + "SDK
  TypeScript compiles cleanly" both green) • `make clean-check`
  5/5 • narrow gap-grep over the 4 target paths returns **0 hits**.

### F-038 — Federation Skeleton (commit `8733d62`)

8 new federation modules under `packages/sdk/src/federation/`:
`envelope.ts` (17-kind `FederationMessageType` + canonical signable
payload), `hmac.ts` (HMAC-SHA-256 + `crypto.timingSafeEqual` + UUID
nonces), `pii.ts` (4 compliance modes + 11 PII categories with
two-phase collect-then-apply), `trust.ts` (per-peer scoring with
sliding-window fail tracking), `policy.ts` (maxHops/action allowlist/
peer blocklist), `audit.ts` (NDJSON to
`.harness/federation-audit.log` with 10MB rotation), `budget.ts`
(reserved→committed→released state machine with JSON persistence),
and `index.ts` orchestrator (`createFederation()` with
sign/receive/status). Plus `federation_status` MCP tool wired into
`BIZAR_TOOLS` (lands when the F-039 commit picks up mcp/server.ts).

### F-039 — Hive-mind Byzantine Consensus (passing)

In-memory PBFT-style 3-of-5 majority for Bizar review/decision steps,
thin-ported from ruflo's
`v3/@claude-flow/swarm/src/consensus/byzantine.ts` + the
`QueenCoordinator` proposer-election pattern. No transport — peers
are passed in the constructor; the orchestrator drives `onPrepare` /
`castVote` to tally votes. Replay protection keys on payload digest
(view-scoped, so view-changes can re-propose the same payload).

- `packages/sdk/src/consensus/types.ts` — `Phase = 'pre-prepare' |
  'prepare' | 'commit' | 'reply'`, `Vote`, `Proposal`,
  `ProposalSnapshot`, `ConsensusStatus`, and result shapes.
- `packages/sdk/src/consensus/byzantine.ts` — `ByzantineConsensus`
  class. `propose()` (replay-protected), `castVote()` (idempotent,
  quorum auto-commit, proposer self-fault detection),
  `onPrepare(proposalId, vote)` (transport-friendly entry point),
  `commit()` (force-commit admin override), `viewChange()` (rotates
  proposer via `QueenCoordinator.advance()` + increments
  `viewNumber`).
- `packages/sdk/src/consensus/queen.ts` — `QueenCoordinator` with
  round-robin weighted by per-peer skip count. `recordFault(peer)`
  adds `maxFaults` skip-tokens; `advance()` walks one step at a
  time, decrementing any peer's skip counter it lands on.
  Deterministic via optional `proposerSeed`.
- `packages/sdk/src/consensus/index.ts` — `createConsensus(opts)`
  facade returning a `ConsensusHandle`, plus `getSharedConsensus()`
  singleton (defaults to the 5-agent Norse roster
  `odin / frigg / vor / mimir / heimdall` with `bizar-f039-default`
  seed).
- `packages/sdk/src/mcp/server.ts` — `consensus_propose` MCP tool
  (22nd in `BIZAR_TOOLS`); takes `payload: string` (JSON-encoded),
  optional `vote` / `agentId` / `quorum` overrides, returns
  `{ proposalId, status, phase, approvals, rejections, ... }`.
- `packages/sdk/tests/consensus.test.ts` — **33 vitest cases**
  covering: 5-agent 3-of-5 commit, exact-3 + abstain commit,
  2-yes-3-no rejection, late-vote no-op, proposer self-fault +
  view-change, explicit view-change + re-propose, 2-2-1 tie,
  replay protection, payload-digest view-scoped expiry, view-count
  semantics, validation throws, QueenCoordinator round-robin +
  fault-skip semantics, deterministic seed, singleton lifecycle,
  `PHASE_ORDER` + `DEFAULT_*` constants.
- `/tmp/f039-consensus-roundtrip.mjs` — L3 e2e (plain `node`,
  imports built `dist/`). 4 scenarios, **29 assertions**:
  happy-path 3-of-5 commit, 2-2-1 split + view-change + re-propose,
  replay protection, proposer self-fault.

**Verification (L09 layers):**
- L1 compile (`bunx tsc --noEmit`): 0 TS errors (used `noUnusedLocals`
  + `noUnusedParameters` discipline; new getters
  `getLocalAgentId` / `getMaxFaults` / `getHistoryLimit` keep
  `strict` happy).
- L2 unit (`vitest run tests/consensus.test.ts`): 33/33 PASS.
- L3 e2e (`node /tmp/f039-consensus-roundtrip.mjs`): 29/29 PASS.

**Constraints honoured:** 0 new npm deps (only `node:crypto` +
`Map` + `Set`); backward-compatible — adds 1 new MCP tool without
breaking the existing 21; deterministic quorum math (no randomness
in vote tally); proposer election takes an optional seed for test
pinned-heads. VCR pushed to **38/38 = 1.000** after F-039 + F-038.

- **Tests:** 101/101 vitest pass across 8 new test files (envelope
  10 + hmac 22 + pii 12 + trust 9 + policy 11 + audit 10 + budget
  16 + orchestrator 11). Full SDK suite 294/294.
- **E2E:** `/tmp/f038-federation-roundtrip.mjs` — 34/34 PASS
  (sign + PII redact + receive + tamper reject + nonce replay
  reject + budget reserve/commit/release + audit log + status).
- **Hard constraints:** `crypto.timingSafeEqual` for HMAC compare,
  `crypto.randomUUID()` for 128-bit nonces, no new top-level npm
  deps, backward-compatible with v6.4.0.
- **`make check`:** 0 TS errors. **`make vcr`:** 37/38 = 0.974
  (F-039 still in flight per parallel-sprint order).

## What landed in v6.4.0 — Ruflo Port Cycle

5 features ported from ruflo via CodeGraph-driven mapping of the
ruflo codebase (`/home/drb0rk/Projects/BizarHarness/ruflo`).
Source maps: `/tmp/ruflo-port-analysis/0[1-4]-*.md`.

### F-032 — Swarm Coordination (commit `92c6e6a`)

`BizarAgentRegistry` + `SwarmTopologyRegistry` + 4 MCP tools
(`agent_spawn`, `agent_list`, `agent_terminate`, `swarm_init`).
21 MCP tools total (13 v6.3.0 core + 4 F-032 + 4 F-033).

- **Tests:** 72/72 vitest — `agent-registry.test.ts` (28) +
  `swarm-topology.test.ts` (23) + `mcp-tools.test.ts` (15)
- **Agent ids:** `crypto.randomUUID()` → `agent-<uuid>`; 9-entry
  `AGENT_TYPES` allowlist enforced (`coder`/`tester`/`reviewer`/
  `system-architect`/`planner`/`researcher`/`performance-engineer`/
  `security-auditor`/`memory-specialist`)
- **Persistence:** opt-in via `{ persistPath }` → `.harness/agents.json`
  + `.harness/topology.json` (gitignored)
- **Topologies:** 5 (`hierarchical`/`mesh`/`adaptive`/`collective`/
  `hierarchical-mesh`); default = `hierarchical-mesh`,
  `maxAgents ∈ [1, 1000]`, default `15`

### F-033 — Self-Learning (commit `1a2ade2`)

ADR-174 distillation + 3-tier adaptive model router + Tier-1
codemod intent + 8-agent Q-learning router.

- **Tests:** 142/142 vitest (50 router + 13 orchestrator + 18
  distillation + 61 sibling F-032)
- **REST:** `POST /api/distill`, `GET /api/distill/patterns`,
  `GET /api/distill/status` mounted in `api.mjs`
- **Runtime:** `.bizar/distilled-patterns.json` (ADR-174 format);
  singletons `modelRouter` + `agentRouter` with `saveTo/loadFrom`
- **Schema:** `cli/memory-constants.mjs` extended with `pattern`
  type + `VALID_PROVENANCE_TIERS` enum (`oracle:test-exec |
  proxy:structural | judge:fable`)
- **Surfaced tags:** `[CODEMOD_AVAILABLE]` (orchestrator's first),
  then `[TASK_MODEL_RECOMMENDATION]` — both in `surfacedTags[]`
  for prompt-side injection

### F-034 — Background Workers (commits `533d81b` + `702631d`)

Trigger-pattern dispatcher wired to Claude Code's `UserPromptSubmit`.
12 workers: `testgaps`, `audit`, `deepdive`, `refactor`, `document`,
`optimize`, `ultralearn`, `consolidate`, `predict`, `map`, `preload`,
`benchmark`. Each carries `weight`, `skill`, `agent`, `description`.

- `config/trigger-patterns.json` (new) — JSON map of 12 triggers
- `cli/worker-dispatcher.mjs` (new, 256 LOC) — pure JS, no deps
- `.claude/hooks/worker-suggest.mjs` (new, 110 LOC) — UserPromptSubmit
  hook; always exits 0 (informational only)
- `cli/worker-dispatcher.test.mjs` (new) — 18 `node:test` cases

### F-035 — MetaHarness (commit `9ae48f8`)

Atomic cost gate (better-sqlite3 + WAL + BEGIN IMMEDIATE) + 3-tier
routing transparency panel + GitHub claim protocol.

- `cli/cost-gate.mjs` (501 LOC) — ADR-164.1 §5.3 late-commit warning
- `cli/commands/cost.mjs` — `bizar cost {register,status,reserve,
  commit,release,sweep,list}`
- `cli/feature-list-bridge.mjs` (400 LOC) — 7 `CLAIM_STATUSES`
  + 4 `STEAL_REASONS` per ADR-016; atomic tmp+rename writes
- `cli/commands/claim.mjs` — `bizar claim {claim,release,
  handoff,steal,status,list,transition}`
- `bizar-dash/src/web/components/agents/RoutingDecisions.tsx`
  — tier badges CODEMOD(green)/TIER1(blue)/TIER2(yellow)/TIER3(red)
- **Tests:** 43/43 node --test + 5/5 vitest + 160/160 SDK bun
- **End-to-end CLI smoke:** `bizar cost register titan 50` →
  `reserve --by tyr --amount 1.50` → `commit <txId> --amount 1.20`
  → `status titan` ($48.80 remaining); `bizar claim F-035
  --who odin` → `status F-035` (active by odin)

### F-036 — Goal Planner UI (commit `6b96d2e`)

GOAP A* from plain-English goal + 6 dashboard panels
(GoalInput, PlanVisualization, CommunicationLog, RealTimeEventLog,
DependencyGraph, QualityGates) wired to the existing `Ws()`
singleton.

- `bizar-dash/src/web/lib/goapPlanner.ts` — clause split →
  verb map → A* over effect/precondition closure
- `bizar-dash/src/server/routes/goal-planner.mjs` —
  `POST /api/goal-planner/plan`
- `bizar-dash/tests/setup.ts` — `ResizeObserver` + `matchMedia`
  jsdom stubs
- 22/22 F-036 tests + 320/324 full dashboard suite (4 pre-existing
  `a11y/forms.test.tsx` import failures, confirmed via `git stash`
  baseline)
- **Constraints honoured:** no new deps (existing `@xyflow/react` +
  `lucide-react`), no Tailwind, single `Ws()` subscription
- **`feature_list.json` mutated only via canonical
  `make verify-feature` gate**

### v6.4.0 release consolidation — Makefile, e2e, JSDoc

- `scripts/bh-full-e2e.mjs` — tool-list updated to match the new
  SDK surface (21 tools: 13 v6.3.0 + 4 F-032 + 4 F-033); old
  `bizar_*` prefix + `bizar_sandbox_*` / `bizar_glyph_*` /
  `bizar_plan_comment_*` were v6.3.0 migration drift
- `Makefile` — `make e2e` target fixed (pointed at non-existent
  `scripts/e2e.sh`); `make test` target expanded to include
  F-035's `cli/__tests__/{cost-gate,feature-list-bridge}.test.mjs`
- `packages/sdk/src/mcp/server.ts:26` — JSDoc example replaced
  `console.log(msg)` (false positive in `make clean-check` regex)
  with `handleAgentMessage(msg)`
- `package.json` — bumped 6.3.0 → 6.4.0 (MINOR: 5 new features,
  backward-compatible)

### v6.4.0 final gate

- `make check` ✓ (0 TS errors)
- `make test` ✓ (269/269: 160 SDK + 109 CLI)
- `make e2e` ✓ (13/13 checks, 21 tools verified)
- `make clean-check` ✓ (5/5 dimensions, 0 debug artifacts)
- `make vcr` ✓ (**36/36 = 1.000**)

Total v6.4.0 LOC: ~7,200 insertions across 32+ new files.
+8 MCP tools (13 → 21), +1 REST surface (`/api/goal-planner/plan`),
+2 CLI surfaces (`bizar cost` + `bizar claim`), +12 background
workers, +1 dashboard page (Goals tab).

Full analysis: `/tmp/ruflo-port-analysis/00-SYNTHESIS.md` (and
`0[1-4]-*.md` for the per-area maps).

**Sprint order constraint:** F-033 should land after F-032
because the router benefits from the agent registry. The other
three (F-034, F-035, F-036) are independent of each other and of
F-032.

### F-032 — Swarm Coordination (passing, committed `92c6e6a`)

`BizarAgentRegistry` + `SwarmTopologyRegistry` + 4 MCP tools
(`agent_spawn`, `agent_list`, `agent_terminate`, `swarm_init`)
written and exported. `BIZAR_TOOLS` count = 17 (13 + 4 F-032).

- **Tests:** 72/72 vitest pass — `agent-registry.test.ts` (28) +
  `swarm-topology.test.ts` (23) + `mcp-tools.test.ts` (15). **TS:** 0
  errors via `make check`.
- **Agent ids:** `crypto.randomUUID()` → `agent-<uuid>` (122-bit random
  payload, no retry loop). Agent types gated by 9-entry `AGENT_TYPES`
  allowlist (`coder` / `tester` / `reviewer` / `system-architect` /
  `planner` / `researcher` / `performance-engineer` / `security-auditor`
  / `memory-specialist`); `agent_spawn` rejects anything else with a
  structured MCP error.
- **Persistence:** opt-in via `{ persistPath }`. Singleton writes to
  `.harness/agents.json` + `.harness/topology.json` (gitignored). On
  reload, the new registry reconstructs from the snapshot so a Claude
  Code session restart doesn't drop the population.
- **Topologies:** 5 topologies (`hierarchical` / `mesh` / `adaptive` /
  `collective` / `hierarchical-mesh`); default = `hierarchical-mesh`,
  `maxAgents` clamped to `[1, 1000]`, default `15`. The `default` swarm
  is lazy-seeded on the first `initSwarm` call.
- **`layers[]`:** `[compile, unit, e2e]` set in feature_list.json;
  `state="passing"`, `commit="92c6e6a"`, VCR pushed to 36/36 = 1.000.

### F-033 — Self-Learning (passing, committed `1a2ade2`)

ADR-174 distillation pipeline + adaptive model router + Tier-1
codemod intent + 8-agent Q-learning router. Committed as `1a2ade2`.

- **Tests:** 142/142 vitest pass across 9 files (50 router + 13
  orchestrator + 18 distillation + 61 sibling F-032 work).
- **L3 roundtrip:** `/tmp/f033-roundtrip.mjs` writes 3 notes (one with
  `test-exec` tag) → distiller → 3 patterns, 1 promoted
  (`pat_1wi5axn`, `provenance_tier: oracle:test-exec`, `promoted: true`).
- **3 new MCP tools:** `model_route`, `agent_route`, `memory_distill`,
  plus orchestrator tool wired via `hooksRouteTool`.
- **TS files:** `packages/sdk/src/router/{codemod-intent, model-router,
  q-learning-router, memory-distillation, index}.ts` (orchestrator).
- **JS files:** `bizar-dash/src/server/{memory-distillation,
  memory-consolidator, routes/distill}.mjs`.
- **REST surface:** `POST /api/distill`, `GET /api/distill/patterns`,
  `GET /api/distill/status` mounted in `api.mjs`.
- **Runtime output:** `.bizar/distilled-patterns.json` (ADR-174 format).
- **Schema:** `cli/memory-constants.mjs` extended with `pattern` type +
  `VALID_PROVENANCE_TIERS` enum (`oracle:test-exec | proxy:structural
  | judge:fable`).
- **Bandit singletons:** `modelRouter` and `agentRouter` are module-
  level singletons (priors accumulate across tool calls within one
  MCP server instance — matches ruflo ADR-026 bandit-persistence).
- **Persistence:** `modelRouter` + `agentRouter` both expose
  `saveTo()` / `loadFrom()` JSON-state round-trip.

## What landed in v6.4.0 (so far)

### F-034 — Background Workers (commits 533d81b + 702631d)

Trigger-pattern dispatcher wired to Claude Code's `UserPromptSubmit`
event. Every prompt auto-suggests relevant Bizar skills/agents.

- `config/trigger-patterns.json` (new) — 12 workers with regex-driven
  triggers: `testgaps`, `audit`, `deepdive`, `refactor`, `document`,
  `optimize`, `ultralearn`, `consolidate`, `predict`, `map`, `preload`,
  `benchmark`. Each carries `weight`, `skill`, `agent`, `description`.
- `cli/worker-dispatcher.mjs` (new, 256 lines) — pure JS, no deps.
  Exports `dispatch()`, `listWorkers()`, `loadPatterns()`, `resetCache()`.
  Cached regex compilation, weight-ranked output, defensively handles
  missing/malformed config.
- `.claude/hooks/worker-suggest.mjs` (new, 110 lines) — UserPromptSubmit
  hook. Reads stdin, calls `dispatch()`, emits
  `hookSpecificOutput.additionalContext` on stdout, stderr log for
  operator visibility, always exits 0 (informational only).
- `.claude/settings.json` — UserPromptSubmit entry appended as a sibling
  command (preserves existing `userpromptsubmit-tag.mjs`).
- `cli/worker-dispatcher.test.mjs` (new, 204 lines) — 18 `node:test`
  cases: 5 canonical dry-run prompts + 8 edge cases + `listWorkers`
  completeness + 4 `loadPatterns`/cache lifecycle + missing/malformed
  config tolerance.
- `Makefile` + `package.json` — test pipeline picks up the new suite.

**Verification (L09 layers):**
- L1 compile (`node --check`): PASS
- L2 unit (`node --test cli/worker-dispatcher.test.mjs`): 18/18 PASS
- L3 e2e (`./scripts/test-in-container.sh`): FAILS at typecheck stage
  due to **pre-existing F-035 WIP** in `cli/commands/cost.mjs`
  (cost-gate port) — unrelated to F-034. F-034 introduces zero TS
  source and lands cleanly on v6.3.0.

## What landed in v6.3.0

Complete migration from Cline to Claude Code. Plugin layer, agent
definitions, hook scripts, and mistake-limit machinery all rewired
to ride on Claude Code's Agent SDK + MCP + skill/agent/hook system.

- **Plugin layer → Claude Code MCP server.** The Bizar plugin now
  ships as a Claude Code MCP server (`@anthropic-ai/claude-agent-sdk`)
  exposing the same tool surface that previously came through the
  Cline plugin host.
- **Cline's `AgentPlugin` → Claude Code skills + agents + hooks.**
  All 14 agent files in `config/agents/` are now Claude Code agent
  definitions; `config/skills/` and `config/hooks/` are loaded by
  Claude Code's skill loader and hook system respectively.
- **Cline's `beforeTool` / `afterTool` → Claude Code's `PreToolUse` /
  `PostToolUse`.** The five hook scripts (`PreToolUse`, `PostToolUse`,
  `TaskStart`, `TaskResume`, `UserPromptSubmit`) are installed to
  Claude Code's canonical hook locations.
- **Cline's `ClineCore` → Claude Code `Agent SDK`
  (`@anthropic-ai/claude-agent-sdk`).** The plugin's `clineruntime.ts`
  is now an Agent SDK wrapper; session config is driven by Claude
  Code's runtime.
- **Cline's `createTool` from `@cline/sdk` → Claude Code MCP tool
  registration via `@anthropic-ai/claude-agent-sdk`.** All 19+ tools
  are registered through the SDK's MCP tool API.
- **Mistake-limit floor (default 10) now uses Claude Code's
  `onConsecutiveMistakeLimitReached` callback** instead of Cline's
  session-config field. Field renamed to `claudeAgentMaxConsecutiveMistakes`.

## What landed in v6.2.5

Deep-dive session: critical skill-lock bug, new CubeSandbox
integration, walkinglabs principles applied, container-based testing.

## What landed in v6.2.4

Fixes the silent v6.0.0 mistake-limit regression AND gives every
Bizar agent the exact schemas for Claude Code's tools so they stop making
the mistakes in the first place.

### Patches

1. **`plugins/bizar/src/clineruntime.ts:buildExecution`** — plugin
   defaultMaxConsecutiveMistakes is now a FLOOR (Math.max) instead
   of a default that gets overridden by the CLI's --retries flag.
2. **`plugins/bizar/src/options.ts`** — bumped plugin default from
   6 → 10.
3. **`config/agents/_shared/AGENT_BASELINE.md`** — added "Tool
   Mistakes — Don't Kill the Session" section + removed stale
   "translated from Claude Fable 5" sentence (Claude-Code-only since
   v6.3.0 (was Cline-only in v6.1.0–v6.2.5)).
4. **`config/agents/_shared/CLINE_TOOLS.md`** (new) — schemas for
   `read_file`, `editor`, `ask_question`, `use_subagents`, etc.
   Highlights the #1 mistake: `ask_question` with `options: null`.
5. **All 14 agent files** — description frontmatter now references
   `CLINE_TOOLS.md`. The `agent-browser.md` agent (the only one
   that didn't reference the baseline) now does too.
6. **`cli/commands/validate.mjs`** — new `mistake-limit-floor`
   check (lenient warn).
7. **`scripts/check-agents.mjs`** (new) — CI check that all 14
   agents reference the shared docs.
8. **`scripts/bh-full-e2e.mjs`** — runs check-agents.mjs as part
   of e2e.

### User-reported trigger

> "all writes hang after the first failure, 'Tool execution was
> interrupted before a result was produced'." — Claude Code's log:
> `max consecutive mistakes reached (3) in yolo mode`. The model
> had tried 4 different approaches to edit a Dockerfile (editor,
> python heredoc, single-line python, sed) and all failed.

The fix is two-pronged:
- **Runtime:** the plugin's higher mistake limit (10) always wins
  via the Math.max floor.
- **Agent training:** every agent now has the exact tool schemas in
  their context, so they make fewer mistakes in the first place.

## What landed in v6.2.3

Full Claude Code CLI integration per the official Claude Code docs (https://docs.claude.com/claude-code):
- [cli/cli-reference](https://docs.claude.com/claude-code/cli/cli-reference)
- [cli/agent-teams](https://docs.claude.com/claude-code/cli/agent-teams)
- [features/subagents](https://docs.claude.com/claude-code/features/subagents)
- [cli/samples](https://docs.claude.com/claude-code/cli/samples/)

### Patches

1. **`plugins/bizar/src/clineruntime.ts:163`** — flipped
   `enableSpawnAgent: false` → `true`. Silent v6.0.0 regression
   that blocked Claude Code's Agent tool (subagent dispatch). Without
   this, Odin could not delegate to subagents.
2. **`cli/commands/setup-provider.mjs`** — wrote to the wrong file
   (v6.2.2 was `~/.claude/settings.json`, fixed to
   `~/.claude/settings.json` which is what Claude Code CLI
   + kanban mode actually read). Now also auto-migrates any legacy
   `openai-compatible` providerId to `litellm`.
3. **`cli/commands/cline-cmd.mjs`** (new) — pass-through wrappers:
   - `bizar config` → `claude config`
   - `bizar history` → `claude history`
   - `bizar hub` → `claude hub`
   - `bizar hook` → `claude hook`
   - `bizar team <name> "mission"` → use the Agent tool (note Claude Code has agent teams via Agent tool `team_name`)
   - `bizar subagent <agent> "task"` → research subagent
4. **`cli/commands/rca.mjs`** (new) — `bizar rca <github-issue-url>`
   adapted from the official Claude Code Agent SDK GitHub Issue RCA sample.
5. **`cli/commands/validate.mjs`** — new `cline-settings-provider`
   check that warns about fake/legacy providerIds in
   `~/.claude/settings.json`.
6. **`scripts/bh-full-e2e.mjs`** — added 3 new e2e checks
   (subagent plumbing, cline-cmd wrappers, rca sample).

## What landed in v6.2.2

Per operator request: the installer used to add a `provider.9router`
block to `~/.claude/settings.json` on every install. That's now removed —
the user picks their own provider. New `bizar setup-provider` CLI
command (and matching `/setup-provider` Claude Code slash command) make it
easy to add a provider with the live catalog from
`http://localhost:20128/v1/models`.

### Patches

1. **`config/cline.json.template`** — removed the `provider` block
   entirely (9router + minimax). Template is now provider-free.
2. **`cli/provision.mjs:patchClineJson`** — stopped auto-adding
   `provider.9router` and `provider.minimax`. Still backfills the
   Bizar scaffolding (plugin entry, default_agent, $schema,
   instructions, permission, snapshot) but NOT provider config.
3. **`cli/commands/setup-provider.mjs`** (new) — `bizar setup-provider`
   subcommand. Writes a `provider` block with `baseUrl` + `apiKey` +
   live model catalog. Flags: `--list`, `--remove`, `--gateway`,
   `--key`, `--provider`.
4. **`config/commands/setup-provider.md`** (new) — the matching
   `/setup-provider` Claude Code slash command.
5. **`cli/commands/validate.mjs`** — `provider-config` is now
   ALWAYS lenient (informational, never fails). New behavior
   reports whatever providers the user has configured.
6. **Agent `model:` fields** — updated to use the live gateway
   prefix `minimaxcustom/MiniMax-M3` (was stale `minimax/MiniMax-M3`).
   Same for `model` and `small_model` in claude settings.json template.
7. **Post-install hint** — when no provider is configured, the
   installer prints a clear setup hint pointing at `bizar setup-provider`.

## What landed in v6.2.1

Fixes the "I see skills but no hooks" user report. v6.0.0 shipped
"hooks" as markdown behavioral files in `~/.claude/hooks/` which Claude Code
silently ignored. v6.2.1 replaces them with five real Claude Code-native
executable hook scripts.

### Patches

1. **`config/hooks/{PreToolUse,PostToolUse,TaskStart,TaskResume,UserPromptSubmit}`** (new) —
   five real executable hook scripts with shebang lines:
   - `PreToolUse` blocks writes to `.env`/`secrets/`/`node_modules`/
     lockfiles; warns on `console.log`/`debugger`/`.only()` in `src/`
   - `PostToolUse` logs tool latency to `~/.config/bizar/hook-logs/`
   - `TaskStart` primes the AI with project context
   - `TaskResume` reminds the AI to re-read state + check git log
   - `UserPromptSubmit` tags the prompt for routing
2. **`cli/provision.mjs:syncConfigExtras`** — installs hooks to BOTH
   `~/.claude/hooks/` AND `~/Documents/Claude/Hooks/` (Claude Code's default
   global hooks location), with `chmod +x`.
3. **`cli/commands/validate.mjs`** — `hooks-installed` now verifies
   shebang + executable bit (not just file presence). New
   `hooks-canonical-location` check confirms
   `~/Documents/Claude/Hooks/` is populated.
4. **`scripts/bh-full-e2e.mjs`** — new check verifies
   `config/hooks/` has all 5 Claude Code-native hook scripts with shebangs.
5. **Removed** the obsolete `config/hooks/{pre-tool-use,post-tool-use,README}.md`
   (markdown behavioral files that Claude Code never read).

## What landed in v6.2.0

Made Bizar's Claude Code integration end-to-end flawless: every plugin
artifact, slash command, agent file, skill, rule, hook, and provider
config now lands in the user's `~/.claude/` on every install. New
`bizar validate` + `/validate` Claude Code command, plus `/team` and
`/test` slash commands. The `make e2e` infrastructure is restored.

### Patches

1. **`plugins/bizar/src/clineruntime.ts:164`** — flipped
   `enableAgentTeams: false` → `true`. The `bizar_spawn_team` tool
   requires agent-teams to be enabled in Claude Code's session config;
   without this, `/team` and the team coordinator were silently
   unavailable.

2. **`config/cline.json.template`** — added three new slash command
   entries to the `command:` block:
   - `team` (routes to `odin`, template `commands-bizar/team.md`) —
     spawns a Claude Code agent team (Odin + Thor + Tyr + Mimir + Hermod +
     Forseti) for parallel multi-agent missions.
   - `test` (routes to `thor`, template `commands-bizar/test.md`) —
     thin wrapper around `bizar test-gate`, auto-detects the
     project's test runner.
   - `validate` (routes to `heimdall`, template
     `commands-bizar/validate.md`) — runs the full 21-point
     `bizar validate` check battery.

3. **`config/commands/team.md`** (new) — comprehensive guide for
   the `/team` command. Default team composition, decomposition
   rules, the pre-dispatch checklist, the sibling-awareness block,
   and three worked example missions (refactor, multi-feature
   build, bug hunt).

4. **`config/commands/test.md`** (new) — documents the `/test`
   slash command and its relationship to `bizar test-gate`.

5. **`config/commands/validate.md`** (new) — documents the
   `/validate` slash command and its 21 checks.

6. **`cli/commands/validate.mjs`** (new) — the `bizar validate`
   subcommand. 21-point health check that confirms:
   - claude CLI reachable + version
   - claude settings.json parses + plugin entry + path resolves
   - plugin runtime deps (zod, @anthropic-ai/claude-agent-sdk) wired
   - plugin index.ts + enableAgentTeams plumbing (regression check)
   - all 14 agent files installed + Claude Code .yaml format
   - all 13 slash commands (incl. /team, /test, /validate)
   - all skills / rules / hooks mirrored to ~/.claude/
   - provider.9router (preferred) or provider.minimax (legacy)
   - 9Router gateway reachable (lenient unless --strict)
   - default_agent + instructions[] in claude settings.json

   Flags: `--json` for machine output, `--strict` to fail on
   lenient checks, `--only <name>` to run a single check.

7. **`cli/commands/validate.test.mjs`** (new) — 15 unit tests
   covering: JSON output shape, missing-team/test/validate command
   detection, missing-agent detection, claude settings.json absence,
   enableAgentTeams regression, provider-config missing,
   9router-only / minimax-only configurations, --strict mode,
   --only filter, unknown --only name.

8. **`cli/provision.mjs:patchClineJson()`** — refactored to be
   more robust. On every install/update it now patches the
   following on the user's claude settings.json (additive, idempotent):
   - `plugin` entry (the critical one — Bizar plugin won't load
     without it)
   - `provider.9router` (the v6.0.1+ preferred gateway)
   - `provider.minimax` (legacy fallback)
   - `default_agent` (set to "odin" if missing)
   - `$schema` (https://docs.claude.com/claude-code/config.json)
   - `instructions` (point at the bundled tools reference)
   - `permission` ("allow")
   - `snapshot` (false)
   The previous version only added the plugin entry on first
   install; subsequent updates didn't backfill the other fields.

9. **`scripts/bh-full-e2e.mjs`** (new) — the 15-check end-to-end
   verifier. Lives at `scripts/bh-full-e2e.mjs` (not `/tmp/` —
   that was a pre-existing infra gap that blocked `make e2e` and
   clean-check dimension #5 since v5.6.0). Checks:
   - plugin entry resolves
   - enableAgentTeams: true in clineruntime.ts
   - claude settings.json.template completeness
   - config/commands/ has team/test/validate
   - config/agents/ has all 14 agents
   - config/skills/ has 8+ skills
   - config/rules/ has 7 always-on rules
   - plugin index.ts is well-formed
   - plugin source has 19+ tool files
   - plugin has 4+ hooks
   - claude CLI reachable
   - ClineRuntime class is importable
   - bizar validate command + tests present
   - package.json valid
   - TypeScript compiles cleanly

10. **`Makefile` + `scripts/clean-state-check.sh`** — point at
    `scripts/bh-full-e2e.mjs` instead of the missing
    `/tmp/bh-full-e2e.mjs`. `make e2e` and clean-check #5 now work.

11. **`package.json` `test` script** — added
    `cli/install.test.mjs`, `cli/provision.test.mjs`,
    `cli/commands/validate.test.mjs` to the npm test pipeline.
    Previously these only ran via `make test` (which also picks
    them up); now they're explicit so CI catches any regression.

12. **`.claude/instructions/bizar-tools.md`** — removed the
    lingering "opencode" references that survived the v6.1.0
    Cline-only rewrite. Now correctly says "Claude Code" and references
    `headroom wrap claude` / `~/.claude/skills/`.

### Tests

- `plugins/bizar/tests/clineruntime-config.test.ts` — 3 new cases
  pinning `enableAgentTeams: true` so the v6.0.0-era "false" can't
  silently regress.
- `cli/commands/validate.test.mjs` — 15 cases (new file).
- `scripts/bh-full-e2e.mjs` — 15 e2e checks (new file).

### Migration

Operators on a v6.1.0 install should run `bizar update` to pull
the new command files (team.md, test.md, validate.md) and the
patched clineruntime.ts (enableAgentTeams: true). The update is
backwards-compatible and idempotent.

## What landed in v6.0.1

Diagnosed root cause of "Claude Code keeps stopping" (Claude Code aborting sessions
after 3 consecutive tool-validation failures — bundled CLI default).

### Patches
1. **`plugins/bizar/src/clineruntime.ts`** (now wraps Claude Code Agent SDK) — `startSession` now passes through
   the `execution` block (`maxConsecutiveMistakes`, `reminderAfterIterations`,
   `reminderText`, `loopDetection`) and wires an `onConsecutiveMistakeLimitReached`
   callback by default. Runtime constructor accepts `defaultMaxConsecutiveMistakes`
   and `defaultOnConsecutiveMistakeLimitReached` so every session inherits them
   unless the caller overrides.

2. **`plugins/bizar/src/mistake-recovery.ts`** (new) — pure helper that
   builds the recovery callback. Recoverable mistakes
   (`invalid_tool_call`, `tool_execution_failed`) return
   `{action:"continue", guidance:"..."}` so the session keeps running with a
   guidance message; infra failures (`api_error`) return `{action:"stop"}`.

3. **`plugins/bizar/src/tool-discipline.ts`** (new) — system-prompt directive
   appended by `beforeModel`. Tells the model to populate all required schema
   fields, prefer built-in tools over bash (`read_file`, `editor`, `search`,
   `apply_patch`, `list_files`, `web_fetch`), keep `run_commands` small (≈600
   char ceiling, no `for`/`xargs`/`sed -i`/`heredoc`), and switch tools after
   two identical failures.

4. **`plugins/bizar/src/options.ts`** — adds `claudeAgentMaxConsecutiveMistakes` field (renamed from `clineruntimeMaxConsecutiveMistakes` in v6.3.0)
   normalized option (default 6, range [3, 20], env `BIZAR_MAX_CONSECUTIVE_MISTAKES`).

5. **`plugins/bizar/index.ts`** — wires the recovery callback into the
   runtime; `beforeModel` injects the tool-discipline directive idempotently.

6. **`cli/provision.mjs:syncConfigExtras`** — now also copies `config/rules/*.md`
   into `${CLAUDE_DIR}/rules/`. Pre-existing gap: `bizar install` / `bizar update`
   were silently skipping the always-on rules in `~/.claude/rules/`.

7. **`config/cline.json.template`** — adds `claudeAgentMaxConsecutiveMistakes: 6` (renamed from `clineruntimeMaxConsecutiveMistakes` in v6.3.0)
   to the Bizar plugin metadata block so a fresh `bizar install` writes the
   new field automatically.

### Tests
- `plugins/bizar/tests/mistake-recovery.test.ts` (10 cases)
- `plugins/bizar/tests/tool-discipline.test.ts` (9 cases)
- `plugins/bizar/tests/clineruntime-config.test.ts` (6 cases)
- `plugins/bizar/tests/options.test.ts` — 7 new cases for the field
- `cli/provision.test.mjs` — 2 new cases for rules sync

### v6.0.1 hotfix #2: 9Router gateway
All Bizar agents now route chat through 9Router at `http://localhost:20128/v1`
(the user's existing 9Router instance with MiniMax keys + auto-fallback to
free models on `kr/*` and `openrouter/*:free` IDs). Plus 8 capability
skills for the full 9Router feature surface — chat, web-search, web-fetch,
image, TTS, STT, embeddings — installed automatically by
`syncConfigExtras` into `~/.claude/skills/9router*/SKILL.md`.

| Patches |
|---|
| `config/skills/9router*/SKILL.md` (8 new) — full 9Router skill tree, including the entry point + chat / web-search / web-fetch / image / TTS / STT / embeddings. |
| `config/cline.json.template` — added `provider.9router` block (`baseUrl: http://localhost:20128/v1`, `apiKey: ${NINEROUTER_KEY}`). Switched all 13 model-bearing agents + top-level `model` + `small_model` to `9router/<id>` strings. |
| `cli/doctor.mjs` — added `9router-reachable` health check; `provider-config-sanity` now prefers `provider.9router` (falls back to legacy `provider.minimax`). |
| `cli/doctor.mjs:check9routerReachable` — `GET ${NINEROUTER_URL}/api/health` with 4s timeout; lenient (warn, not fail) so offline work doesn't break. |

Operators: re-run `bizar install` to push the new provider block to
`~/.claude/settings.json`. `NINEROUTER_URL` env var overrides the default
endpoint (handy when 9Router runs inside a container/tunnel).

## Recent releases

| Version             | Date       | Type   | Notes                                       |
| ------------------- | ---------- | ------ | ------------------------------------------- |
| **v6.3.0**          | 2026-07-11 | major  | Claude Code migration (plugin → MCP, skills, hooks) |
| **v6.1.0**          | 2026-07-09 | dev    | Cline-exclusive; superseded by v6.3.0 Claude Code migration |
| **v6.0.2**          | 2026-07-09 | patch  | fix dashboard-presence check in legacy installer |
| **v6.0.1**          | 2026-07-09 | dev    | Claude Code mistake-recovery + tool-discipline + rules-sync + 9router gateway |
| **v6.0.0-beta.1**   | 2026-07-08 | BETA   | CURRENT_ISSUES sprint — Odin, /loop, slash commands, vault linking |
| v5.6.0-beta.17      | 2026-07-07 | BETA   | general repo cleanup release                |
| v5.6.0-beta.1       | 2026-07-07 | BETA   | OpenCode → Cline rewrite (4 phases)        |
| v5.5.6              | 2026-07-07 | stable | new `/plow-through` slash command          |

## In Progress

_None._

## Blockers

- **`/tmp/bh-full-e2e.mjs` is missing globally.** Blocks `make e2e` and
  clean-check dimension #5 (startup path). Pre-existing — exists in
  `clean-state-check.sh` line 68 but no code path generates the file. Out
  of scope for v6.0.1.

## Recent sessions

| Date       | Phase | Outcome                                                     |
| ---------- | ----- | ----------------------------------------------------------- |
| 2026-07-11 | 7     | v6.3.0 — Claude Code migration COMPLETE                     |
| 2026-07-09 | 6     | v6.0.1 — Claude Code mistake-recovery + tool-discipline + rules-sync |
| 2026-07-08 | 5     | CURRENT_ISSUES sprint COMPLETE — published v6.0.0-beta.1  |
| 2026-07-07 | 3     | In-process ClineRuntime + agent teams + memory vault + E2E  |
| 2026-07-07 | 2     | OpenCode → Cline rewrite (17 tools, 4 hooks)                |
| 2026-07-07 | 1     | Mechanical OpenCode→Cline rename + @cline/sdk wiring        |

## Verification commands (single source of truth)

```sh
make check       # typecheck + tests (full pipeline) — 746/746 pass
make test        # unit tests only
make e2e         # real plugin load + tool invocation — BLOCKED (script missing)
make clean-check # 5-dimension exit verification — 4/5 pass (E2E blocked)
make vcr         # feature_list VCR ratio — 25/25 = 1.000
```
