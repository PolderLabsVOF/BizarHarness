# DEC-011 — Claude Code-native host

**Status:** Accepted
**Date:** 2026-07-11; revised 2026-07-30

Bizar uses Claude Code's native Agent, Skill, commands, hooks, permissions, and Agent SDK/MCP surfaces. It does not embed or manage another agent runtime and does not start a persistent Claude subprocess.

Agent definitions live in `.claude/agents`, commands in `.claude/commands`, hooks in `.claude/hooks`, and project settings in `.claude/settings.json`. `packages/sdk` provides framework-light primitives and the stdio MCP server. `cli/provision.mjs` installs the same surfaces at user scope.
