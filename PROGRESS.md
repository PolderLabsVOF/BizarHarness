# PROGRESS.md — Cross-Session State

> Canonical current-work record. Update before and after implementation.


## In Progress — F-121 Fix Broken UserPromptSubmit Hook Imports

**Objective:** Fix broken relative imports in `control-inbox.mjs` and
`worker-suggest.mjs` that fail with `ERR_MODULE_NOT_FOUND` after installation
when the repo source lives at a non-default path.

**Baseline:** `node /home/drb0rk/.claude/hooks/control-inbox.mjs < /dev/null` exits 1
with `ERR_MODULE_NOT_FOUND` because `../../cli/control-store.mjs` resolves to
`/home/drb0rk/cli/` which does not exist.

**Implementation plan:**

1. Replace the hardcoded `../../cli/*.mjs` import with
   `import.meta.url` + `dirname` + `dynamic import()` so resolution is
   relative to the script's own location.
2. Use lazy dynamic import inside the stdin handler to avoid top-level-await
   issues in the transitive dependency chain
   (`control-store.mjs` → `task-ledger.mjs` → `better-sqlite3`).
3. Add regression tests that spawn the hook binary and assert `ERR_MODULE_NOT_FOUND`
   does not appear in stderr.

**Status:**
- Hook source files fixed in repo root and worktree.
- Regression tests added and passing (6/6).
- Version bump and CHANGELOG update pending.

**Blockers:** None.

## Complete — F-120 OpenKan Control Plane Integration

**Objective:** Expose Bizar agents, durable tasks, Claude Code sessions, and
cross-agent messages through OpenKan without restoring the retired Bizar web
dashboard or memory subsystem.

**Implementation commit:** `8f606ff`

### Baseline

- `make check`: passed before implementation.
- `make e2e`: 11/11 passed after the F-119 push.
- Bizar exposes durable SQLite task coordination and guarded Claude Code
  process wrappers, but no stable machine-readable control-plane command.
- Claude Code 2.1.207 exposes background-session listing and background
  start/resume operations; it does not document a standalone external
  live-process messaging socket.
- OpenKan 0.2.1 exposes a local HTTP/SSE board, task UI, and OpenCode session
  integration, but no Bizar adapter or WebSocket collaboration surface.

### Implementation plan

1. Add a machine-readable `bizar control` boundary for agents, tasks, sessions,
   session lifecycle operations, and a durable atomic message inbox.
2. Inject queued messages through supported Claude Code `SessionStart` and
   `UserPromptSubmit` hooks instead of mutating live process internals.
3. Add an OpenKan Bizar adapter with REST commands and a WebSocket snapshot/event
   channel, keeping the repositories decoupled through the CLI contract.
4. Add an OpenKan Bizar workspace for task, message, session, and agent
   management, plus configuration and capability/error states.
5. Lock behavior with unit/integration tests and run both repositories' full
   verification gates, including Bizar E2E and OpenKan browser/API smoke tests.

### Stop condition

F-120 may pass only when OpenKan can discover Bizar agents, list and mutate
Bizar tasks, list/start/message/stop locally spawned Claude Code sessions,
deliver queued messages at supported Claude Code hook boundaries, and receive
live Bizar snapshots over WebSocket, with both repositories' full test suites
green.

### Implementation status

- Added `bizar control` JSON commands for agent, feature/progress, durable task,
  integration queue, Claude Code session, and message snapshots.
- Added atomic file-per-message queueing and exactly-once hook claims at
  `SessionStart` and `UserPromptSubmit`.
- Added task cancellation and safe stop support limited to Claude-reported live
  session PIDs.
- OpenKan commit `0ef6c76` adds the CLI adapter, validated REST mutations,
  loopback WebSocket snapshots/commands, settings, the Bizar workspace, and a
  real cross-repository E2E script.
- OpenKan: 346 tests passed; sanity check passed; cross-repository E2E passed
  5/5; browser verification rendered 16 agents, 41 features, sessions, tasks,
  and messages without an error overlay; npm audit reports zero vulnerabilities.
- Bizar: 298 SDK and 307 Node tests passed; targeted control/task tests passed
  11/11; E2E passed 13/13; architecture passed 5/5; clean-state passed 5/5;
  TypeScript check passed; audit scored 10.0/10.0; eval gate and VCR passed
  41/41.

### Blockers

None.

## Complete — F-119 Mandatory Agent and Documentation Grounding

