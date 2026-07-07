<!-- headroom:rtk-instructions -->
# RTK (Rust Token Killer) — token-optimized shell commands (always safe to prefix).

<!-- end headroom -->

# AGENTS.md — Bizar Harness

> **Bizar Harness** is a Cline-based multi-agent coding harness for the Bizar project.
> It embeds ClineCore in-process, exposes 22 agent tools (plan, memory, kanban,
> background agents, Cline agent teams), and ships a TypeScript dashboard with a
> kanban task board and live background-agent viewer.

If you are an agent: read this file, then `PROGRESS.md`, then run `make check`.

## Quick commands

```sh
make setup       # Install dependencies (bun install)
make dev         # Start dashboard + plugin in dev mode
make check       # Full verification pipeline (typecheck + test)
make test        # Run all tests (plugin + sdk + dashboard)
make e2e         # End-to-end tests (real plugin load + tool exercise)
make vcr         # Verify Code Reality check via feature_list.json
make verify-feature ID=<n>  # Verify feature ID from feature_list.json
make check-arch  # Architectural constraints (scripts/check-arch.sh)
make clean-check # 5-dimension clean-state check
make session-start  # Record session start
make session-end    # Record session end
```

## Hard constraints (MUST / MUST NOT)

These rules are not optional. Violations break long sessions.

- **MUST** run `make check` before claiming work is done.
  # why: TS drift + failing tests are the #1 cause of broken sessions.
- **MUST** update `PROGRESS.md` before AND after every code change.
  # why: Cross-session memory lives there.
- **MUST** keep one logical operation per commit.
  # why: Bisecting, reverting, reviewing require atomic units.
- **MUST** keep documentation in sync with code in the same commit.
  # why: Stale docs are worse than no docs.
- **MUST** follow the WIP=1 rule: only one feature active at a time.
  # why: Parallel WIP prevents VCR from reaching 1.0.
- **MUST NOT** use `cline serve` as a subprocess — use ClineCore in-process.
  # why: Subprocess hangs in headless test envs.
- **MUST NOT** call dashboard HTTP from plugin for memory — use the in-process vault.
  # why: The plugin must work without a dashboard.
- **MUST NOT** commit `console.log`, `debugger`, or `.only()`.
  # why: `make clean-check` fails on these.
- **MUST NOT** skip E2E tests when changes cross component boundaries.
  # why: Unit tests pass on stubs; only E2E catches drift.

## State files (where the system remembers things)

- `PROGRESS.md` — Current state, In Progress, Next Steps, Blockers
- `DECISIONS.md` — Architectural decisions log
- `feature_list.json` — Machine-readable feature state
- `docs/architecture.md` — Layer model + module map
- `docs/quality-document.md` — A/B/C/D module health scores
- `.harness/arch-rules.json` — Architectural rule registry (WHAT/WHY/FIX)
- `.harness/traces/sessions.jsonl` — Runtime session traces (gitignored)
- `templates/sprint-contract.md` — Pre-feature negotiation template
- `templates/evaluator-rubric.md` — Sprint scoring rubric
- `templates/clean-state-checklist.md` — 5-dimension exit checklist

## Clock-in (start of session)

1. Read `PROGRESS.md` → confirm starting state + last commit.
2. Run `make check` → confirm green baseline.
3. Read `feature_list.json` → pick next `not_started` feature (WIP=1).
4. If feature needs negotiation, fill `templates/sprint-contract.md`.
5. Mark feature `active` in `feature_list.json`, commit.
6. Run `make session-start`.

## Clock-out (end of session)

1. Update `PROGRESS.md` Current State (commit hash + `make check` result).
2. Move feature from `active` → `passing` in `feature_list.json`.
3. Populate `evidence` field with test output / commit hash.
4. Score against `templates/evaluator-rubric.md` — every dim B+.
5. Run `make clean-check` — must pass on all 5 dimensions.
6. Run `make check` — must be green.
7. Commit with WHY-focused message.
8. Run `make session-end`.

> **Context anxiety warning:** If running low on context, do NOT rush
> to finish. Stop, update `PROGRESS.md` Next Steps with concrete actions,
> commit a clean checkpoint.

## Definition of Done (L09)

A feature is `passing` only when ALL THREE LAYERS verify:

- **Layer 1 — Compile/typecheck:** `make check` is green.
- **Layer 2 — Unit tests:** `make test` passes for the touched module.
- **Layer 3 — E2E:** `make e2e` exercises real plugin load + tools + hooks.

