# Raw Research Notes — 2026-06-23

## Project roots
- Package.json in `bizar/` → `@bizarharness/cli`
- Package.json in `bizar-dash/` → `@bizarharness/dashboard`
- Root `package.json` exists but project seems earlier-stage

## CLI layer
- Entry: `bizar/bin/bizar.mjs` → commander setup
- Framework: `bizar/src/cli/framework.mjs`
- Local import pattern: `#core/...` mapped in `imports` in package.json
- Zod for config validation, Chalk for colors, graphifyy for graphing
- Eight commands: init, export, test-gate, graph, audit, version, current-session, plan
- Tier routing: models.mjs (agent definitions), tiers.mjs (dispatch), cost-mgmt.mjs (budget)

## Dashboard server
- Express app at `bizar-dash/src/server/index.mjs`
- Two mount paths: /api and /mcp
- Routes: artifacts, plans, sessions, chat, agents
- State management: simple in-memory with EventEmitter
- MCP proxy: proxies tool calls from frontend to backend MCP servers

## Plans system
- `routes/plans.mjs` — full CRUD for canvas elements
- JSON-on-disk: `plans/<slug>/canvas.json` + `meta.json`
- Elements: notes, tasks, cards
- Connections between elements
- Comments with reply threads
- Plan status: draft, approved, rejected, in-progress, done
- Wait-for-feedback: polling loop

## Artifacts
- `routes/artifacts.mjs` — CRUD stored as JSON files
- Types: text, code, markdown, svg
- Timestamps, metadata, full history

## Chat route
- `routes/chat.mjs` — exists but no frontend route yet
- GET /api/chat, POST /api/chat, GET /api/chat/:id, DELETE /api/chat/:id
- No SSE for chat streaming visible
- Seems like pre-built backend waiting for frontend

## Sessions
- `routes/sessions.mjs` — background agent instances
- Spawn/kill/status/collect lifecycle
- Persistent agents with auto-restart

## Frontend
- React 19 + Vite 6 + Tailwind v4
- React Router v7
- Routes: /, /artifacts, /artifacts/:id, /plans, /plans/:slug, /agents, /chat
- Context providers: plans, artifacts, session
- Components: Sidebar, PlansDashboard, PlanCanvas, ArtifactEditor, ArtifactViewer, HomeDashboard
- No error boundaries visible
- No loading/empty/error states in viewed components

## Agents
- 11 agents across 4 cost tiers
- Tier definitions in config/AGENTS.md and bizar/src/core/models.mjs
- Routing logic in tiers.mjs
- Cost tracking in cost-mgmt.mjs

## Skills
- 90+ skills installed
- CLI-based: `skills add <owner/repo>`
- Categorized by domain (frontend, backend, testing, design, etc.)

## Hindsight
- MCP server for memory
- Per-project banks
- Standard: list → recall → retain → create_mental_model
- Current bank: BizarHarness

## Graph system
- graphify integration via `bizar graph` commands
- Per-project graphs in `.bizar/graph/`
- Supports status, query, path, explain, update, build, watch
- Git-ignored: cache, per-machine interpreter path

## Gaps found
1. Tests: none found in bizar-dash; test-gate exists but test framework not discovered
2. Error handling: no error boundaries in frontend
3. Auth: none
4. Chat frontend: backend exists, no frontend route
5. D1 usage: SDK in deps, no integration found
6. Session isolation: background instances share process context
7. SSE: event streaming works but no compression/backpressure handling visible
8. MCP proxy: no auth on tool forwarding
