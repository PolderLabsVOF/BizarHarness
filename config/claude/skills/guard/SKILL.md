---
name: guard
description: Operate Bizar's bounded OpenKan-aware progress guard for plans, durable task state, drift, and stalled work.
argument-hint: "<start <plan-path-or-id> | check | status | stop | list>"
---

# OpenKan progress guard

`bizar guard` is a bounded audit wired to Claude Code’s host-side `/loop`; it never starts a persistent Bizar daemon.

1. `bizar guard start --plan <path-or-openkan-plan-id>` creates `.bizar/guards/<slug>/state.json`.
2. `bizar guard check --slug <slug> --json` reads the plan, OpenKan `.ok/` tasks/plans, recent Git activity, and prior checks.
3. `healthy` means active OpenKan work is advancing; `drift` means plan actions and ready OpenKan work materially diverge; `stuck` means no repository or `.ok/` change; `done` means the linked plan or every task is terminal.
4. Drift and stuck append an advisory `drift-log.md`. Done self-terminates and archives `DONE.md`.

OpenKan remains the live progression source. Do not use or modify `PROGRESS.md` or `feature_list.json` from this workflow.
