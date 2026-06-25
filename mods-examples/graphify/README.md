# Graphify Mod for BizarHarness

Interactive knowledge-graph view of your project, embedded directly in
the BizarHarness dashboard.

## What it does

- Builds a structural map of your project (modules, functions, types,
  imports, call sites) via the [graphify](https://github.com/safishamsi/graphify)
  Python tool.
- Renders the result as an interactive vis-network visualization
  (`graph.html`) — click nodes, search, filter by community.
- **Code-only build works offline**, with no LLM key required
  (AST extraction via tree-sitter + AST-cache fallback).
- **Full build** when you set `GEMINI_API_KEY`, `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, etc. — adds LLM-powered relationship extraction
  across docs and code.

## Install

```bash
bizar mod install graphify
bizar dash start --bg   # restart dashboard to pick up the new tab
```

The "Graph" tab appears in the dashboard topbar with a Network icon.

## Usage

In the dashboard, click the **Graph** tab. If the graph hasn't been
built yet, click the **Build graph** button. The build runs detached;
you can watch progress in the dashboard's "Activity" tab. When done,
the graph.html iframe loads automatically.

CLI equivalent:

```bash
bizar graph status
bizar graph build              # full build (uses LLM if key set)
bizar graph update             # incremental rebuild
bizar graph query "<term>"     # query the graph
bizar graph path "A" "B"       # shortest path between two nodes
bizar graph explain "X"        # all nodes related to X
```

## Configuration

Set these in `~/.config/bizar/settings.json` under
`mods.graphify.config`:

| Key | Type | Default | Description |
|---|---|---|---|
| `autoBuildOnOpen` | boolean | false | Run `bizar graph build` when the dashboard opens (only if no graph exists yet). |

## Permissions

The mod requires:

- `fs:read:.bizar/graph` — read graph.html + graph.json from the project
- `process:spawn:bizar` — spawn `bizar graph build` subprocesses

## Files

```
graphify/
├── mod.json          # manifest (id, version, entry points, permissions)
├── README.md         # this file
└── route.mjs         # Express router; mounted at /api/mods/graphify
```

## Troubleshooting

- **`graph.html not found` after build** — the build succeeded but the
  graphify-out/ cluster step didn't promote its outputs. Run
  `bizar graph build` again from the CLI; the cmdBuild flow in `cli/graph.mjs`
  handles this automatically.
- **`ANTHROPIC_API_KEY` errors** — graphify's semantic step uses
  Anthropic. Either set the key (full extraction) or let the offline
  fallback handle it (code-only).
- **Stuck "build failed" job** — check the log at
  `~/.cache/bizar/graph-logs/graph-build-<jobId>.log`.