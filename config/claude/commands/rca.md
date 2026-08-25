---
description: Analyze a GitHub issue end-to-end with the Bizar agent team and propose a reversible plan.
allowed-tools: Read, Bash, Agent
---

# /rca — root-cause analysis on a GitHub issue

Runs `bizar rca <issue-number-or-url>`:

1. Fetches the issue body, comments, and linked PRs via the GitHub CLI.
2. Spawns `@mike` → `@greg` (research) → `@paul` (plan) → `@linda` (audit) on the
   current repo, in the standard research → plan → review order.
3. Writes a `docs/issues/<id>-rca.md` with the agreed reversible plan and
   the evidence ledger.
4. Returns the plan summary in chat and registers an autopilot entry only
   if the issue contains an explicit `## Plan` checklist.

Without an explicit plan, `/rca` is read-only — no files are changed beyond
the new RCA document.