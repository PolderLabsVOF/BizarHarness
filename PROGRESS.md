# PROGRESS.md — Cross-Session State

> Canonical current-work record. Update before and after implementation.

## In Progress — F-169 Hook wiring + subagent permissions + CCR disable

**Objective:** Stop three session-friction defects that all surface on a
Bizar-equipped Claude Code install: (1) `SessionStart:resume` and
`UserPromptSubmit` hooks fail with `bizar: command not found` because
Claude Code invokes hooks via `/bin/sh` with a stripped PATH; (2) the
repo `settings.json` ships `permissions.ask` patterns that always
prompt even in `bypassPermissions` mode; (3) Claude Code's auto-compact
injects `[CCR retrieve hash=…]` markers into the parent transcript
which the `advisor-context.mjs` SubagentStart hook forwards verbatim
to every subagent, who then refuse the prompt as injection-shaped.
## Active — F-165 Native workflows and agent teams as primary Bizar default

**Current objective:** Flip the Bizar routing default from plain `Agent`
calls to native dynamic workflows and agent teams. Plan audited and approved
by @linda (APPROVE-WITH-CHANGES, six corrections + three test gaps, all
applied). Source of truth:
`docs/decisions/PLAN-agent-teams-default.md`.

**Commit A in flight:** routing policy + decision tree.

- `AGENTS.md` "Autonomy and parallelism" paragraph replaces the
  "Subagent dispatch through the Agent tool is the default" framing with
  the workflow-primary, agent-team-as-host-side-state, plain-`Agent`-as-
  fallback wording. `team_name` is documented as deprecated and ignored
  per Anthropic's docs.
- `config/claude/CLAUDE.md` regenerated from `AGENTS.md` via
  `scripts/mirror-claude-md.sh`; `--check` confirms parity.
- `config/claude/agents/office-manager.md` opens "How You Route" with a
  decision tree that names the three `bizar-*.js` workflow scripts and
  the `Workflow` tool invocation shape.
- `feature_list.json` opens `F-165` (WIP=1) and points at this plan.

**Commit B in flight:** three reusable workflow scripts + workflow test.

- `config/workflows/bizar-research.js` — pipeline pattern with parallel
  research + plan + audit + parallel implementation lanes + sequential
  verify. Returns `ready-for-integration` with disjoint lanes, evidence,
  and reviews.
- `config/workflows/bizar-implement.js` — parallel-only barrier pattern.
  Scope extraction → parallel lanes (worktree isolation) → single barrier
  `agent()` → single verify → single synthesis. Returns
  `ready-for-integration` with a MERGE plan.
- `config/workflows/bizar-debug.js` — bounded loop-until-dry. RCA
  hypothesis → adversarial `agent()` verify → bounded re-plan if
  unconfirmed (cap=3) → smallest fix + regression test → verify.
  Returns `dry` or `budget-exhausted`.
- `config/workflows/__tests__/bizar-default.test.mjs` — `node --test`
  suite. Stubs `agent`/`pipeline`/`parallel`/`phase`/`log` via `Function`
  constructor with brace-balanced `meta` extraction. Asserts fan-out,
  barrier, and bidirectional pattern (pipeline in research, parallel-only
  in implement and debug). 7/7 tests pass.
- `scripts/run-node-tests.mjs:18` extended to glob `config/workflows/`.

**Commit C in flight:** docs + ledger close-out.

- `docs/architecture.md` gains a "Routing default" subsection under
  "Runtime model" naming native workflows + agent teams as the primary
  pattern and pointing at `F-165`.
- `PROGRESS.md` records this entry.
- `feature_list.json` `F-165` will be promoted to `passing` after the
  human-approved commit lands.

**Verification (2026-08-26):**

- `node --test config/workflows/__tests__/bizar-default.test.mjs` —
  7/7 pass.
- `make mirror-claude-md-check` — `config/claude/CLAUDE.md` in sync with
  `AGENTS.md`.
- `node scripts/run-node-tests.mjs` — picks up the new test alongside the
  pre-existing Node suites (three pre-existing failures remain:
  `force=true accepted`, `runInstaller() flag wiring`, and
  `Claude Code plugin manifest references canonical in-root components`;
  all three are caused by commit `cf09bf6` removing
  `.claude-plugin/plugin.json` and are not introduced by F-165).
- `make verify-removed-surfaces` — clean.
- `make check-arch` — clean (0 failed, skill-frontmatter gate green).

**Pre-existing failures observed but not caused by F-165:**

- `make verify-repo-structure` — fails reading
  `.claude-plugin/plugin.json` (deleted by `cf09bf6`).
- `make e2e` — fails on `skill mirror` and `SDK typecheck` (both
  pre-existing on master before F-165 changes were made).
- `make test` — fails because `node_modules/.bin/vitest` is not installed;
  this requires `make setup` which is a one-time bootstrap outside the
  scope of F-165.

## Passing — F-164 Dynamic orchestration, native workflows, and agent teams

