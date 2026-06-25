# BizarHarness — Current Architecture Map (2026-06-23)

**Author:** Mimir (research session)  
**Status:** Anchored summary of codebase state  
**Scope:** Full-stack Norse-pantheon multi-agent infrastructure for opencode

---

## 1. Repository Layout

```
BizarHarness/
├── bizar/               # CLI tool (Node.js, ESM)
│   ├── bin/bizar.mjs     # Entry point (~200 lines)
│   ├── src/
│   │   ├── commands/     # Subcommand dispatch (init, export, test-gate, graph, audit, version)
│   │   ├── core/         # Agent definitions, tier routing, cost management
│   │   ├── hooks/        # Git hooks management
│   │   ├── graph/        # graphify integration (per-project knowledge graphs)
│   │   └── cli/          # CLI framework utilities
│   ├── package.json     # `@bizarharness/cli`
│   └── ...
├── bizar-dash/          # Dashboard server (Express + React)
│   ├── src/
│   │   ├── server/       # Express backend, MCP proxy, real-time SSE
│   │   ├── web/          # React frontend (Vite + Tailwind v4)
│   │   └── shared/       # Shared types
│   ├── package.json     # `@bizarharness/dashboard`
│   └── ...
├── .bizar/              # Per-project metadata (git-tracked)
│   ├── PROJECT.md        # Project overview
│   ├── AGENTS_SELF_IMPROVEMENT.md  # Agent behavior learnings
│   └── current-session.md
├── config/              # opencode.json config
│   ├── opencode.json
│   ├── AGENTS.md        # Agent definitions (Odin, Heimdall, Thor, etc.)
│   └── rules/           # Always-on coding rules by language
└── plans/               # Bizar Plan canvases (JSON-based planning system)
```

---

## 2. `bizar/` CLI — Architecture

### 2.1 Entry Point
- **File:** `bizar/bin/bizar.mjs` (~200 lines)
- Calls `registerCommands(program)` from `bizar/src/cli/framework.mjs`
- Commands registered: `init`, `export`, `test-gate`, `graph`, `audit`, `version`, `current-session`, `plan`

### 2.2 Tier Routing System (`bizar/src/core/`)

**Files:**
- `bizar/src/core/models.mjs` — Defines `AGENT_TIERS` (5 tiers), agents per tier, cost buckets, and tier-to-agent dispatch logic
- `bizar/src/core/tiers.mjs` — `TierRouter` class; selects agent based on task complexity, priority, and cost constraints
- `bizar/src/core/cost-mgmt.mjs` — Tracks per-session spend, enforces cost limits, provides cost-aware dispatch
- `bizar/src/core/presets.mjs` — Agent preset definitions (templates for agent behavior)

**Key constants:**
- Tier 1 (free): `opencode/deepseek-v4-flash-free`
- Tier 2 ($0.30/M in, $1.20/M out): `minimax/MiniMax-M2.7` (Heimdall, Baldr, Thor, Hermod)
- Tier 3 ($0.50/M in, $2.00/M out): `minimax/MiniMax-M3` (Tyr, Forseti, Odin)
- Tier 4/5: Fallback to `openai/gpt-5.5` (Vidarr — highest cost, last resort)

### 2.3 Commands

| Command | File | Purpose |
|---|---|---|
| `init` | `src/commands/init.mjs` | Scaffolds `.bizar/` directory, creates PROJECT.md |
| `export` | `src/commands/export.mjs` | Cross-harness config export |
| `test-gate` | `src/commands/test-gate.mjs` | Runs quality checks after parallel implementation |
| `graph` | `src/commands/graph.mjs` | graphify integration wrapper (build/update/status/query/path/explain) |
| `audit` | `src/commands/audit.mjs` | Security audit of agent configs |
| `version` | `src/commands/version.mjs` | Version info |
| `current-session` | `src/commands/current-session.mjs` | Session management |
| `plan` | `src/commands/plan.mjs` | Bizar Plan canvas operations |