**Objective:** Ensure every primary request enters the Bizar agent pipeline and
every shipped agent consults current official documentation instead of guessing
or using trial-and-error for external APIs, libraries, CLIs, and configuration.

**Implementation commit:** `9dd7ec4`

### Baseline

- `make check`: passed before implementation.
- `worker-suggest.mjs` emits no routing context when no worker pattern matches,
  so the primary session can bypass Bizar agents.
- Three shipped agents (`oscar`, `janet`, and `linda`) do not have `WebSearch`
  in their tool allowlist.
- The shared baseline recommends official documentation but does not require a
  search before version-sensitive external work.

### Implementation plan

1. Turn the prompt-routing hook into an always-on Bizar delegation policy while
   preserving specialized worker suggestions.
2. Inject the documentation-grounding contract at every subagent start.
3. Give every shipped agent `WebSearch` access and strengthen the shared
   baseline against guess-and-try integration work.
4. Extend agent, provisioner, hook, and E2E checks so policy drift fails tests.
5. Synchronize architecture/state documentation and run the full harness gates.

### Stop condition

F-119 may pass only when every non-empty primary prompt receives mandatory Bizar
delegation context, every subagent receives official-documentation grounding,
all shipped agents expose `WebSearch`, and regression plus full harness gates
pass.

### Implementation status

- `worker-suggest.mjs` now emits mandatory `@mike` routing context for every
  non-empty prompt, including unmatched prompts and dispatcher failures.
- A new all-agent `SubagentStart` hook requires `WebSearch` plus `WebFetch`
  against current official documentation before external integration work.
- All 16 shipped agents reference the shared baseline and expose `WebSearch`;
  the architecture gate now verifies both properties.
- Project settings, generated settings, validation, session-start briefing,
  E2E coverage, architecture docs, and DEC-014 are synchronized.
- Targeted hook tests pass 18/18; provisioner tests pass 11/11;
  `make check-arch` passes 5/5; `make check` passes.
- `make test`: 298 SDK tests and 300 Node/CLI/hook/script tests passed.
- `make e2e`: 11/11 checks passed.
- `make clean-check`: 5/5 dimensions passed.
- `make audit`: 10.0/10.0.
- `make eval-gate`: 40/40 features passed.
- `make vcr`: 40/40 = 1.000.

### Blockers

None.

### Next steps

No F-119 work remains. Select the next `not_started` feature before further
product changes.

## Complete — v10.9.0 Release

**Objective:** Publish the completed core-harness rebuild, repository cleanup,
and collision-free parallel execution work as GitHub release `v10.9.0`.

### Release contents

- Root package, SDK package, and SDK runtime version metadata are synchronized
  at `10.9.0`.
- `CHANGELOG.md` contains dated notes for the retained-core rebuild, repository
  cleanup, and collision-free agent collaboration.
- The release tarball contains 263 files and reports version `10.9.0`.

### Verification

- `make verify-removed-surfaces`: passed.
- `make check-arch`: 4/4 rules passed; 40 thinking skills verified.
- `make test`: 298 SDK tests and 295 Node/CLI/hook/script tests passed.
- `make e2e`: 10/10 checks passed.
- `make clean-check`: 5/5 dimensions passed.
- `make check`: passed.
- `make verify-repo-structure`: passed.
- `npm pack --dry-run`: 263 files, 460,308 bytes packed, 1,430,715 bytes
  unpacked.

### Stop condition

The verified release commit is the source of remote tag `v10.9.0` and the
published GitHub release.

## Complete — F-118 Collision-Free Parallel Execution

**Objective:** Let multiple Claude Code agents collaborate without sharing an
editable checkout, racing task claims, or integrating changes concurrently.

**Implementation commits:** `10b5f0f`, `3d9e23b`, `c8572b8`, `26bdfc3`,
`b5b3aef`

### Baseline

- `make check`: passed before implementation.
- No feature was active before F-118.
- The current `/team` protocol relies on manually disjoint scopes.
- Editing agents do not declare permanent worktree isolation.
- `feature_list.json` claims are feature-specific and do not model a general
  dependency graph, workspace lease, path ownership, or integration queue.

### Implementation plan

1. Make worktree isolation the default for code-writing subagents, configure
   worktrees to branch from the current `HEAD`, bootstrap shared dependencies
   safely, and verify the policy mechanically.
2. Add a SQLite-backed task DAG with atomic dependency-aware claims, expiring
   leases, worktree ownership, conservative path-scope collision detection, and
   a PreToolUse edit guard.
