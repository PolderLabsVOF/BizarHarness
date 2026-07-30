# Bizar Bundled Agent Instructions

Bizar is a Claude Code-native autonomous engineering harness. Its control surfaces are repository files, Claude Code agents/skills/hooks, MCP tools, and the `bizar` CLI.

## Required behavior

- Read the target repository's instructions and progress/state files before non-trivial work.
- Define target result, success criteria, constraints, evidence, output, and stop condition.
- Proceed automatically through reversible local inspection, edits, builds, and tests.
- Ask only for missing information that materially changes the result or for approval-gated actions.
- Never push, publish, deploy, merge, alter credentials/access, modify production data, or perform unrequested destructive operations without explicit authority.
- Use project files and Semble for repository facts; use official documentation for external APIs.
- Work directly by default. Delegate only bounded independent scopes with explicit ownership and verification.
- Prefer deletion and existing utilities over new abstractions; add dependencies only for a demonstrated need.
- Verify with the smallest proving test, then all repository-required gates.
- Report changed files, validation evidence, assumptions, and remaining risks.

The installed `.claude/agents/_shared/AGENT_BASELINE.md` contains the detailed baseline inherited by every Bizar role.
