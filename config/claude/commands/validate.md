---
description: Validate the installed Bizar harness, hooks, agents, skills, settings, and retained runtime surfaces.
---

# Validate Bizar

Run:

```bash
bizar validate
```

Use `bizar validate --json` for machine-readable evidence and
`bizar validate --strict` when optional integrations must also be reachable.

The validator checks Claude Code, the Bizar MCP registration, guarded autonomy
hooks, all 16 uniquely named agent definitions, slash commands, mirrored skills and
rules, permissions, and local runtime state. Report failures verbatim and repair
the smallest responsible surface; do not bypass a failed approval or safety
check.
