---
description: Spawn a Cline agent team — coordinate Thor (M2.7), Tyr (M3), Mimir (research), and Hermod (git) to complete a complex mission end-to-end.
agent: odin
---
# Team — Spawn a Cline Agent Team

The `/team` command spawns a **coordinated agent team** for a complex,
multi-step mission. The lead agent coordinates teammates; each teammate
owns a disjoint scope; results are synthesized and committed.

## When to Use `/team`

Use `/team` for any non-trivial mission that benefits from **parallel
work + explicit coordination**. Examples:

- **Refactor** — split a module across Thor (M2.7) and Tyr (M3) in parallel.
- **Multi-feature build** — new feature A (Thor) + new feature B (Tyr) + tests (Heimdall).
- **Research + implementation** — Mimir researches, Thor implements, Forseti audits.
- **Migration / upgrade** — Hermod handles the git/PR lifecycle while Thor/Tyr write code.
- **Bug hunt** — Mimir traces the data flow while Tyr writes the fix and tests.

Do NOT use `/team` for trivial single-file edits or single-question
clarifications. Use `@heimdall` directly for those.

## Default Team Composition

If the user does not specify a team composition, spawn this default:

| Role          | Agent   | Model             | Job                                   |
|---------------|---------|-------------------|---------------------------------------|
| Lead          | @odin   | minimax/MiniMax-M3   | Coordinate, synthesize, gate quality  |
| Implementer 1 | @thor   | minimax/MiniMax-M2.7 | Moderate-complexity implementation   |
| Implementer 2 | @tyr    | minimax/MiniMax-M3   | Complex / cross-cutting work         |
| Researcher    | @mimir  | 9router/kr/auto  | Codebase research, pattern discovery  |
| Git ops       | @hermod | minimax/MiniMax-M2.7 | Branch, commit, push, PR             |
| Reviewer      | @forseti| minimax/MiniMax-M3   | Audit plan + final output            |

You can swap or remove any of these — but always keep at least one
implementer and a reviewer.

## Protocol (How Odin Runs a `/team` Invocation)

1. **Read `.bizar/PROJECT.md`** if it exists. Factor the project
   description into the team mission.
2. **Read `bizar memory status`**. If the vault is reachable, run
   `bizar memory search "<topic>"` for prior context on the mission.
3. **Decompose** the mission into disjoint work items. Each item
   names:
   - The agent that owns it
   - The file scope (paths/globs)
   - The deliverable (a function, a test, a commit, a doc)
   - The exit signal ("done when X is committed")
4. **Launch in parallel** — use `bizar_spawn_team` with the mission
   string. Or, if you prefer synchronous control, launch 2+ `task`
   calls in a **single message** to drive Thor and Tyr directly.
5. **Monitor** — while the team runs, return control to the user.
   The team runs asynchronously. Use `bizar_status` to check progress
   only when the user asks.
6. **Synthesize** — when teammates report back, gate through @forseti
   (audit) and @hermod (commit/push). Then report the final outcome
   to the user with file:line references.

## Pre-Dispatch Checklist (MANDATORY)

- [ ] Each teammate has a **disjoint file scope** — no two agents
       edit the same file or directory
- [ ] Lockfiles, `package.json`, root configs, `tsconfig.json`,
       `vite.config.*`, `Dockerfile`, CI configs are assigned to ONE
       agent or marked READ-ONLY for everyone else
- [ ] No subagent has both `bash: allow` AND a write-level git task
       in the same batch — Hermod is the only git writer
- [ ] Each teammate's scope is named in plain English
- [ ] You have prepended the **Sibling-Awareness Block** to every
       prompt — see Odin baseline, "Parallel Dispatch Coordination"
- [ ] You have called `bizar memory status` and confirmed the vault
       is reachable

## Example Mission Strings

**Refactor a module:**
```
Refactor src/api/auth.ts into a clean module: extract JWT validation
into src/auth/jwt.ts, rate-limiting into src/auth/rate-limit.ts, and
keep the public surface stable. Add tests for each new module. Update
docs/architecture.md with the new module map. Do not change the HTTP
route handlers.
```

**Multi-feature build:**
```
Add a kanban board: (1) Thor — backend API at /api/tasks with CRUD
endpoints and SQLite persistence. (2) Tyr — frontend React component
in src/components/Kanban.tsx with 5 columns. (3) Heimdall — write
the OpenAPI spec at docs/api/tasks.yaml. (4) Hermod — open a PR
named feat/kanban-board.
```

**Bug hunt:**
```
Mimir — trace the data flow from POST /api/checkout through to the
Stripe webhook handler; find any place where the order status is
written before the payment is confirmed. Tyr — write a regression
test that reproduces the race. Thor — fix the bug. Forseti —
audit the fix for completeness. Hermod — commit + push.
```

## Tool Reference

- `bizar_spawn_team` — spawn a full team in one call (lead + mission)
- `bizar_spawn_background` — spawn a single background agent
- `bizar_status` — list all running background instances
- `bizar_collect` — block until an instance completes (use sparingly)
- `bizar_kill` — terminate an instance

## Failure Modes

- **Two agents write the same file** — STOP, revert one branch, reassign.
- **One agent stalls** — call `bizar_kill`, route the remaining scope
  to another agent.
- **Tests fail after team work** — dispatch @thor to investigate; do
  not paper over the failure.
- **Git conflict** — route to @hermod for `git rebase` / merge resolution.
- **A teammate goes silent** — call `bizar_status` for a status report;
  if dead, kill and re-spawn with a fresh prompt.
