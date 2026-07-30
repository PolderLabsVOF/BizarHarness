# Agent self-improvement record

## Current invariants

- Prefer evidence, deletion, existing utilities, and small reversible diffs.
- Keep one active feature and one logical operation per commit.
- Preserve explicit human approval boundaries during compaction and handoff.
- Treat session handoff and learning JSONL as bounded operational records, not a general knowledge store.
- Run targeted tests before broad gates and record exact failures and fixes.
- Keep canonical skills under `config/skills` and verify the `.claude/skills` mirror.

Historical implementation notes are available in Git history rather than carried into every session.
