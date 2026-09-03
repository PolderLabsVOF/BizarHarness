---
description: Run the F-206 `/guard` progress-guarding loop (start / check / status / stop / list).
allowed-tools: Read, Write, Bash, WebFetch
---

# /guard — Progress-Guarding Loop

Manage the F-206 `/guard` progress-guarding loop. The guard is bounded
and read-only with respect to the host repo: it inspects a plan doc +
PROGRESS.md + feature_list.json + recent git history, returns a
verdict (`healthy | drift | stuck | done`), and self-terminates on
`done`. It does NOT auto-commit, auto-push, or auto-publish.

## Usage

```
/guard start <plan-path>     — Create a guard and print a copy-pasteable /loop invocation
/guard check                 — Run ONE bounded audit (use --slug <id> when >1 guard exists)
/guard status                — Print guard state and the most recent 5 checks
/guard stop                  — Mark the guard as stopped (operator override)
/guard list                  — Enumerate every guard on disk
```

## Routing

- `/guard start <plan-path>` → `bizar guard start --plan <plan-path>`
- `/guard check`             → `bizar guard check --slug <active-slug>`
- `/guard status`            → `bizar guard status`
- `/guard stop`              → `bizar guard stop --slug <active-slug>`
- `/guard list`              → `bizar guard list`

If more than one guard exists, `--slug <id>` is required for
`check` / `stop`. Use `/guard list` to discover the slug.

## Implementation Notes

Use the SDK guard API:

```
import { addGuard, getGuard, listGuards, recordGuardCheck } from "@polderlabs/bizar-sdk";
```

- `addGuard({ planPath, intervalMs, goal?, slug? })` — create or
  re-attach a guard.
- `recordGuardCheck(slug, check)` — append a verdict row to
  `.bizar/guards/<slug>/checks.jsonl` and update `lastVerdict`.
- `markGuardStopped(slug)` — operator-initiated stop.

State lives at `.bizar/guards/<slug>/state.json`. Each check appends
to `.bizar/guards/<slug>/checks.jsonl`. Drift / stuck verdicts also
write to `.bizar/guards/<slug>/drift-log.md`; `done` verdicts write a
`DONE.md` archive note.

Bizar does not run a persistent scheduler. The cadence is driven by
the operator wiring `bizar guard check --slug <id> --json` into
Claude Code's host-side `/loop` primitive (the `start` subcommand
prints the copy-pasteable line).
