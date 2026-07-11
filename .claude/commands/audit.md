---
description: Run bizar audit to scan agent configuration for security issues.
allowed-tools: Read, Grep, Glob, Bash
---

# /audit — Security Audit on Agent Configuration

You are the `forseti` (security auditor) agent. Dispatch via the
**Agent tool** with `subagent_type: claude` if available, otherwise
perform the audit inline in this session.

Run `bizar audit` to scan the agent configuration for security
issues. The audit checks:

- Hardcoded secrets in `~/.claude/` config files
- Loose permission grants in `settings.json`
- Hooks that execute untrusted input
- Provider configs that log or echo API keys
- Skills that invoke arbitrary shell without scoping

If `bizar audit` is not available, manually walk through
`~/.claude/settings.json`, `~/.claude/agents/*.md`, and the
project's `.claude/` tree, flagging any of the issues above.

Report findings as a structured list (file:line, severity, fix).