---
name: lightrag
description: LightRAG integration with BizarHarness. Covers setup, opencode-free defaults, querying, indexing, and the memory service integration.
---

# LightRAG Integration

LightRAG provides fast full-text and keyword search over Obsidian vault content. It is the Phase 2 component of the Bizar Memory Service.

## Overview

- **LightRAG** - a lightweight RAG (Retrieval-Augmented Generation) server that indexes Markdown files
- **Bizar Memory Service** - three-layer system: Markdown (truth) → Git (collaboration) → LightRAG (index)
- **opencode-free defaults** - LightRAG runs without opencode, accessible to any HTTP client

## Setup

Start the LightRAG server:
```bash
npx lightrag-server --port 8724
```

Or via the Bizar dashboard: navigate to Settings → LightRAG and configure the server URL.

## Configuration

LightRAG settings are stored in `~/.config/opencode/lightrag.json`:

```json
{
  "serverUrl": "http://localhost:8724",
  "indexRoot": "~/.config/opencode/memory",
  "autoIndex": true,
  "embeddingModel": "bge-m3"
}
```

## API Endpoints

- `GET /api/lightrag/status` - server health and index stats
- `POST /api/lightrag/index` - trigger re-indexing of vault
- `GET /api/lightrag/search?q=` - full-text search over vault
- `GET /api/lightrag/extract?entities=` - entity extraction

## Search Example

```bash
curl "http://localhost:8724/search?q=authentication+flow&k=5"
```

Returns ranked snippets with source file paths.

## Integration with Memory Service

When both Obsidian vault and LightRAG are configured:
1. The memory service writes new knowledge to the vault
2. LightRAG indexes the vault continuously or on-demand
3. `bizar memory search` routes natural-language queries to LightRAG

## When to Use LightRAG vs Direct File Read

| Query Type | Use |
|---|---|
| Natural-language question | LightRAG search |
| Specific fact lookup | Direct file read |
| Related concepts discovery | LightRAG search |
| Precise location of text | grep + read |

## Common Issues

### Empty search results
Cause: index is stale or the server is down. Fix: POST to `/api/lightrag/index` to re-index.

### Server not responding
Check that LightRAG is running: `curl http://localhost:8724/status`. If not, restart with `npx lightrag-server`.
