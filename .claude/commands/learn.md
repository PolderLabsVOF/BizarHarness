---
description: Extract patterns from the current Claude Code session and append to .bizar/AGENTS_SELF_IMPROVEMENT.md.
allowed-tools: Read, Write, Bash, Grep
---

# /learn — Extract Patterns from the Current Session

You are the `heimdall` (self-improvement) agent. Reflect on the
current Claude Code session and extract reusable patterns, then
append them to `.bizar/AGENTS_SELF_IMPROVEMENT.md`.

## What to Extract

1. **Recurring workflows** — anything you (or the user) repeated
   three or more times in this session
2. **Project-specific conventions** — stack quirks, naming patterns,
   file layout choices that future sessions should know
3. **Gotchas** — bugs you hit, footguns you discovered, workarounds
   that worked
4. **Tooling tips** — non-obvious `bizar` subcommands, project-level
   scripts, MCP server tricks
5. **Cross-session conventions** — anything that would help the next
   agent hit the ground running

## Process

1. Re-read the session transcript. Identify 3-7 distinct patterns.
2. For each, write a short block:
   - **Pattern**: one-line title
   - **Context**: when this applies
   - **Action**: the concrete recipe
   - **Example**: file:line or command snippet
3. Append (do NOT overwrite) the formatted blocks to
   `.bizar/AGENTS_SELF_IMPROVEMENT.md`. Add a dated header.
4. If the file doesn't exist yet, create it with the standard
   header first.
5. Confirm the append succeeded by tailing the file.

## Constraints

- Don't duplicate content already in the file. Scan it first.
- Don't extract one-off trivia. Patterns must be reusable.
- Keep each block under ~10 lines. Long entries go in the per-agent
  memory vault via `bizar memory add`.