# AUTONOMY_CONTRACT — Bizar Harness Autonomous Behavior Contract

**Status:** Accepted
**Date:** 2026-08-27
**Implements:** F-176, F-181, F-182, F-183, F-184
**Supersedes:** any contradicting `permissions.deny` / `permissions.ask`
prose in `AGENTS.md` or older `DEC-*` documents.

## Purpose

This document is the canonical contract for what Bizar Harness agents may
do autonomously and what requires human approval. It is the single source
of truth that the settings template, the hook chain, the orchestrator
prompt, and the audit ledger are validated against. Any change to the
rules below must update both the contract and the
`scripts/__tests__/autonomy-contract.test.mjs` consistency test in the
same commit.

## Tier 1 — Full autonomy (no prompts)

Agents have full permissions by default. The following are always
allowed silently:

- All file reads, edits, and writes within the repository
- All `Glob` / `Grep` operations
- All `Bash` commands EXCEPT those in Tier 3 (escalation list)
- All `WebFetch` / `WebSearch` calls
- All MCP tool calls
- All `CronCreate` / `CronDelete` / `CronList` / `ScheduleWakeup`
- Local `git commit` (including `--amend`, `git -C`, and
  `git --git-dir=` variants)
- `Agent` dispatches to other Bizar custom agents

## Tier 2 — Advisory (allow + 🟡 reminder)

PreToolUse hooks return `permissionDecision: "allow"` plus
`hookSpecificOutput.additionalContext` describing the recommended
action. Agents should heed the advice but may proceed regardless.
Examples:

- `/simplify` not run on the current staged diff
- Humanize patterns present in a `Write` payload
- Model override outside the active `userSelected` pool

## Tier 3 — HitL approval (gated by hooks)

The following categories require explicit human approval via
`permission-request.mjs` and `git-workflow-guard.mjs`:

- Pushes to any shared branch (`Bash(git push *)`, `--force`, `-f`)
- Rebase, history rewrite, remote branch deletion
- Pull-request mutations (`Bash(gh pr create *)`, `Bash(gh pr merge *)`)
- Releases, package publication (`npm publish`, `bun publish`,
  `pnpm publish`, `Bash(gh release create *)`)
- Deployments (`vercel deploy`, `wrangler deploy`, `flyctl deploy`)
- Production / shared-infrastructure writes
- Credential changes (env vars, secret-store mutations)
- Public exposure (binding a port to `0.0.0.0`)
- Irreversible local destruction (`rm -rf /`, `mkfs`, `shutdown`,
  `kill 1`)

## Tier 4 — Blocked (always denied)

These are blocked at the hook layer with no override path:

- Reads of `.env`, `.env.local`, `.envrc`, `secrets/`, `credentials/`
- Writes to `node_modules/`
- `Bash(sudo *)`
- Direct reads of `~/.aws/credentials`, `~/.ssh/id_*`
- `git push --force` / `-f` against any branch
- `git rebase` against any branch

## Settings template

`config/claude/settings.json` must satisfy:

- `permissions.deny` is `[]` (Tier 4 protection lives in hooks, not in
  the settings surface, so the floor is enforceable from any host that
  respects the hook chain).
- `permissions.ask` is `[]` (Tier 3 escalation is also hook-driven; the
  HITL prompt fires only when an agent hits a hard approval category).
- `permissions.allow` includes at minimum the patterns listed in
  Tier 1. The factory in `cli/provision.mjs#writeClaudeSettings` reads
  this template verbatim and ships it through `bizar install`.
- `defaultMode` is `"bypassPermissions"`.

## Cross-references

- `AGENTS.md` "Autonomy and parallelism" — operational interpretation
- `config/claude/settings.json` — settings template
- `config/claude/hooks/permission-request.mjs` — Tier 3 / Tier 4 floor
- `config/claude/hooks/git-workflow-guard.mjs` — Tier 3 git surface
- `config/claude/hooks/pretooluse-bash.mjs` — Tier 3 / Tier 4 bash
- `config/claude/hooks/pretooluse-editwrite.mjs` — Tier 4 secrets
- `config/claude/hooks/simplify-guard.mjs` — Tier 2 (advisory)
- `config/claude/hooks/content-style-guard.mjs` — Tier 2 (advisory)
- `config/claude/hooks/agent-model-guard.mjs` — Tier 2 (advisory)
- `cli/commands/secure-dir.mjs` — F-194 0o700 mode contract for `evidence/` + `learning/` (no mkdir or chmod duplicates at the call site)
- `packages/sdk/src/learning/behavior-capture.ts` — F-194 structural-fingerprint contract (BEHAVIOR_DIR_MODE=0o700, FORBIDDEN_BEHAVIOR_KEYS)
- `config/claude/hooks/worker-suggest.mjs` — Q4 invariant: never reads or echoes a prompt-shaped field
- `scripts/__tests__/autonomy-contract.test.mjs` — consistency test