### 2.4 Dependencies (package.json)
- Commander.js — CLI framework
- graphifyy — Knowledge graph
- Chalk — Terminal coloring
- Zod — Schema validation
- **No** external cost-management lib — in-house implementation

---

## 3. `bizar-dash/` — Dashboard Architecture

### 3.1 Backend (`bizar-dash/src/server/`)

**Entry Point:** `server/index.mjs` (~250 lines)
- Express app with CORS, compression, JSON parsing
- Serves static frontend from `dist/` in production
- Two parallel mount points:
  - `/api` — REST routes (artifacts, plans, sessions, agents)
  - `/mcp` — MCP proxy (forwards tool calls to MCP servers)

**Key Files:**

| File | Lines | Purpose |
|---|---|---|
| `routes/artifacts.mjs` | ~200 | Artifact CRUD (GET/POST/PUT/DELETE), stored as JSON on disk |
| `routes/plans.mjs` | ~350 | Bizar Plan canvas CRUD, element management, comments |
| `routes/sessions.mjs` | ~300 | Session management (background instances, state tracking) |
| `routes/chat.mjs` | ~180 | **New** — chat history persistence API |
| `routes/agents.mjs` | ~150 | Agent status and config endpoints |
| `state.mjs` | ~200 | Simple in-memory state manager (sessions store, event emitter) |
| `mcp-proxy.mjs` | ~250 | Proxies MCP tool calls from frontend to backend MCP servers |

**Plans Store (`routes/plans.mjs`):**
- Canvas state stored as JSON in `plans/<slug>/canvas.json`
- Metadata in `plans/<slug>/meta.json`
- Supports elements (notes, tasks, cards), connections, comments, replies
- Actions: get_canvas, add_element, update_element, delete_element, add_connection, delete_connection, add_comment, reply_to_comment, set_status

**Artifacts (`routes/artifacts.mjs`):**
- Stores artifacts as JSON files in a configurable directory
- Types: text, code, markdown, svg
- Full CRUD with metadata (title, type, language, tags, created/updated timestamps)

### 3.2 Frontend (`bizar-dash/src/web/`)

**Stack:** React 19 + Vite 6 + Tailwind CSS v4

**Entry point:** `web/main.tsx` — mounts `<App />` with React Router

**App (`web/App.tsx`):**
- React Router v7 with routes:
  - `/` → Home/Overview dashboard
  - `/artifacts` → Artifact browser
  - `/artifacts/:id` → Single artifact view
  - `/plans` → Plan list
  - `/plans/:slug` → Bizar Plan canvas (whiteboard-style)
  - `/agents` → Agent status and management
  - `/chat` → Chat view (new)

**Key UI Components:**
- `Sidebar.tsx` — Navigation sidebar
- `PlansDashboard.tsx` — Plan list and management
- `PlanCanvas.tsx` — Canvas whiteboard with drag-drop elements, connections
- `ArtifactEditor.tsx` — Code/markdown editor (likely CodeMirror or Monaco)
- `ArtifactViewer.tsx` — Read-only artifact display
- `HomeDashboard.tsx` — Overview with status cards

**State Management:** React context providers for:
- Plans state (PlanProvider)
- Artifacts state (ArtifactProvider)
- Session/agent state

### 3.3 Real-Time Communication

The dashboard uses **Server-Sent Events (SSE)** for real-time updates:
- Agent logs streamed to frontend
- Background instance status updates
- Plan canvas collaboration events

No WebSocket — SSE is simpler and sufficient for one-directional streaming.

### 3.4 Build & Dev

- **Dev:** `vite --port <n>` (frontend dev server, proxies API to Express)
- **Production:** `vite build` → Express serves `dist/`
- Tailwind v4 with `@import "tailwindcss"` (CSS-first config, no `tailwind.config.js`)

---

## 4. Agent System & Routing

### 4.1 Agent Tiers (defined in `config/AGENTS.md`)

