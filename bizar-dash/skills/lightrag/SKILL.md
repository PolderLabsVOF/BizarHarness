---
name: lightrag
description: LightRAG integration with BizarHarness. Covers setup, cline-free defaults, querying, indexing, and the memory service integration.
---

# LightRAG Integration

LightRAG provides fast full-text and keyword search over Obsidian vault content. It is the Phase 2 component of the Bizar Memory Service.

## Overview

- **LightRAG** - a lightweight RAG (Retrieval-Augmented Generation) server that indexes Markdown files
- **Bizar Memory Service** - three-layer system: Markdown (truth) → Git (collaboration) → LightRAG (index)
- **cline-free defaults** - LightRAG runs without cline, accessible to any HTTP client

## Setup

Start the LightRAG server:
```bash
npx lightrag-server --port 8724
```

Or via the Bizar dashboard: navigate to Settings → LightRAG and configure the server URL.

## Configuration

LightRAG settings are stored in `~/.config/cline/lightrag.json`:

```json
{
  "serverUrl": "http://localhost:8724",
  "indexRoot": "~/.config/cline/memory",
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

## Memory tab in the dashboard (v4.7.0+)

The dashboard's **Memory** tab (sidebar entry between Skills and Settings) surfaces LightRAG controls without leaving the browser:

- **LightRAG panel** — Start / Stop / Restart / Reindex all / Rebuild graph. Rebuild graph wipes the working dir and re-runs a full reindex (idempotent — safe to re-run).
- **Stats** — Approximate indexed-chunk count (from `kv_store_*.json`), query count last 24h, and average response time. Stats are tracked in a sidecar JSONL at `<project>/.bizar/memory-cache/lightrag-query-log.jsonl`.
- **Quick search** — Sends `GET /api/memory/query?q=...&topK=8` and shows the raw LightRAG response.
- **Semantic search panel** — Cross-source search: runs both LightRAG and Obsidian vault lexical search and merges results, deduped by (source, relPath).

Open the tab by setting `activeTab = 'memory'` or via the Overview's Memory status card. The LightRAG stats are fetched via `GET /api/memory/lightrag/stats`; the rebuild path uses `POST /api/memory/lightrag/rebuild-graph`.

## Common Issues

### Empty search results
Cause: index is stale or the server is down. Fix: POST to `/api/lightrag/index` to re-index.

### Server not responding
Check that LightRAG is running: `curl http://localhost:8724/status`. If not, restart with `npx lightrag-server`.