3. Add a serialized integration queue that accepts verified task commits,
   permits one active integrator at a time, and routes failed integration back
   to the owning task without performing unapproved Git publication actions.
4. Document the comparative harness research and retained design boundaries.
5. Run targeted regression tests, then `make check`, `make test`, `make e2e`,
   `make check-arch`, `make clean-check`, `make audit`, and `make eval-gate`.

### Worktree isolation status

- Added behavior-locking tests for isolated editing agents, `HEAD`-based
  worktrees, bootstrap hook registration, and dependency linking from a real
  linked Git worktree.
- All ordinary code-writing subagents now declare `isolation: worktree`; the IT
  lead remains the intentional non-isolated integration owner.
- Worktree bootstrap now recognizes linked-worktree `.git` files, resolves the
  main checkout correctly, and shares only `node_modules`. Mutable build output
  and runtime state remain isolated.
- Project settings and the provisioner configure `worktree.baseRef: head` and a
  bounded cleanup period.
- Targeted worktree policy tests pass 3/3; shared agent checks and hook tests
  also pass.

### Durable task DAG status

- Added a Git-common SQLite task database, so main and linked worktrees share
  one coordination state without a daemon or network service.
- Task creation records dependencies, exact/file-or-directory scopes,
  priorities, artifacts, evidence, attempts, owners, workspaces, sessions, and
  expiring leases.
- Claims use immediate SQLite transactions; dependency-blocked and overlapping
  path claims fail atomically.
- Expired leases return tasks and scopes to the ready pool, and active owners
  can renew through `bizar task heartbeat`.
- The PreToolUse path guard denies out-of-scope edits from a task worktree and
  same-path edits from the main or sibling checkout.
- Targeted task/hook/CLI tests pass 9/9, including a real two-process scope
  claim race; `make check` passes.

### Serialized integration queue status

- Completed task commits can be enqueued with base reference, verification
  command, submitter, and evidence metadata.
- Immediate transactions plus a partial unique index permit only one active
  integration owner across processes; pending work remains priority/FIFO
  ordered.
- Passing integration marks the task integrated and releases its path
  reservation.
- Failed integration returns the task to its original owner with a structured
  blocker and bounded repair lease.
- A queued item cannot reactivate if an overlapping scope was claimed after its
  reservation expired.
- The queue intentionally records and serializes integration without running
  unapproved merge, rebase, push, or publication actions.
- Targeted task, queue, hook, and CLI tests pass 14/14; `make check` passes.

### Stop condition

F-118 may move to `passing` only when two independent task workspaces can hold
non-overlapping claims concurrently, overlapping scopes are rejected, blocked
dependencies cannot be claimed, expired leases are recoverable, and the
integration queue proves single-consumer ordering.

### Explicit exclusions

- No dashboard, note vault, semantic memory, persistent web service, or
  WebSocket transport.
- No automatic merge, rebase, push, or publication bypassing existing human
  approval policy.
- No replacement of Claude Code's native Agent, worktree, or SendMessage
  surfaces.

### Blockers

OMX Ralplan preflight returned `unsupported_documented_leader_proof`, so the
unsupported consensus/delegation lane is not being used. Direct implementation
can proceed safely.

### Next steps

No F-118 work remains. Select the next `not_started` feature before making
further product changes.

### Final verification

- `make check`: passed.
- `make test`: 298 SDK tests and 295 Node/CLI/hook/script tests passed.
- `make e2e`: 10/10 checks passed.
- `make check-arch`: 4/4 rules passed; 40 thinking skills verified.
- `make clean-check`: 5/5 dimensions passed.
- `make audit`: 10.0/10.0.
- `make eval-gate`: 39/39 features passed.
- `make verify-repo-structure`: passed.
- `npm pack --dry-run`: 263 files, 460,308 bytes packed, 1,430,715 bytes
  unpacked.

### Remaining risks

- The integration queue intentionally requires an explicit pass/fail decision;
  stale integration supervision is a later roadmap item.
- Remote/WebSocket transport, trajectory replay, checkpoint rollback, and
  OpenTelemetry remain out of scope and are documented in the research
  roadmap.

## Complete — F-117 Repository Structure Cleanup

**Objective:** Remove confirmed obsolete files, abandoned fixtures, generated
residue, and package-boundary leaks while preserving every retained Claude Code
harness behavior.

**Implementation commit:** `c42b04e` (`refactor: remove obsolete repository
residue`)

### Behavior lock