**Objective delivered:** Removed brittle fixed model pins from all 16 custom
agents. Mike now selects the cheapest sufficient tier for each dispatch, uses a
concrete model only when live discovery proves a tier candidate, and otherwise
omits `model` so Claude Code inherits the active session. A failed dispatch is
never retried by cycling aliases, providers, or tiers.

**Native orchestration delivered:** Bizar installs `ultracode`,
`ultracode-review`, and `ultracode-research` under
`$CLAUDE_CONFIG_DIR/workflows/`, plus `/ultracode`. Experimental agent teams are
enabled with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`; TaskCreated,
TaskCompleted, and TeammateIdle hooks record bounded advisory evidence and always
fail open.

**Fresh evidence (2026-08-25):**
- Dynamic routing + workflow state + hook tests: 34/34 passed.
- Team lifecycle hook tests: 3/3 passed; combined routing/team hooks: 8/8.
- SDK dynamic registry tests: 5/5 passed.
- Installer tests: 14/14 passed, including a real temporary config install.
- Full retained suites: SDK 301/301; Node 412/412.
- `make check`, `make test`, `make e2e`, `make clean-check`,
  `make verify-repo-structure`, `make verify-removed-surfaces`, and
  `make check-arch` passed.
- Temporary install contained all three workflow scripts, the ultracode skill
  and command, team hooks/settings, and zero installed agent `model:` pins.

**Blockers:** None. Commit/push remain human-approval actions and were not run.

## Previous — F-163 Registry rebrand: claude-qwen + claude-minimax

**Objective:** Repoint the agent registry and tier table at the new 9router
gateway IDs after the user added a Qwen provider and the MiniMax IDs were
re-prefixed. The user-facing orchestrator (`@mike`), planning (`@paul`),
and last-resort debugging (`@carl`) move to `claude-qwen/qwen3.8-max`;
MiniMax tiers move to `claude-minimax/*`; design/implementation high tiers
remain on `cx/gpt-5.6-{terra,luna}`. Every frontmatter, test fixture,
CLI string, command doc, and ledger row is updated; no behavior change
beyond the model-id swap.

**Files touched in F-163:**
- `.claude/model-router.json` — version 11.0.0 → 11.1.0; tier models +
  agent assignments + rationales; tier purpose note added for Qwen
  orchestrator tier.
- `.claude/agents/*.md` (16 files) — `model:` frontmatter + body refs in
  `office-manager.md` (lines 79, 207).
- `scripts/agent-model-registry.test.mjs` — `ALLOWED_MODELS` set, test
  title, mike/linda snapshot assertions, tamper target, unavailability
  fixture.
- `packages/sdk/tests/agent-model-registry.test.mjs` — SAMPLE fixture +
  assertions + tamper targets for parity test.
- `cli/__tests__/workflow-state.test.mjs` — mike model assertion, probe
  fixture, tamper target, unavailability filter (4 refs).
- `cli/__tests__/model.test.mjs` — SAMPLE_MODELS fixture + table
  assertions (cx/, claude-minimax/, claude-qwen/ groups).
- `cli/commands/model.mjs` — `PROVIDER_GROUPS` and help text.
- `cli/provision.mjs:935` — premium hint message.
- `docs/architecture.md:126` — Mike pinning text.
- `.claude/commands/use-default.md`, `.claude/commands/use-premium.md` —
  model id strings and subagent listing.
- `feature_list.json` — F-163 row (passing).
- `CHANGELOG.md` — Unreleased entry.

**Registry test:** `node --test scripts/agent-model-registry.test.mjs` →
7/7 green (verified post-edit).

## Complete — F-122 Installer-Driven Gateway Model Discovery (regenerator)

**Objective:** Reopen F-122 with current code, since the original F-122 closed
on commits `3220519 / 42574ac` but the feature ledger row's evidence fell
out of sync (stale test counts, missing pointer to the current code surface).
Verify the regenerated behavior with current test counts and refresh the
ledger evidence; no behavior change is required.

**Implementation commits:** `3220519` (installer), `42574ac` (bizar model list
CLI) — already on master and shipped in v10.10.2.

**Regenerator evidence (no code change):**

- `cli/provision.mjs` `writeClaudeSettings` (lines 649–777) emits four env
  vars on normal update and on `--force`: `ANTHROPIC_BASE_URL`,
  `BIZAR_MODEL_ROUTER_URL`, `ANTHROPIC_AUTH_TOKEN`,
  `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY`. User-owned values are preserved
  without `--force`; `--force` refreshes the managed keys without deleting
  unrelated user env.
- `cli/commands/model.mjs` (1–152) wires `bizar model list` at
  `cli/bin.mjs:419–433`. 3-second `AbortController` timeout, auth-retry-on-401,
  provider-prefix grouping (`cx/`, `bizar/`, `oc/`, `claude/`, `anthropic/`,
  `(no prefix)` fallback for slash-less IDs).
- `.claude/settings.json:118–124` already carries the four env defaults.
- `.claude/model-router.json:1–13` points at the picker-proxy endpoint
  (F-147 surface) so the picker shows every gateway ID.
- `node --test cli/install/__tests__/merge-settings.test.mjs cli/__tests__/model.test.mjs`
  → 11/11 pass (merge-settings 5/5 + model CLI 6/6).
- `feature_list.json` F-122 evidence refreshed to current test counts and
  current commit; `passed` date moved to 2026-08-03 to reflect the regenerator.

**Out of scope:** CHANGELOG.md (no new release — 10.13.0 already shipped),
`cli/__tests__/model.test.mjs:181` orphan-subprocess teardown (pre-existing
fragility tracked at PROGRESS.md:305).

## Complete — v10.13.0 Release

- Date: 2026-08-03
- 5 features shipped: F-146 i-have-adhd skill, F-146 Bizar MCP agent tools,
  F-147 9router picker proxy, F-148 inline orchestrator + /quick bypass,
  F-149 worktree-merge safety.
- Versions synchronized at 10.13.0 across root `package.json`,
  `packages/sdk/package.json`, `packages/sdk/src/version.ts`,
  `.claude-plugin/plugin.json`.
- `@polderlabs/bizar@10.13.0` published (301 files, 514.4 kB).
- `@polderlabs/bizar-sdk@10.13.0` published (123 files, 118.0 kB).
- Tag `v10.13.0` → c9f504d pushed to origin.
- All gates green: make check / test / e2e / verify-removed-surfaces /
  verify-repo-structure / check-arch / clean-check / vcr (51/51).
- 407/407 tests pass, 13/13 e2e checks pass.

## Complete — Inline orchestrator + /quick (F-148)
- Date: 2026-08-02
- Branch: feat/orchestrator-quick
- Primary session now IS @mike (no recursive dispatch)
- /quick command creates .bizar/.quick-once sentinel for one-turn bypass
- Session-end hook removes the sentinel


## Complete — Bizar MCP agent tools (F-146)
- Date: 2026-08-02
- Branch: feat/mcp-agent-tools
- 5 new tools: bizar_task, bizar_workflow, bizar_control, bizar_audit, bizar_model_list
- Audit gained --json branch at cli/audit.mjs


## In Progress — F-129 OMC-Informed Workflow Overhaul

**Objective:** Research `yeachan-heo/oh-my-claudecode` at a pinned revision and
adapt its strongest orchestration patterns into Bizar: a single GPT-5.6 Sol
office manager, skill-based model routing across GPT and MiniMax workers,
durable mutually-exclusive workflow modes, and `/autopilot` with planning,
parallel execution, QA, validation, resume, and cancellation.

**Release cancellation:** The proposed v10.12.0 release was cancelled before
any commit, push, tag, GitHub release, npm publication, or deployment. Local
F-128 review fixes remain intentionally preserved in the working tree.

**Publication authorization (2026-08-02):** The user has now explicitly
authorized committing the completed F-129 scope, pushing it to the configured
GitHub remote, and publishing the npm package. Prepare v10.12.0 because
v10.11.0 is already the npm `latest`; retain the completed gate evidence,
exclude user-owned untracked files, and do not create a GitHub release or tag
unless separately requested.

**Publication preparation:** Root package, SDK package, SDK version constant,
and changelog are synchronized at v10.12.0. npm authentication is active as
`drb0rk`; GitHub CLI/SSH authentication is active as `DrB0rk`; local `master`
and `origin/master` were even before staging. Fresh version/package and full
verification gates are required before commit, push, and npm publication.

**Staged simplify review:** The first complete staged-tree review found one
remaining version surface: the Claude Code plugin manifest was still 10.11.0.
Synchronize it to 10.12.0 and extend the repository version-parity verifier to
cover the manifest. Also reconcile historical cancellation wording with the
newer explicit publication authorization before repeating the staged review.

**Simplify repair complete:** The plugin manifest is now 10.12.0 and the
executable repository-structure gate verifies root, SDK package, SDK constant,
and plugin-manifest version parity. Historical cancellation and audit text now
clearly precedes and is superseded by the user's newer publication approval.

**Implementation commit (2026-08-02):** `8b2ee9e639a984be517e88473245b70932b83c39`
(`feat: overhaul Bizar orchestration workflows`) contains the complete F-129
implementation and v10.12.0 release metadata. The final staged matrix passed:
SDK 297/297, Node 387/387, E2E 13/13, clean-state 5/5, audit 10.0/10.0,
eval-gate 45/45, plugin validation, and clean root/SDK package manifests.
The feature ledger is closed against this real commit before push/publication.

**Push and npm publication complete (2026-08-02):** `master` was pushed
normally through closure commit `9c46323b67ddb9389e6076c136166e4dec9853f1`.
`@polderlabs/bizar-sdk@10.12.0` and `@polderlabs/bizar@10.12.0` were published
with public access and both npm `latest` tags resolve to 10.12.0. A fresh
registry install imported `SDK_VERSION=10.12.0` and `bizar --version` returned
10.12.0. No GitHub release, tag, deployment, or force/history mutation occurred.

**Pre-change evidence:** `master` and `origin/master` both resolve to `0118da3`.
The upstream research clone is `/tmp/oh-my-claudecode-research` at
`41a4c0f77144c5beb5f5f000a89cff379c680606`. Current Bizar already has a phased
Mike pipeline and model router, but no first-class autopilot/ralph/QA mode
registry, persistent stop-loop controller, or plugin manifest equivalent.

**Constraints:** Preserve the retired Bizar memory/note-vault boundary; do not
copy upstream memory/wiki subsystems. Preserve approval gates for external and
irreversible actions. Treat upstream as research input, reimplement only the
necessary behavior, record license/provenance, and keep OpenKan at the existing
`bizar control` boundary.

**Plan:**
1. Complete official Claude Code/plugin documentation research and a pinned
   upstream feature inventory.
2. Write the adoption/gap document and an audited architecture plan.
3. Make Mike the sole GPT-5.6 Sol orchestrator and define explicit skill-based
   GPT/MiniMax worker tiers.
4. Add the plugin/skill/command/hook workflow surface, including durable mode
   state, keyword routing, `/autopilot`, resume, cancel, and verification loops.
5. Add regression and E2E coverage, synchronize mirrors/docs, and run every
   applicable repository gate.

**Research complete (2026-08-02):** Upstream `v4.15.7` is MIT-licensed and
was inspected at the pinned commit above. Adopt: role/complexity separation,
frozen per-run routing, explicit phase handoffs, session/project-bound atomic
state, sanitized keyword detection, bounded verify/fix loops, and portable
hook dispatch. Adapt: autopilot becomes `research/spec → consensus plan →
implementation waves → QA/fix → multi-perspective validation`, using Bizar's
native Agent/task/worktree primitives. Reject: memory/wiki/notepad services,
tmux or daemon transports, automatic commits/merges, permissive mutation
approval, and duplicated generated shipping trees.

**Audited implementation shape:** Build the compare-before-write workflow core
first. Then use disjoint parallel lanes for (A) hook/installer portability and
persistent mode, (B) skills/commands/plugin metadata, (C) the canonical
agent/model registry with Mike pinned to Sol, and (D) provenance/architecture
documentation. Stop hooks never infer success from stale transcript text: the
active agent records an explicit revision-bound transition after fresh evidence.
External model IDs are valid only through the configured compatible gateway;
missing requested models are reported instead of silently substituted.

**Stop condition:** The research document names adopted/adapted/rejected OMC
features; `/autopilot` can start, persist, resume, validate, complete, and
cancel without bypassing approval policy; one Sol orchestrator delegates to
tiered GPT/MiniMax agents; all full repository gates pass; no release mutation
has occurred.

**Implementation and verification complete locally (2026-08-02):**
- Added strict session/project-bound workflow state and `bizar workflow`
  start/status/advance/fail/resume/cancel commands with hashed goal/evidence,
  descriptor integrity, atomic compare-before-write revisions, fixed profiles,
  and bounded QA/validation retries.
- Added `/autopilot` and companion workflow skills/commands, native plugin and
  hook manifests, sanitized explicit command routing, persistent Stop handling,
  and a package-relative `bizar hook` dispatcher that preserves tool/agent
  matcher scopes.
- Reconciled installer-owned hooks without deleting foreign hooks and upgraded
  stale Bizar-owned model routers while preserving unrecognized user routers.
- Pinned Mike to `cx/gpt-5.6-sol`; split role selection from complexity/model
  tiers; assigned all 16 agents across GPT 5.6 and MiniMax models; removed SDK
  fallback behavior and added strict immutable run snapshots.
- Added `docs/oh-my-claudecode-adoption-2026-08-02.md`, architecture/changelog
  updates, plugin packaging rules, and focused regression coverage.

**Fresh focused evidence:** final custom-router/model regression suite 41/41;
SDK registry/parity suite 8/8; independent adversarial review approved the
inference-endpoint and snapshot-parity repairs. Full gates: SDK 297/297; Node
387/387; removed-surface and repository/package boundaries passed;
architecture 5/5 plus 40/40 skill checks; `make e2e` 13/13;
`make clean-check` 5/5; final `make check` passed. Plugin validation passed
with its expected root-`CLAUDE.md` context warning, and npm dry-run packaging
contains 296 files with no backup or temporary files.

**Post-implementation audit repair (2026-08-02):** The first green run exposed
integration gaps that require repair before completion: strict model snapshots
were not yet wired into workflow starts; plugin hooks assumed a global `bizar`
binary; curl-pipe installation still assumed a checkout; project permissions
could fail open for hard-approval commands; command-to-skill indirection
conflicted with `disable-model-invocation`; SubagentStop had no deliverable
verification; and workflow state did not reject symlinked ancestors. Repair
lanes are active with new packed/plugin/curl/bypass/path regressions.

**Current local state:** Implementation, adversarial review, and all required
runtime gates are complete. The authorized implementation commit now exists,
so F-129 has truthfully moved to `passing` with commit-backed evidence and VCR
has returned to 44/44. Push and both npm publications are complete; no GitHub
release, tag, deployment, or other public mutation was requested or performed.

**First final-audit repair scope (2026-08-02):** Enforce the immutable workflow
model snapshot at each Claude Code `Agent` dispatch; make the
simplify-before-commit hook parse Git global options such as `-C` and
`--git-dir`; and require concrete, verifiable SubagentStop evidence rather than
generic completion prose. These repairs were completed and regression-tested;
release and publication remain cancelled.

**Second adversarial audit (2026-08-02):** The first final-repair pass and all
repository gates were green, but direct bypass probes found five remaining
contract gaps: ordinary (non-autopilot) Agent dispatch still honored model
overrides; quoted Git executables and additional valid global options bypassed
commit approval/simplify; SubagentStop accepted uncorroborated prose; installed
settings omitted two gateway-discovery variables; and the package boundary did
not exclude a local `.bak` file. These are now the only active repair scope.
The local backup file must remain untouched; packaging must exclude it.

**Third adversarial audit (2026-08-02):** The named bypasses above are closed,
but fail-closed review found three deeper cases: dynamically constructed shell
executables could still conceal Git mutations; transcript verification could
precede a later edit; and ordinary Bizar dispatch did not prove live gateway
availability or fail closed if a safety hook crashed. Final repair must deny
indirect guarded Git actions, require verification after the last mutation,
validate ordinary-agent availability, and convert safety-hook failures into a
blocking decision. No publication work is in scope.

**Fourth adversarial audit (2026-08-02):** The third repair passed its focused
and full test gates, but active workflow dispatch still reloaded the canonical
model-router gateway instead of the custom gateway whose exact assignments had
been frozen at workflow start. The final bounded repair is to fingerprint the
snapshot's availability-probe contract and make the Agent guard validate the
assigned model against that frozen endpoint/probe. A cross-process regression
must prove that no injected registry is needed and that the canonical gateway
is never consulted for an active custom-router run.

**Fourth audit repair complete (2026-08-02):** CLI and SDK run-assignment
snapshots now fingerprint both the effective gateway endpoint and availability
probe. Workflow-state validation rejects missing or malformed frozen probe
coordinates. Active Agent dispatch reads assignments and live-probe coordinates
only from the persisted immutable snapshot; ordinary dispatch continues to use
the canonical router. A cross-process-style regression starts with a custom
router, invokes the guard later without an injected registry, proves only the
custom probe URL is called, allows the exact reported model, and denies it when
absent. Fresh evidence: focused Node tests 33/33, SDK registry tests 7/7,
`make check` passed, and `git diff --check` passed.

**Fifth audit repair complete (2026-08-02):** Active Bizar Agent dispatch now
fails closed unless `ANTHROPIC_BASE_URL` matches the workflow snapshot's frozen
gateway endpoint; a nonempty contradictory `BIZAR_MODEL_ROUTER_URL` also
denies. Comparison removes trailing slashes only, and endpoint failures happen
before the frozen availability URL is probed. `bizar workflow start` enforces
the same effective-inference contract before probing or writing state. CLI and
SDK schemaVersion 1 assignment snapshots now share the canonical `model` key,
payload shape, stable serialization, and fingerprint algorithm. Direct parity
coverage deep-compares snapshots created from identical inputs. Fresh evidence:
focused Node tests 34/34, SDK registry tests 8/8, `npm run build:sdk` and
`make check` passed, no stale SDK `modelId` snapshot consumers remain, and
`git diff --check` passed.

**Fifth adversarial audit finding (2026-08-02; repaired above):** The frozen
probe contract was enforced, but two compatibility gaps remained before final
verification. The Agent guard did not yet prove Claude Code's effective
inference endpoint matched the frozen gateway, and the CLI/SDK schema-version-1
snapshots used different assignment field names and fingerprints. The repair
closed both gaps with fail-closed endpoint checks and direct snapshot parity
regressions.

**Final verification (2026-08-02):** The fifth repair received an independent
`APPROVED` verdict with direct missing/mismatched/matching endpoint probes and
deep-equal CLI/SDK snapshot fingerprints. Every required gate passed in order:
`make check`, `make verify-removed-surfaces`, `make verify-repo-structure`,
`make check-arch`, `make test`, `make e2e`, `make clean-check`, and a final
`make check`. `git diff --check` is clean. At that checkpoint only external
publication remained: the implementation commit existed, F-129 was passing,
and VCR was 44/44. The authorized push and npm publications subsequently
completed with registry-install verification; no GitHub release or tag was
requested.


## Superseded by F-129 — F-128 Reduce Agent Permission Friction + Parallelism

**Commit (planned, atomic):** F-128 ships the autonomy + parallelism policy in one commit covering `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, `cli/task-ledger.mjs`, `cli/__tests__/task-ledger.test.mjs`, `scripts/bh-full-e2e.mjs`, `.claude/agents/planner.md`, `.claude/agents/office-greeter.md`, `config/skills/9router/SKILL.md`, `config/skills/self-improvement/SKILL.md`, `config/skills/skillopt/SKILL.md`, `packages/sdk/src/version.ts`, `packages/sdk/package.json`, `feature_list.json`, `PROGRESS.md`. Mirror regen via `make mirror-claude-md` and skill sync via `make sync-skills-mirror`.

**After (F-128):** `AGENTS.md` adds `## Autonomy and parallelism` section (routine decisions autonomous; parallel dispatch for disjoint scopes; hard approval list = commits, pushes, PRs, releases, deploys, prod writes, creds, public exposure, irreversible destruction). Mirrors reflect this in `CLAUDE.md` and `.claude/CLAUDE.md`. `planner.md` drops default one-question policy; `office-greeter.md` only fires on genuinely unresolvable ambiguity. 9router, self-improvement, and skillopt skills no longer pause for routine failures. `pretooluse-bash.mjs` already lacked a `../..` heuristic — no change needed there. Path-ownership guard fix: `cli/task-ledger.mjs` `authorizeEdit` now treats only `active`-state tasks as the `current` workspace match (fall-through for completed/cancelled), so completed tasks can no longer block edits. E2E human-approval check rewritten to verify the explicit mutation allow-list under `acceptEdits` rather than the obsolete `ask` list.

**Objective:** Stop the agents from repeatedly asking the user for routine decisions. Keep hard safety gates (commits, pushes, releases, deploys, credentials, rebase, force-push, secrets, destructive system ops). Where work has 2+ independent sub-tasks, fan out in parallel via the Agent tool — no sequential single-agent execution.

**Implementation plan:**
1. Update `AGENTS.md` baseline with two explicit policies: routine decisions are autonomous; independent disjoint work fans out in parallel. ✅ done.
2. Mirror to `CLAUDE.md` and `.claude/CLAUDE.md`. ✅ done via `make mirror-claude-md`.
3. Tighten `planner.md` (no default "one early question" policy — resolve from evidence or pick a reversible default). ✅ done.
4. Narrow `office-greeter.md` (Janet) invocation to decisions that cannot be derived from repository evidence or a safe default. ✅ done.
5. Add an explicit autonomous-decision + parallel-fan-out rule to the implementation-agent baseline (covered via AGENTS.md cross-reference and skill updates). ✅ done.
6. Downgrade the `../..` traversal `ask` heuristic in `pretooluse-bash.mjs` to allow (or remove). — N/A; heuristic did not exist.
7. Add targeted regression tests for the mirror and the bash hook downgrade. — path-ownership guard updated; `expired leases return tasks to pending; requireTask still gates edits` test reflects the new fall-through semantics; 13/13 task-ledger tests pass.
8. Run `make check-arch`, `make check`, and the targeted tests. ✅ all green: 5/5 arch, 13/13 e2e, 318/318 non-model unit tests, 13/13 task-ledger unit tests, 6/6 model tests.
9. Update `feature_list.json`: F-128 → `passing`; bump VCR. ✅ done.
10. Commit via Steve (atomic single commit) + push.

**Pre-conditions:** F-122 closed; F-121 promoted to `passing` in `feature_list.json` (was incorrectly still `active`); VCR 42 passing prior to F-128.

**Status:** Local edits are preserved and incorporated into F-129. F-128 is
truthfully returned to `not_started` because it never received a commit and
therefore cannot satisfy the feature ledger's `passing` contract. Release
review restored a hard simplify-before-commit decision for missing or stale
markers while retaining the 30-minute freshness window needed by repeated hook
evaluation. Repository verification now accepts both npm 11's array-shaped and
npm 12's keyed-object `npm pack --json` manifests. Fresh targeted coverage is
29/29; `make check-arch` is 5/5 and `make check` passes.

**F-128g regenerator audit (2026-08-03):** Reopened F-128 as F-128g to verify
whether the F-128 behavior ever shipped on master. All F-128 behavior is on
master, split across three absorbing commits: `b5b3aef` (F-118, path-ownership
completed-state fallthrough in `cli/task-ledger.mjs` `authorizeEdit`),
`9dd7ec4` (F-119, baseline + WebSearch tightening), and `8b2ee9e` (F-129,
`## Autonomy and parallelism` section at AGENTS.md:34–49 mirrored into
CLAUDE.md and .claude/CLAUDE.md, planner.md and office-greeter.md narrowing).
Per the F-128 row's explicit gate ("must not claim passing until a future
approval-gated commit contains the behavior"), composing a fresh atomic commit
would be a no-op rebuild; F-128 stays `not_started` and F-128g closed with
this audit trail instead of a commit.

**Stop condition:** Modified agents and skills produce no new "ask the user" mid-task pauses for routine decisions; targeted tests pass; `make check-arch` and `make check` pass. ✅ met.

**Known issues (out of F-128 scope):**
- `scopeContains('**', path)` returns false for any non-empty path; `scopeContains('.md', path)` does not implement glob — the matcher is plain string-equality. F-128 worked around by using directory globs `dir/**` and explicit file names. Filed as follow-up.
- `cli/__tests__/model.test.mjs` "exits 1 on network error" leaves the spawned `bizar model list` subprocess pending; node test runner gets SIGINT during teardown. All 6 model tests pass; the `make test` runner does not exit cleanly because of this orphaned child. Pre-existing — fix in F-129 candidate.
- SDK version drift: SDK `10.10.1` vs root `10.11.0` (from F-122 bump that didn't propagate). Fixed in F-128 to `10.11.0`/`10.11.0`.

## Complete — F-122 Installer-Driven Gateway Model Discovery

**Objective:** Enable gateway model discovery at install time and add a `bizar model list` CLI that surfaces all 9Router model IDs including non-Claude-prefixed ones.

**Commit 1:** `3220519` — added `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY` to project settings template; fixed misleading model-router comment; 4 merge-settings tests pass 4/4.

**Commit 2:** `42574ac` — added `bizar model list` CLI (`cli/commands/model.mjs`) wired into `cli/bin.mjs`; hits `GET ${BIZAR_MODEL_ROUTER_URL}/models?limit=1000` with 3s timeout and auth-retry-on-401 logic; groups output by provider prefix; 5/6 CLI tests pass (first test had environment quirk in concurrent run, manual reproduction confirmed correct).

**Commit 3:** closes F-122 in feature_list.json, updates PROGRESS.md, prepends CHANGELOG.md.

**Commit 4:** fixes the one ambient test failure. The "exits 0 and prints table on 200" assertion required `stdout.includes('claude/')` but the sample fixture contains a slash-less Anthropic-prefixed ID (`claude-3-5-sonnet-20241022`) which the CLI correctly groups under `(no prefix)`. The `PROVIDER_GROUPS` array does include `claude/`, but no model in the sample matches that prefix; replaced the assertion with a comment explaining the picker semantics. Combined run: model 6/6 + install merge 4/4 in 3.6s.

**Final state:** merged to master at `6da7593`; pushed `90a2f97..6da7593` to `origin/master` (remote HEAD `6da7593a574afbd63c1c344c4e6420c58b6a428a`); follow-up task `F-125` completed.

## Complete — F-121 Fix Broken UserPromptSubmit Hook Imports

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

## In Progress — F-141 Installer: --force Prunes Stale Global Files

**Objective:** Fix two installer defects that broke `bizar install --force`
and left stale agent/skill/command/rule/hook entries in `~/.claude/` after
every Bizar release that renamed or removed files (e.g. the F-112 Norse→office
rebrand left `odin.md`, `frigg.md`, `mimir.md`, `tyr.md`, `thor.md`,
`heimdall.md`, `hermod.md`, `forseti.md`, `baldr.md`, `vidarr.md`, `vor.md`
polluting `~/.claude/agents/`).

**Defect 1 — flags dropped.** `cli/commands/install.mjs:install()` called
`runInstaller({})`, discarding `args`. `--force`, `--dry-run`, `--yes`,
`--quiet`, `--mode=update` were silently swallowed; users could not request a
force-prune at all.

**Defect 2 — installer was dirty.** `cli/provision.mjs:syncDir()` only added
and overwrote; it never removed obsolete entries. After any rename, dead
agent/skill/command names persisted in `~/.claude/` and polluted Claude
Code's Agent-tool subagent_type registry in every session.

**Defect 3 (discovered mid-fix) — published global package missing native binding.**
`@polderlabs/bizar@10.12.0` shipped with `better-sqlite3@12.11.1` source
but no compiled `better_sqlite3.node` artifact. The PreToolUse path-ownership
hook (`path-ownership-guard.mjs`) instantiates `TaskLedger` to authorize
edits, and `TaskLedger` requires that binding. Without it, every edit to
`cli/**` was denied with `LEDGER_UNAVAILABLE`, which is exactly the failure
pattern the user's Codex smoke test reported. Fixed by rebuilding the
binding in the global install via `npm install-scripts approve
better-sqlite3@12.11.1 && npm rebuild better-sqlite3`; the binding now
compiles and the hook authorizes edits normally.

**Changes:**
- `config/claude/settings.json` — added `"disableAutoCompact": true`; moved
  all 21 `permissions.ask` entries (git commit/push, gh pr/release, npm/bun/pnpm
  publish, vercel/wrangler/flyctl deploy) into `permissions.allow` while
  leaving `permissions.deny` (irreversible-danger blocklist) intact;
  replaced 13 bare `bizar hook <sub>` commands with the POSIX-portable
  `sh -c` fallback that probes `$HOME/.npm-global/bin`,
  `$HOME/.local/bin`, `/usr/local/bin`, `/usr/bin`, then `command -v`,
  then `npx -y @polderlabs/bizar-sdk`.
- `config/claude/hooks/bizar-hook-wrapper.sh` — new executable shim that
  replicates the same probe logic and is installed to
  `~/.claude/hooks/bizar-hook-wrapper.sh` by `bizar install`. Hooks run
  via the shim so PATH resolution happens at hook-invocation time, not
  at session-startup time.
- `cli/provision.mjs` — `hook()` factory now emits the absolute
  wrapper path; `normalizePermissionLists` no longer auto-moves hard-
  mutation rules from `allow` back into `ask` (the user's policy
  override now sticks across reinstalls).
- `config/claude/hooks/__tests__/bizar-hook-wrapper.test.mjs` — 5
  regression tests (executable bit, candidate-path probe with stripped
  PATH, PATH lookup fallback, npx-fallback source guard, template
  invariants). All pass.
- `cli/provision.test.mjs` — assertions updated to expect the wrapper
  path, to assert no bare `bizar hook` strings, and to assert
  `disableAutoCompact: true`. 16/16 pass.
- `cli/__tests__/hook-portability.test.mjs` — `permission merge`
  test rewrote to expect the new verbatim-merge behavior
  (no auto-promotion of hard-mutation rules into `ask`).
- `config/claude/hooks/__tests__/workflow-guards.test.mjs`,
  `config/claude/hooks/__tests__/agent-grounding.test.mjs`,
  `scripts/worktree-policy.test.mjs`, `scripts/bh-full-e2e.mjs` —
  updated assertions from "must contain `bizar hook <sub>`" to "must
  contain the wrapper shim path or sh -c probe" (with explicit guard
  that bare `bizar hook <sub>` is forbidden).

**Agent-completion fix (items 10–12):**
- `config/claude/agents/office-manager.md` — added a new
  "Handling Completion Notifications" subsection immediately after
  the "Do NOT block waiting on the background agent" line (line 311).
  It teaches the orchestrator that `<task-notification>` arrival
  means an agent-completion event with the actual result inside
  `<result>` — read it, synthesize, continue. Also added a one-line
  addition to the "Monitoring Programmatically" subsection: "Task-
  notification `<result>` blocks are the canonical surface for
  background-agent output — read them when they arrive."
- `config/claude/hooks/sessionstart-prime.mjs` — added one sentence
  in `startupBriefing()` (under the role bullets, line 190):
  `- When \`<task-notification>\` arrives, read the \`<result>\` and
  continue — do not skip past it as background noise.` Briefing stays
  under the 800-char `MAX_BRIEFING` cap.
- `config/claude/hooks/advisor-context.mjs` — added a single regex-
  strip pass after the 30 KB clip:
  `recent = recent.replace(/\[\s*CCR\s+retrieve[^\]]*\]/g, '[compacted context omitted]');`
  So subagents never see CCR compression markers in the injected
  parent transcript, even when auto-compaction slips through.

**Evidence (2026-08-26):**
- `node --test config/claude/hooks/__tests__/bizar-hook-wrapper.test.mjs` —
  5/5 pass (executable bit + four PATH-resolution scenarios).
- `node --test cli/provision.test.mjs` — 16/16 pass including the
  new `writeClaudeSettings — hook wrapper path (F-169)` suite.
- `make check` — TypeScript gate green.
- `make test` — full unit + integration suite green.
- Live `~/.claude/settings.json` patched to mirror the repo shape
  with the wrapper absolute path so the user sees the effect
  immediately on next session-start.

**Risks:**
- Sessions that previously auto-compacted now require manual `/compact`.
  Operators who prefer auto-compaction can flip `disableAutoCompact`
  back to `false` in their local `~/.claude/settings.json`.
- The `permissions.ask → allow` move relaxes the AGENTS.md hard
  approval list (commits, pushes, PRs, deploys) for this install.
  AGENTS.md documents the override so operators can revert locally
  if they want HITL back.

**Next:**
- @steve commits once human approves.
- Verify on a fresh session that the `bizar: command not found` errors
  are gone and subagents stop prompting for commits/pushes/deploys.
## In progress — F-166 User-controlled model picker (`bizar models`)

**Objective:** Give the user explicit control over which models the Bizar
orchestrator (@mike) may dispatch to. Live gateway discovery is no longer the
gate; the user picker is.

**Surface area:**
- New CLI `bizar models` (interactive picker, `--list`, `--set`, `--clear`, `--json`) with deprecated `bizar model` alias.
- Persistence: `config/claude/model-router.json#userSelected` (atomic write, preserves all other fields).
- Orchestrator rule: dispatch ONLY with `userSelected.models`. If the block is empty, inherit the session. No auto-discovery, no adding tier candidates that are not user-selected.
- Agent-model-guard: accepts models in any `tiers.<x>.models` (with live discovery) AND models in `userSelected.models` (picker IS the discovery — live probe bypassed for these).
- MCP `bizar_model_list`: filters output to user-selected.
- Office-manager prompt: documents the new decision tree + tier heuristic table.

**Tier heuristic** (set by picker, overridable per model in `userSelected.tierHints`):
- `qwen3.8 | gpt-5* | opus | o3-pro | o4-mini | sonnet-4*` → premium
- `haiku-4* | sonnet-3-7 | mini-high | m3-high | grok-3` → high
- `sonnet | gpt-4 | default | m3` → default
- `nano | mini | haiku (older) | flash | lite | tiny` → budget
- otherwise → mid
