---
description: Run the Bizar harness audit — scores 12 dimensions 0-10, aggregates to 0-100.
allowed-tools: Read, Write, Bash
---

# /audit — Harness Self-Audit

Run the harness audit: `node scripts/audit.mjs --write`.
The script scores 12 categories (each 0-10), aggregates to a 0-100 score,
and writes `.harness/audit/latest.json`.

## Categories scored

| Category | Weight | What it checks |
|---|---|---|
| typecheck | 15% | `bunx tsc --noEmit` exits 0 |
| tests | 12% | `make test` exits 0 |
| e2e | 12% | `bun run scripts/bh-full-e2e.mjs` exits 0 |
| arch-boundaries | 8% | `bash scripts/check-arch.sh .` passes |
| security-patterns | 10% | No hardcoded keys, no overly broad allowed-tools |
| doc-sync | 5% | AGENTS.md and CLAUDE.md are in sync |
| feature-list-state | 10% | No `not_started` backlog, all passing features have evidence |
| clean-state | 8% | No `console.log`, `debugger`, or `.only()` in production code |
| perf-budget | 5% | No single file exceeds 2000 lines |
| coverage | 5% | Coverage tooling configured (stub — add c8 to upgrade) |
| observability | 5% | sessions.jsonl + arch-rules.json exist |
| drift | 5% | Score differs from prior run |

## Output

```
{version, startedAt, completedAt, total, scores, categories, weights}
```

- `categories[key].evidence` — human-readable explanation of the score
- `categories[key].score` — 0-10 for that dimension
- `total` — weighted sum, 0-100
- `.harness/audit/latest.json` — persisted result (written with `--write`)

## Usage

```
/audit              — print JSON score to stdout (no file written)
/audit --write      — print JSON and write .harness/audit/latest.json
make audit          — same as --write with a summary line
```

Run it, then read the evidence strings to understand which categories need attention.