- `make check`: passed before cleanup.
- `make test`: 298 SDK tests and 267 Node/CLI/hook/script tests passed.
- `npm pack --dry-run`: baseline captured at 427 files; the package currently
  leaks 29 test files and one stale literal-`${HOME}` memory path.

### Regression guard status

- Added unit coverage for forbidden tracked roots and publish-manifest leaks.
- Repository/package structure tests pass 5/5 and the live verifier reports a
  clean tracked tree, publication boundary, and version state.
- Container-verifier contract tests pass 3/3, including the workspace-bootstrap
  ordering regression found by the first live Podman run.

### Completed cleanup passes

- Dead tracked paths removed; the structure verifier reports no obsolete tracked
  roots.
- Package allowlist narrowed from 427 files (690,269 bytes) to 259 files
  (449,561 bytes): zero tests, duplicate `.claude/skills`, or literal-`${HOME}`
  state paths remain in the tarball.
- Removed 448 MB of abandoned local fixture/package/cache residue and rewrote
  `.gitignore` around current Claude Code, Bizar runtime, research, build, and
  credential boundaries.
- Removed the broken external skill-cache symlink and committed SDK runtime
  manifests; synchronized root/SDK version metadata at `10.7.2` and made the
  provisioner read its version from the package manifest.
- Deleted the broken overnight queue, unwired post-merge audit, and superseded
  trace writer; repaired the retained container verifier to run current strict
  gates without swallowing failures.
- Removed machine-specific Bun paths from Make/test scripts and replaced the old
  name-specific cleanup target with the executable structure/package verifier.

### Retained-script regression status

- Added a container-verifier contract covering shell syntax, workspace
  bootstrap ordering, and the current strict `make` gates.
- Live Podman verification passes from a clean `node:22-bookworm-slim`
  container: 298 SDK tests, 276 Node tests, 10/10 E2E checks, 4/4 architecture
  rules, and the repository/package structure verifier.

### Final verification

- `make check`: passed.
- `make test`: 298 SDK tests and 276 Node/CLI/hook/script tests passed.
- `make e2e`: 10/10 checks passed.
- `make check-arch`: 4/4 rules passed.
- `make verify-repo-structure`: passed.
- `make clean-check`: 5/5 dimensions passed.
- `make audit`: 10.0/10.0.
- `make eval-gate`: 38 passing, 0 failing.
- `make vcr`: 38/38 = 1.000.
- `npm pack --dry-run`: 259 files, 449,561 bytes, 1,386,851 bytes
  unpacked; no test source, duplicate skills, local state, or memory residue.

### Cleanup plan

1. Delete tracked dead paths with no retained references: the `fresh901` install
   fixture, retired `bizar-plugins` registry, committed `.config` hook log,
   project-local Serena config, obsolete Docker ignore file, root Skills CLI
   lock, retired eval fixtures, and retired schedule templates.
2. Remove local generated residue proven unrelated to source: literal `${HOME}`
   trees, package tarballs, duplicate Skills CLI caches, old resume logs,
   abandoned fixture dependencies, stale package-local runtime data, and
   already-retired template remnants.
3. Rewrite ignore/package boundaries around the current Claude Code harness;
   eliminate Cline/Vite/dashboard/memory-era rules and prevent tests, local
   state, duplicate skill mirrors, and source-only tooling from entering the
   published package.
4. Add executable repository/package structure regression checks before the
   deletion pass, then run targeted validation after each smell category.
5. Synchronize architecture, packaging, and cleanup documentation and close the
   feature only after the full test, E2E, clean-state, audit, eval, and VCR gates.

### Fallback review

- Production masking fallbacks: none found in the cleanup scope.
- Masking verification fallbacks were found in the old container script; its
  lenient install/test/validation branches were replaced with explicit failure.
- Remaining `catch {}` findings are confined to test cleanup or fixtures that
  detect swallowed errors; teardown is a grounded best-effort cleanup path.
- Documentation mentioning model fallbacks is decision guidance, not an
  alternate runtime path.
- Escalation: none required; no ambiguous cross-layer fallback is being changed.

### Explicit exclusions

- `research/` is user-owned comparative research and remains untouched.
- Root `node_modules/`, `.omx/`, and current bounded `.bizar/` operational state
  remain local runtime material, not cleanup targets during the active session.
- No retained CLI, SDK, MCP, hook, agent, command, or skill behavior is in scope
  for redesign.

### Blockers

None.

### Next steps

- No cleanup work remains. Select the next `not_started` feature before making
  further product changes.
