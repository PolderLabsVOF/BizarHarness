# DEC-003 — In-process memory vault (no dashboard HTTP)

**Date:** 2026-07-07
**Status:** Accepted
**Deciders:** @karen
**Related:** DEC-001

## Context

The 4 memory tools (`bizar_memory_list/read/write/search`) called
the dashboard's HTTP API at `http://127.0.0.1:${port}/api/memory/*`.
When the dashboard wasn't running, the tools returned
`{ ok: false, error: "dashboard_not_running" }`. The plugin
should be self-contained — the dashboard is optional.

The Obsidian-compatible Markdown vault at `~/.bizar_memory/` is
already on disk. We can read/write it directly.

## Decision

Implement an in-process Obsidian-compatible markdown vault
(`plugins/bizar/src/memory-vault.ts`). Reads/writes the vault
directory directly:

- **Default path:** `~/.bizar_memory/`
- **Override:** `BIZAR_MEMORY_VAULT` env var
- **Legacy path:** `~/.local/share/bizar/memory/bizar-memory/` —
  still readable for back-compat with pre-Phase-3 sessions

The vault format is Obsidian-compatible:

```markdown
---
tags: [typescript, plugins]
title: My Note
createdAt: 2026-07-07
---

# My Note

Body in plain Markdown.
```

A minimal YAML frontmatter parser (no nested structures) handles
the metadata that the dashboard writes.

## Consequences

### Positive

- Memory tools work without a dashboard.
- Full-text search is in-process (substring + FTS5-ready); the
  dashboard's semantic / LightRAG search remains the source of
  truth for higher-quality results.
- The plugin and the dashboard can both read/write the same vault
  without HTTP coordination.
- Tests can run in isolation; no dashboard mock needed.

### Negative

- Two writers (plugin + dashboard) can race on the same file. We
  accept this for v6.0.0; file locking is queued for v6.1.0.
- Frontmatter parser is minimal — no nested maps, no multi-line
  scalars. Sufficient for the tags/type/title metadata the
  dashboard writes today.

### Neutral

- The dashboard's `/api/memory/*` endpoints are unchanged and
  still work for remote access.
- `BIZAR_MEMORY_VAULT` env var takes precedence; otherwise
  `~/.bizar_memory/` is used.

## Implementation notes

```ts
// plugins/bizar/src/memory-vault.ts (excerpt)
export function resolveVaultRoot(): string {
  const fromEnv = process.env.BIZAR_MEMORY_VAULT;
  if (fromEnv) return fromEnv;
  return join(homedir(), ".bizar_memory");
}

export function readNote(path: string): { ok: true; content: string; frontmatter: Record<string, unknown> } | { ok: false; error: string } {
  // ... reads ~/.bizar_memory/<path>.md, parses frontmatter
}

export function writeNote(path: string, content: string, frontmatter: Record<string, unknown>): { ok: true; path: string } | { ok: false; error: string } {
  // ... writes to ~/.bizar_memory/<path>.md
}
```

The search uses substring counting on the body + frontmatter
values. LightRAG is not wired in (out of scope for in-process).

## References

- `plugins/bizar/src/memory-vault.ts` (88 lines)
- `plugins/bizar/src/tools/memory-{list,read,write,search}.ts`
- `bizar-dash/src/server/memory-store.mjs` — the dashboard's
  full-featured memory service (LightRAG, git sync, etc.)
