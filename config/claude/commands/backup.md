---
description: Snapshot global Bizar state and relevant project-local state.
allowed-tools: Read, Bash
---

# /backup — snapshot Bizar state

Run `bizar backup [label]`. It writes a timestamped directory under
`~/.local/share/bizar/backups/` containing:

- `~/.config/bizar/` — user-global Bizar configuration and bounded runtime state.
- `<projectRoot>/.bizar/` — current project's Bizar state.
- Project-scoped Claude and agent skill mirrors when present.

The manifest records a SHA-256 hash for every copied file. Use
`bizar backup verify <path>` before restoring. Backups are never overwritten.
