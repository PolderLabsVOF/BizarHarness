# DEC-007 — Native Claude Code approval gate

**Status:** Accepted and revised 2026-07-30

## Decision

Use Claude Code's `PreToolUse` hook output and settings permission table
as the only host-operation approval boundary. Dangerous shell and
sensitive-path operations are denied. Git commits, pushes, PR mutations,
releases, publication, and deployments return `ask` so a human must
approve them.

Safe hooks omit `permissionDecision`; Claude Code remains authoritative.
Force push and rebase are always denied. A commit also requires a fresh
successful `/simplify` token.

## Implementation

- `.claude/hooks/pretooluse-bash.mjs`
- `.claude/hooks/pretooluse-editwrite.mjs`
- `.claude/hooks/git-workflow-guard.mjs`
- `.claude/hooks/simplify-guard.mjs`
- `.claude/settings.json`

## Verification

Run `node --test --test-concurrency=1 .claude/hooks/__tests__/*.test.mjs`
and `make e2e`.
