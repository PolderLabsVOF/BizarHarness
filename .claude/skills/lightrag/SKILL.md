---
name: lightrag-instructions
description: Always-on rules for the LightRAG mod. When the LightRAG server is running, prefer the knowledge graph for cross-document questions before re-reading source files. Triggers on questions where LightRAG should be queried (cross-document semantic questions, entity/relationship lookups) instead of grep-style searches.
---

# LightRAG — Installed Instructions

These rules apply whenever the **lightrag** mod is enabled and the LightRAG server is running (default port 9621).

## What is LightRAG?

LightRAG is a graph-based Retrieval-Augmented Generation system. It builds a knowledge graph from ingested documents and answers questions by traversing entities and relationships, not just keyword-matching chunks.

The Bizar dashboard exposes a LightRAG view at `/lightrag` that lets you:
- Insert documents (text, file paths, URLs)
- Query the knowledge graph (5 modes: local, global, hybrid, naive, mix)
- Inspect entities and relationships
- See query history

The HTTP server runs at `http://127.0.0.1:9621` by default. The Bizar dashboard talks to it via the REST API.

## When to Use LightRAG (vs grep / Semble)

**Use LightRAG for:**
- "What does this codebase say about X?" (semantic, not literal)
- "What entities relate to Y?" (graph traversal)
- "Summarize all documentation about Z"
- "Find all decisions made about authentication"
- Any cross-document question where grep would give 30+ results

**Use grep / Semble for:**
- Single-line, single-file lookups
- "Does the string `TODO` exist?"
- "Where is function X defined?"

**Use Semble for:**
- Code-aware semantic search
- "What calls function X?" (with file:line)
- "Find the line that handles auth"

LightRAG is for **natural-language questions about content**, not code structure.

## Rules by Agent

### @mimir (research)
- Before deep-diving into a research question with 20+ tool calls, query the LightRAG knowledge graph first: `POST /query` with the question text. The graph often points you at the right document in 1-2 calls.
- If LightRAG returns no results, fall back to Semble and grep. Don't force-fit results.
- After running any new document through LightRAG, the graph updates — query again to see the new context.

### @frigg (Q&A)
- When the user asks a project-specific question that grep can't answer (e.g. "what did we decide about X?"), check LightRAG first via `POST /query` with the question as the query text.
- LightRAG returns retrieved context with the answer. Use that as the basis for the response.

### @odin (router)
- After completing a piece of work that produced documentation (decisions, postmortems, ADRs), consider whether the content should be ingested into LightRAG. If yes, call the dashboard's `/api/mods/lightrag/insert` with the file path.

## API quick reference

```
POST /query              — body: { query: string, mode: "mix" | "local" | "global" | "hybrid" | "naive" }
POST /insert/text        — body: { text: string, id?: string }
POST /insert/file        — body: { path: string }   (file is read and ingested)
GET  /entities            — list entities
GET  /relations           — list relationships
GET  /status              — server health + counts
```

All endpoints are at `http://127.0.0.1:9621` (or via the dashboard at `/api/mods/lightrag/proxy/*`).

## Common pitfalls

- **Embedding model must be set before indexing.** If you change it, re-embed all text chunks, entities, and relationships. (LightRAG does not provide a re-embedding tool.)
- **Vector dimension depends on the embedding model.** Some storage backends (e.g. PostgreSQL) require the vector dimension to be defined when creating tables. If you change the embedding model, you may need to drop and recreate the vector tables.
- **The server binds to 127.0.0.1 by default.** The dashboard proxies requests to it. If you want to access LightRAG from outside the host, set `host: 0.0.0.0` in the mod config.
- **First query is slow** (~3s) because the graph cache is cold. Subsequent queries are faster.

## See also

- LightRAG docs: https://github.com/HKUDS/LightRAG
- Bizar mod guide: `.obsidian/reference/mods.md`
- Dashboard mod config: `Settings → Mods → LightRAG`
