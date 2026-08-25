---
description: Snapshot the Bizar runtime state under ~/.config/bizar/ and any project-level .bizar/ + .claude/skills/ mirror.
allowed-tools: Read, Bash
---

# /backup — snapshot Bizar state

Runs `bizar backup`. It writes a timestamped tarball to
`~/.config/bizar/backups/<UTC>/` containing:

- `~/.config/bizar/` — runtime config, telemetry, audit ledger, instinct log.
- `<projectRoot>/.bizar/` — current project's operational records
  (PROGRESS.md, control/, tasks.sqlite, learning/).
- `<projectRoot>/.claude/skills/` and `<projectRoot>/.agents/skills/` —
  any project-scoped skill mirrors.
- `cli/__tests__/fixtures/` is excluded; no test fixture is shipped
  in the archive.

Backups are never overwritten — each invocation creates a new directory.
