# Bizar Remote (preview)

**Status:** Foundation only — under active development.

A local-first webui for monitoring and controlling BizarHarness agents across all your projects.

## Repo

- **URL:** https://github.com/DrB0rk/bizar-remote (private)
- **License:** MIT
- **Stack:** Hono + TypeScript + Hono JSX + better-sqlite3 + Vitest

## What it is

A small web server (Hono + Hono JSX + better-sqlite3) that:
- Discovers all your BizarHarness projects
- Shows all running background agents in real time (via SSE)
- Lets you spawn, kill, and message agents from a browser
- Integrates with the Hindsight MCP for memory

Runs at `http://localhost:8765` by default. Single-user, no auth, no cloud.

## Status

| Component | Status |
|-----------|--------|
| v0.1 spec | Written (in `BizarHarness/.bizar/bizar-remote-spec.md`) |
| v0.1 scaffold | Pushed to https://github.com/DrB0rk/bizar-remote |
| Project discovery | One route (`GET /api/projects`) working |
| Full v0.1 (~10,600 LOC) | ~4 weeks of estimated work |

## See also

- [Dev Sandbox](Dev-Sandbox) — the Docker sandbox for testing BizarHarness itself
- [Plans Command](Plans-Command) — the local visual plan tool