Layer ordering is mandatory. **Do NOT proceed to Layer N+1 if Layer N
fails.** A typecheck error (Layer 1) means Layers 2 and 3 will also
fail — fix it first.

Runtime signals include:
- `bun run /tmp/bh-full-e2e.mjs` exits 0 (22/22 pass)
- Plugin `setup()` returns in < 1s and registers 19 tools
- Memory tools round-trip (write → read → list → search)
- Cline agent teams tools registered
- Kanban board renders against `/api/tasks`

## Feature List Rules (L08)

State machine: `not_started` → `active` → `passing` (or back to `active` on failure).

- **Granularity:** One session per feature. Split if longer.
- **Pass-state gating:** Only `passing` features count toward VCR.
- **Evidence:** Required when marking `passing` (test output / commit hash).

## Architecture Boundaries (L10)

- `plugins/bizar/` is **Layer 0** (Core).
- `bizar-dash/` is **Layer 1** (UI).
- They communicate via ClineCore SDK, never via raw HTTP/stdio for memory.

`make check-arch` enforces:
- Plugin must not `import` from `bizar-dash/` (cross-layer).
- Plugin must not call `fetch('http://127.0.0.1:...')` for memory.
- Dashboard must not re-implement ClineCore features.

Every code-review finding becomes a rule in `.harness/arch-rules.json`
with `what` / `why` / `fix` fields.

## Observability (L11)

Per feature:

1. **Pre:** Fill `templates/sprint-contract.md` (scope, DoD, exclusions).
2. **During:** `make session-start` records session ID.
3. **During:** Tool invocations logged to `.harness/traces/sessions.jsonl`.
4. **Post:** Score against `templates/evaluator-rubric.md`.

## Clean State Protocol (L12)

A session is "clean" when ALL FIVE dimensions pass:

1. **Build passes:** `make check` exits 0.
2. **Tests pass:** `make test` exits 0.
3. **Feature list updated:** `feature_list.json` reflects actual state.
4. **No debug artifacts:** No `console.log`, `debugger`, `*.only()`.
5. **Startup path works:** `make e2e` registers the plugin and runs.

`make clean-check` is the idempotent verifier. Run at every clock-out.

**Dual-mode cleanup:**
- *Immediate:* Run `make clean-check` at every clock-out.
- *Periodic (weekly):* Full structural sweep — unused files, stale deps,
  orphaned tests.

## Topic documents

- [docs/INDEX.md](docs/INDEX.md) — documentation map (start here)
- [docs/architecture.md](docs/architecture.md) — layer model, module map
- [docs/quality-document.md](docs/quality-document.md) — module health (A/B/C/D)
- [docs/code-review.md](docs/code-review.md) — code review findings + actions
- [docs/safety.md](docs/safety.md) — DANGEROUS_PATTERNS reference (v6.0.0)
- [docs/curator.md](docs/curator.md) — Skill curator reference (v6.0.0)
- [docs/graph-tools.md](docs/graph-tools.md) — Knowledge graph tools (v6.0.0)
- [docs/migration-guide.md](docs/migration-guide.md) — OpenCode → Cline upgrade
- [docs/decisions/](docs/decisions/) — individual ADRs (see DECISIONS.md)
- [plugins/bizar/ARCHITECTURE.md](plugins/bizar/ARCHITECTURE.md) — plugin module
- [plugins/bizar/CONSTRAINTS.md](plugins/bizar/CONSTRAINTS.md) — plugin hard rules
- [plugins/bizar/tests/README.md](plugins/bizar/tests/README.md) — test reference
- [bizar-dash/ARCHITECTURE.md](bizar-dash/ARCHITECTURE.md) — dashboard module
- [packages/sdk/ARCHITECTURE.md](packages/sdk/ARCHITECTURE.md) — SDK module

## Repository structure

```
BizarHarness/
├── AGENTS.md               # entry point
├── PROGRESS.md             # current state, in progress, next steps
├── DECISIONS.md            # architectural decisions
├── feature_list.json       # machine-readable features
├── Makefile                # setup / dev / check / test / e2e / ...
├── package.json            # bun workspace root
├── .nvmrc                  # pinned runtime version
├── .claude/settings.json   # scoped tool access
├── .harness/
│   ├── arch-rules.json
│   └── traces/             # gitignored
├── docs/                   # architecture, quality, decisions
├── templates/              # sprint contract, rubric, clean-state
├── scripts/                # verify-feature, check-arch, clean-state, session-trace
├── plugins/bizar/          # Cline plugin + 19 tools
├── packages/sdk/           # SDK wrapper
└── bizar-dash/             # dashboard server + UI
```