| Agent | Tier | Model | Role |
|---|---|---|---|
| Odin | Tier 3 | MiniMax M3 | Orchestrator — decomposes and dispatches work |
| Frigg | Tier 1 | DeepSeek V4 Flash (free) | Read-only Q&A |
| Vör | Tier 1 | DeepSeek V4 Flash (free) | Clarification |
| Mimir | Tier 1 | DeepSeek V4 Flash (free) | Research & exploration |
| Heimdall | Tier 2 | MiniMax M2.7 | Simple tasks, mechanical work |
| Baldr | Tier 2 | MiniMax M2.7 | Design system, visual audits |
| Thor | Tier 2 | MiniMax M2.7 | Moderate implementation |
| Hermod | Tier 2 | MiniMax M2.7 | Git & GitHub operations |
| Tyr | Tier 3 | MiniMax M3 | Complex implementation |
| Forseti | Tier 3 | MiniMax M3 | Plan auditing (read-only) |
| Vidarr | Tier 4/5 | GPT-5.5 | Ultimate fallback |

### 4.2 Routing Flow
1. User sends request → Odin classifies complexity
2. Odin may dispatch to subagents via `task` tool
3. For Tier 4/5 work: plan → Forseti audit → execute
4. Results are synthesized by Odin

### 4.3 Parallel Execution
- Odin launches 2+ agents in parallel for independent work
- Each agent gets a file scope; shared git repo discipline enforced
- Lockfile, root config, and git rules prevent conflicts
- Only Hermod performs write-level git

---

## 5. Skill System

- **CLI:** `npm install -g skills` → `skills add <owner/repo>`
- Skills installed at `~/.opencode/skills/<name>/SKILL.md`
- Domain-specific repos: `vercel-labs/agent-skills`, `supabase/agent-skills`, `mattpocock/skills`, etc.
- Agents must load relevant skills before writing code

---

## 6. Hindsight Memory System

- MCP server for persistent memory
- Per-project banks (not a single default bank)
- Standard sequence: list_banks → recall → retain → create_mental_model
- Current project bank: `BizarHarness`

---

## 7. Graph System (graphify)

- Per-project knowledge graphs stored in `.bizar/graph/`
- Commands: `bizar graph {status,query,path,explain,update,build,watch}`
- Nodes: functions, classes, modules, concepts
- Edges: calls, uses, extends, implements
- Communities: module-level clusters

---

## 8. Key Patterns & Conventions

1. **ESM throughout** — Both CLI and dashboard use ES modules exclusively (no CommonJS)
2. **Domain per file** — Each route/handler in its own file under `server/routes/`
3. **JSON file storage** — Plans, artifacts, and state use JSON-on-disk (no database)
4. **React context providers** — Per-domain state management (plans, artifacts, sessions)
5. **SSE over WebSocket** — Simpler for unidirectional streaming
6. **In-memory state manager** — `state.mjs` with event emitter for cross-component coordination
7. **Tailwind v4 CSS-first config** — No `tailwind.config.js`, uses `@import "tailwindcss"`

---

## 9. Open Questions / Next Steps

1. **Dashboard chat route** — Why does `routes/chat.mjs` exist but there's no `/chat` frontend route yet? Is it being built or was it archived?
2. **Error boundaries** — Not visible in App.tsx; needs checking
3. **SSR** — Vite-spa template; no SSR needed
4. **Authentication** — No auth middleware visible; designed for local/dev use
5. **WebSocket plans** — No WebSocket library in deps; SSE only
6. **Offline/loading states** — Not handled in the components viewed; likely needs React.Suspense + error boundaries
7. **MCP proxy security** — Forwarding tool calls from browser to MCP servers needs auth review
8. **Agent session isolation** — Background instances share process context; no sandboxing
9. **Test coverage** — No test files found in bizar-dash; CLI has `test-gate` command but test implementation not discovered
10. **D1 database usage** — Not connected yet; D1 SDK is in deps but no database integration found
