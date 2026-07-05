---
name: obsidian
description: Use the Bizar Memory Service for persistent project knowledge - local Obsidian-compatible Markdown + Git-shared sync. Read vault entries before non-trivial decisions; write after meaningful work. Three layers: Markdown (truth) → Git (collaboration) → LightRAG (derived index, Phase 2).
---

# Bizar Memory Service (Obsidian)

Three-layer persistent memory for project knowledge.

## Architecture

1. **Markdown (truth)** - Obsidian-compatible `.md` files with YAML frontmatter, wikilinks, and callouts. Stored in per-project vaults under `~/.config/opencode/memory/<project>/`.
2. **Git (collaboration)** - Vaults are Git-tracked and synced. The vault path is unique per project, enabling team sharing via normal Git workflow.
3. **LightRAG (derived index, Phase 2)** - When the LightRAG server runs, the memory service indexes all vault entries for fast full-text retrieval.

## Vault Discovery

At session start, call `obsidian_list_vaults` (via the Obsidian MCP tool or CLI) to find available vaults. Match by project name. The default vault is for cross-project knowledge only.

## Vault Structure

```
~/.config/opencode/memory/<project>/
  .obsidian/         # Obsidian config (workspace.json etc.)
  index.md           # Entry point: links to recent, important, pinned notes
  projects/          # Project-specific notes
  decisions/         # ADRs and architectural decisions
  references/        # External knowledge captured for this project
  daily/             # Daily notes (journal-style)
```

## Adding Knowledge

After meaningful work, write a note:

- Use frontmatter: `created:`, `updated:`, `tags:`, `project:`
- Link related notes with `[[wikilinks]]`
- Keep notes small and focused (one concept per note)
- Update `index.md` if adding a significant new area

## Querying Knowledge

Use the memory service to find relevant context before making non-trivial decisions:
- `bizar memory search "<topic>"` - full-text search across vault
- `bizar memory status` - shows vault path, last sync, index state

## LightRAG Integration

When LightRAG is enabled (v4.5.0+), it indexes vault content automatically. Query with `bizar memory search` - this routes to LightRAG for natural-language queries. For simple lookups, direct file reading is faster.

## Common Gotchas

- The vault is git-tracked but not auto-committed. Commit after meaningful knowledge additions.
- Wikilinks work within Obsidian but are just plain links in plain Markdown viewers.
- Heavy media files (images, PDFs) should be stored outside the vault or Git LFS-tracked.
