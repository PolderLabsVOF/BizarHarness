---
description: Spawn a Claude Code agent team — coordinate Thor (M2.7), Tyr (M3), Mimir (research), and Hermod (git) to complete a complex mission end-to-end.
allowed-tools: Read, Bash, Agent
---

# Team — Spawn a Claude Code Agent Team

The `/team` command spawns a **coordinated agent team** for a complex,
multi-step mission. The lead agent coordinates teammates; each teammate
owns a disjoint scope; results are synthesized and committed.

The full mission is available as `$ARGUMENTS` (or composed from `$1`).

## When to Use `/team`

Use `/team` for any non-trivial mission that benefits from **parallel
work + explicit coordination**. Examples:

- **Refactor** — split a module across Thor (M2.7) and Tyr (M3) in parallel.
- **Multi-feature build** — new feature A (Thor) + new feature B (Tyr) + tests (Heimdall).
- **Research + implementation** — Mimir researches, Thor implements, Forseti audits.
- **Migration / upgrade** — Hermod handles the git/PR lifecycle while Thor/Tyr write code.
- **Bug hunt** — Mimir traces the data flow while Tyr writes the fix and tests.

Do NOT use `/team` for trivial single-file edits or single-question
clarifications. Use `@brenda` directly for those.

## Default Team Composition

If the user does not specify a team composition, spawn this default:

| Role          | Agent   | Model             | Job                                   |
|---------------|---------|-------------------|---------------------------------------|
| Lead          | @mike   | minimax/MiniMax-M3   | Coordinate, synthesize, gate quality  |
| Implementer 1 | @todd   | minimax/MiniMax-M2.7 | Moderate-complexity implementation   |
| Implementer 2 | @karen    | minimax/MiniMax-M3   | Complex / cross-cutting work         |
| Researcher    | @greg  | bizar/MiniMax-M3 | Codebase research, pattern discovery  |
| Git ops       | @steve | minimax/MiniMax-M2.7 | Branch, commit, push, PR             |
| Reviewer      | @linda| minimax/MiniMax-M3   | Audit plan + final output            |

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
4. **Launch in parallel** — use the **Agent tool** in a **single
   message** with multiple `Agent` calls so all teammates run
   concurrently. Each call's prompt names the Bizar agent
   (`todd`, `karen`, `greg`, `steve`, `linda`) so the audit
   trail stays readable. For long-running work, pass
   `run_in_background: true`.
5. **Monitor** — while the team runs, return control to the user.
   The team runs asynchronously. Check teammate progress only
   when the user asks (use `SendMessage` to the named agent).
6. **Synthesize** — when teammates report back, gate through @linda
   (audit) and @steve (commit/push). Then report the final outcome
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
- [ ] You have prepended a one-paragraph sibling-awareness block to
      every prompt (Odin baseline, "Parallel Dispatch Coordination")
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

## Tool Reference (Claude Code)

- **Agent tool** — spawn one subagent per call. Use multiple
  `Agent` calls in a single message for parallelism.
- `run_in_background: true` on the Agent tool — for tasks that
  span more than a few minutes.
- `SendMessage` — talk to a running background agent by name.

## Failure Modes

- **Two agents write the same file** — STOP, revert one branch, reassign.
- **One agent stalls** — use `TaskStop` to terminate, route the
  remaining scope to another agent.
- **Tests fail after team work** — dispatch `todd` to investigate;
  do not paper over the failure.
- **Git conflict** — route to `steve` for `git rebase` / merge
  resolution.
- **A teammate goes silent** — send a `SendMessage` to the named
  agent for a status report; if dead, kill and re-spawn with a
  fresh prompt.