## Enforcement

A drift from this contract is a regression. The
`scripts/__tests__/autonomy-contract.test.mjs` test asserts:

1. The hard approval list in this contract matches the patterns
   enforced by `permission-request.mjs` and
   `git-workflow-guard.mjs`.
2. The settings template ships `permissions.deny: []`,
   `permissions.ask: []`, and a `defaultMode: "bypassPermissions"`.
3. Every Tier 1 entry is present in `permissions.allow`.
4. The hard-deny list in `pretooluse-bash.mjs` and
   `pretooluse-editwrite.mjs` matches Tier 4.

A failure on any of those is a blocker — `make test` must remain green.

## Milestone alignment — production-autonomy audit (commit `2a283c1`)

This contract is the Milestone 1 surface of the audit's 4-milestone
implementation sequence. The deliverables below are the source of truth
for "what must be true at the end of each milestone"; the contract above
remains the authority for tier membership (Tier 1 / 2 / 3 / 4).

### Milestone 1: One source of truth — ✅ shipped in 10.18.0

- AUTONOMY_CONTRACT.md + `scripts/__tests__/autonomy-contract.test.mjs`
- Typed `ObjectiveRun` / `EvidenceBundle` / `OutcomeLearnerOutcome`
  schemas in `packages/sdk/src/router/`
- Evidence ledger at `~/.config/bizar/evidence/` (0o700, single source
  of truth via `cli/commands/secure-dir.mjs`)
- Behavior ledger at `~/.config/bizar/learning/` (0o700, fingerprint
  only — Q4 invariant)
- `bizar improve` subcommand with `--apply --yes` floor + sha256 drift
  detection + find-exactly-once + verification exit 0
- `sprint.mjs` no longer pre-checks `## Definition of Done (DoD)`
  checkboxes (audit fix #76)

### Milestone 2: Resumable controller — pending

- Durable scheduler that owns `ObjectiveRun` state across process loss
  via SQLite leases + heartbeat (extends `cli/task-ledger.mjs` to the
  objective level)
- Recovery: on restart, expire orphan leases and re-queue the affected
  phases
- Bounded retries + replans with explicit budget consumption
- `bizar status`, `bizar explain-run <id>`, `bizar pause/resume/cancel`,
  `bizar export` for objective-level observability
- Hierarchical budgets (objective / phase / task / agent / model) with
  reservation, commit, refund primitives — extends
  `cli/cost-gate.mjs`

### Milestone 3: Independent verification — pending

- Immutable `EvidenceBundle` records with freshness invalidation (the
  ledger is append-only; the selector refuses evidence older than the
  configured freshness window)
- Capability-segregated authority: verifier agents get `Read` only;
  integrator agents get write scope only for paths in the merge queue;
  worker / planner / research roles are tagged through a
  `BIZAR_AGENT_ROLE` env var enforced in `permission-request.mjs`
- Long-horizon benchmark tasks that drive a full multi-phase objective
  end-to-end and assert every transition is backed by fresh evidence
- Adversarial benchmark: a worker that proposes a fabricated evidence
  row MUST NOT advance the objective

### Milestone 4: Production operations — pending

- Unified traces, metrics, SLOs, redaction for every objective + worker
  + integration event
- Chaos testing framework (`scripts/__tests__/chaos.test.mjs`): inject
  crash-during-resume / duplicate-event / out-of-order-event /
  expired-lease / corrupt-evidence-row faults; assert scheduler
  converges to a valid terminal state
- Release provenance: SBOM (CycloneDX), minisign signature,
  provenance attestation per tarball; `KNOWN_GOOD_RELEASES` pin in
  `cli/commands/install.mjs`
- Efficiency benchmarks: single-agent vs multi-agent, sequential vs
  parallel DAG, model tier, worktree overhead vs conflict-resolution
  time saved
- Seven-day canary with no unresolved P0/P1 autonomy incidents before
  declaring Milestone 4 closed

The current contract does not yet enforce the Milestone 2–4 deliverables.
Drift on those is tracked in `PROGRESS.md` under "In Progress —
Production-autonomy audit implementation" until each lands.
