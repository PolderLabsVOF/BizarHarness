# AUTONOMY_CONTRACT — Bizar Harness Autonomous Behavior Contract

**Status:** Accepted
**Date:** 2026-08-27
**Implements:** F-176, F-181, F-182, F-183, F-184
**Supersedes:** any contradicting `permissions.deny` / `permissions.ask`
prose in `AGENTS.md` or older `DEC-*` documents.

## Purpose

This document is the canonical contract for what Bizar Harness agents may
do autonomously and what requires human approval. It is the single source
of truth that the settings template, the hook chain, the orchestrator
prompt, and the audit ledger are validated against. Any change to the
rules below must update both the contract and the
`scripts/__tests__/autonomy-contract.test.mjs` consistency test in the
same commit.

## Tier 1 — Full autonomy (no prompts)

Agents have full permissions by default. The following are always
allowed silently:

- All file reads, edits, and writes within the repository
- All `Glob` / `Grep` operations
- All `Bash` commands EXCEPT those in Tier 3 (escalation list)
- All `WebFetch` / `WebSearch` calls
- All MCP tool calls
- All `CronCreate` / `CronDelete` / `CronList` / `ScheduleWakeup`
- Local `git commit` (including `--amend`, `git -C`, and
  `git --git-dir=` variants)
- `Agent` dispatches to other Bizar custom agents

## Tier 2 — Advisory (allow + 🟡 reminder)

PreToolUse hooks return `permissionDecision: "allow"` plus
`hookSpecificOutput.additionalContext` describing the recommended
action. Agents should heed the advice but may proceed regardless.
Examples:

- `/simplify` not run on the current staged diff
- Humanize patterns present in a `Write` payload
- Model override outside the active `userSelected` pool

## Tier 3 — HitL approval (gated by hooks)

The following categories require explicit human approval via
`permission-request.mjs` and `git-workflow-guard.mjs`:

- Pushes to any shared branch (`Bash(git push *)`, `--force`, `-f`)
- Rebase, history rewrite, remote branch deletion
- Pull-request mutations (`Bash(gh pr create *)`, `Bash(gh pr merge *)`)
- Releases, package publication (`npm publish`, `bun publish`,
  `pnpm publish`, `Bash(gh release create *)`)
- Deployments (`vercel deploy`, `wrangler deploy`, `flyctl deploy`)
- Production / shared-infrastructure writes
- Credential changes (env vars, secret-store mutations)
- Public exposure (binding a port to `0.0.0.0`)
- Irreversible local destruction (`rm -rf /`, `mkfs`, `shutdown`,
  `kill 1`)

## Tier 4 — Blocked (always denied)

These are blocked at the hook layer with no override path:

- Reads of `.env`, `.env.local`, `.envrc`, `secrets/`, `credentials/`
- Writes to `node_modules/`
- `Bash(sudo *)`
- Direct reads of `~/.aws/credentials`, `~/.ssh/id_*`
- `git push --force` / `-f` against any branch
- `git rebase` against any branch

## Settings template

`config/claude/settings.json` must satisfy:

- `permissions.deny` is `[]` (Tier 4 protection lives in hooks, not in
  the settings surface, so the floor is enforceable from any host that
  respects the hook chain).
- `permissions.ask` is `[]` (Tier 3 escalation is also hook-driven; the
  HITL prompt fires only when an agent hits a hard approval category).
- `permissions.allow` includes at minimum the patterns listed in
  Tier 1. The factory in `cli/provision.mjs#writeClaudeSettings` reads
  this template verbatim and ships it through `bizar install`.
- `defaultMode` is `"bypassPermissions"`.

## Cross-references

- `AGENTS.md` "Autonomy and parallelism" — operational interpretation
- `config/claude/settings.json` — settings template
- `config/claude/hooks/permission-request.mjs` — Tier 3 / Tier 4 floor
- `config/claude/hooks/git-workflow-guard.mjs` — Tier 3 git surface
- `config/claude/hooks/pretooluse-bash.mjs` — Tier 3 / Tier 4 bash
- `config/claude/hooks/pretooluse-editwrite.mjs` — Tier 4 secrets
- `config/claude/hooks/simplify-guard.mjs` — Tier 2 (advisory)
- `config/claude/hooks/content-style-guard.mjs` — Tier 2 (advisory)
- `config/claude/hooks/agent-model-guard.mjs` — Tier 2 (advisory)
- `scripts/__tests__/autonomy-contract.test.mjs` — consistency test

## Enforcement

A drift from this contract is a regression. The
`scripts/__tests__/autonomy-contract.test.mjs` test asserts:

1. The hard approval list in this contract matches the patterns
   enforced by `permission-request.mjs` and
   `git-workflow-guard.mjs`.
2. The settings template ships `permissions.deny: []`,
   `permissions.ask: []`, and a `defaultMode: "bypassPermissions"`.
3. Every Tier 1 entry is present in `permissions.allow`.
4. The hard-deny list in `pretooluse-bash.mjs` and
   `pretooluse-editwrite.mjs` matches Tier 4.

A failure on any of those is a blocker — `make test` must remain green.
