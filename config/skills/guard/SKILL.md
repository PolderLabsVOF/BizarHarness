---
name: guard
description: Operate the F-206 `/guard` progress-guarding loop: start a guard with a plan doc and cadence, run bounded read-only audits, react to healthy/drift/stuck/done verdicts, and self-terminate on plan completion.
argument-hint: "<start <plan-path> | check | status | stop | list>"
---

# /guard — Progress-Guarding Loop

`/guard` is a bounded read-only progress audit the operator wires into
Claude Code's host-side `/loop` primitive. It does not spawn a
persistent background process; every invocation of
`bizar guard check --slug <id> --json` is independent and the cadence
is driven by the host scheduler the operator chooses.

## Lifecycle

1. **Start.** `/guard start <plan-path>` creates a guard at
   `.bizar/guards/<slug>/state.json` and prints a copy-pasteable
   `/loop <interval> "bizar guard check --slug <slug> --json"` line.
   The state schema is versioned (`GUARD_SCHEMA_VERSION = "1.0.0"`).
2. **Check.** `/guard check` reads the plan doc, `PROGRESS.md`,
   `feature_list.json`, the most recent `git log` entry, and the
   per-guard `checks.jsonl`. It records one row to `checks.jsonl`
   and (when the verdict is `drift` or `stuck`) appends to
   `drift-log.md` and a one-line nudge to PROGRESS.md's most recent
   `## In Progress` block.
3. **Status / list.** `/guard status` and `/guard list` are
   observability surfaces; both emit JSON on `--json`.
4. **Stop.** `/guard stop` is the operator override. It sets
   `status = "stopped"` and `stoppedAt`, distinct from a verdict-driven
   transition.
5. **Done (self-termination).** When the verdict is `done`, the
   guard sets `status = "done"`, writes a `DONE.md` archive note,
   and `recordGuardCheck` writes `selfTerminated = true` to the
   `checks.jsonl` row. The next `/loop` invocation will still run,
   but the verdict will stay `done` and the operator should cancel
   the loop.

## Verdicts

| Verdict   | When                                                                                  | Operator action                                                                                   |
|-----------|----------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| `healthy` | Plan has progress; recent commits / worktrees / feature_list.json changes are present | Continue the loop; nothing to do.                                                                  |
| `drift`   | Plan's next-action list and PROGRESS.md diverge (≥ 3 token-set difference)              | Reconcile the plan's next-actions list with the most-recent `## In Progress` block.                |
| `stuck`   | No commits in last interval + no in-flight worktrees + no feature_list.json change      | Pause the loop, refresh the plan, re-run `bizar guard start` with a fresh slug if scope changed. |
| `done`    | Plan doc closed OR VCR activated == passing AND no `in_progress` features               | Cancel the host `/loop`. The guard has archived itself in `DONE.md`.                               |

## What the operator should do

- **Read `drift-log.md` first** when the verdict is `drift` or
  `stuck` — it carries the raw signals the audit emitted so you can
  see exactly which gate fired.
- **Use `--json` on `check` and `status`** when piping the guard into
  automation or feeding the verdict into a downstream reviewer.
- **Cancel the `/loop` after `done`** — the audit is idempotent and
  will keep returning `done`, which is wasteful but harmless.

## Linkage to the harness

- SDK: `packages/sdk/src/agent/guard.ts`
- CLI: `cli/commands/guard.mjs`
- Slash command: `config/claude/commands/guard.md`
- Feature: F-206 in `feature_list.json`
