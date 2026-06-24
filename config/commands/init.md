---
description: Run bizar init to detect project stack, install relevant skills, and create .bizar/PROJECT.md.
agent: heimdall
---
Run `bizar init` from the project root to:
1. Detect the project stack (language, framework, database, tools)
2. Install relevant skills from the opencode skills registry
3. Create `.bizar/PROJECT.md` with stack and conventions
4. Create `.bizar/AGENTS_SELF_IMPROVEMENT.md` (only if missing)
5. Build the per-project knowledge graph in `.bizar/graph/` (powered by graphify; skipped gracefully if graphify is not installed)

After `bizar init` succeeds, run `bizar graph status` to confirm the graph exists.

If the graph is missing after init, graphify is likely not installed. Tell the user to install it with one of:
- `pip install graphifyy`
- `pipx install graphifyy`
- `uv tool install graphifyy`

Then run `bizar graph build` to populate `.bizar/graph/`.

Query the graph at any time with:
- `bizar graph query "<concept>"` — find nodes related to a concept
- `bizar graph path "<A>" "<B>"` — shortest path between concepts
- `bizar graph explain "<X>"` — all nodes related to X

Update the graph incrementally with `bizar graph update` after editing source files.
