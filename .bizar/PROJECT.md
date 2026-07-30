# BizarHarness

Claude Code-native guarded-autonomy harness with role agents, canonical skills, slash workflows, safety and lifecycle hooks, a typed SDK, a nine-tool MCP server, and CLI verification utilities.

## Goal

Complete clear local work autonomously while preserving human approval for external, irreversible, credential-sensitive, and production/shared-infrastructure actions.

## Boundaries

- No persistent web control plane or service lifecycle.
- No general note vault, note CRUD/search, or semantic index.
- Bounded session handoff and learning logs are operational evidence only.
- `config/skills` is canonical and `.claude/skills` is its verified mirror.
