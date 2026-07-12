# PLAN.md — Dashboard v8 Rewrite (Implementation Plan)

> Companion to `DESIGN.md`. This document covers **how** we build the
> rewrite; the design doc covers **what** it looks like. Read both
> together. Scope: complete deletion of the v7 dashboard (F-040 + F-041)
> and greenfield build of v8 in its place.

---

## Table of contents

1. [Goals & non-goals](#1--goals--non-goals)
2. [Architecture decisions](#2--architecture-decisions)
3. [Tech stack](#3--tech-stack)
4. [File structure](#4--file-structure)
5. [Component library breakdown](#5--component-library-breakdown)
6. [Data model & API surface](#6--data-model--api-surface)
7. [Routing](#7--routing)
8. [State management](#8--state-management)
9. [Real-time updates](#9--real-time-updates)
10. [Theme system](#10--theme-system)
11. [Settings model](#11--settings-model)
12. [Migration / deletion of old dashboard](#12--migration--deletion-of-old-dashboard)
13. [Phased implementation plan](#13--phased-implementation-plan)
14. [Sprint schedule](#14--sprint-schedule)
15. [Testing strategy](#15--testing-strategy)
16. [Integration with Bizar harness](#16--integration-with-bizar-harness)
17. [Risks & open questions](#17--risks--open-questions)

---

## 1 · Goals & non-goals

### Goals

1. **Replace v7 dashboard with a clean v8** built around the shadcn
   preset `b7kBsBkh7b` and the user-supplied OKLch theme.
2. **Ship a custom component library** at `bizar-dash/src/web/ui/`
   with 100+ primitives, controls, feedback, data, navigation,
   kanban, and popup components.
3. **Topbar + sidebar shell** with six top-level nav groups and
   hierarchical sub-routes.
4. **Kanban-first experience** — drag-and-drop, filters, group-by,
   sort, density toggle, keyboard shortcuts, right-click context
   menus on every card.
5. **Long-horizon goal tracking** as a first-class page with progress
   visualization, milestones, and goal→task breakdown.
6. **Right-click context menus everywhere** — no browser defaults on
   interactive surfaces, no `window.confirm` / `window.alert` /
   `window.prompt`.
7. **Command palette (Cmd+K)** with three scopes: Actions, Navigate,
   Settings.
8. **Hierarchical settings** with 16 sections, each with auto-saving
   fields and Cmd+K discoverability.
9. **Real-time updates** via the existing WebSocket feed (no new
   transport).
10. **Power-user density** by default, with a comfortable toggle.

### Non-goals (v8.0)

- No mobile native apps. Mobile web is responsive but desktop-first.
- No new backend endpoints. We consume the existing REST + WS surface.
- No new MCP tools. We surface existing tool outputs only.
- No auth/identity changes. Single-user local dashboard for now.
- No telemetry/analytics. Optional later via opt-in settings.
- No plugin/theme marketplace. Internal-only.
- No multi-tenant workspace switching UI (the data model supports it
  via `workspace_id`, but the UI ships single-workspace for v8.0).

---

## 2 · Architecture decisions

| # | Decision | Why | Alternatives considered |
|--|--|--|--|
| AD-01 | **Delete the entire `bizar-dash/` v7 code, rebuild from scratch.** | The v7 design system (F-040) and mobile pass (F-041) conflict with the new aesthetic (green accent, no Norse dark mode, no gradients, gradient-free). Incremental migration would carry old patterns forward. | (a) Incremental rewrite (rejected: mixes generations). (b) Side-by-side `bizar-dash-v8/` (rejected: two trees to maintain). |
| AD-02 | **Use shadcn preset `b7kBsBkh7b` as bootstrap.** | User-specified. The preset ships OKLch tokens + Tailwind config matching the supplied theme. | Custom Tailwind config (rejected: reinvents the wheel). |
| AD-03 | **TanStack Router for routing.** | Type-safe routes, file-based or code-based, built-in loader/action model, first-class search-param typing. The settings tree, kanban filters, and goal detail views all benefit. | React Router (rejected: weaker type safety). |
| AD-04 | **TanStack Query for server state.** | Already in the Bizar ecosystem; cache invalidation on WS events is first-class; optimistic mutations are idiomatic. | SWR (rejected: weaker mutation story). Redux Toolkit Query (rejected: heavier, no use). |
| AD-05 | **Zustand for local UI state.** | Sidebar collapse, density mode, palette open/close, theme — small, fast, no boilerplate. | React Context only (rejected: prop drilling for cross-cutting state). Jotai (rejected: atoms too granular). |
| AD-06 | **dnd-kit for drag-and-drop.** | Accessible by default (keyboard sensors, screen-reader announcements), `useDraggable`/`useDroppable` are the right primitive for kanban, `restrictToVerticalAxis` for column drag, `DragOverlay` for the floating card. | react-beautiful-dnd (rejected: unmaintained). Native HTML5 DnD (rejected: accessibility nightmare). |
| AD-07 | **TanStack Table for the kanban's tabular view.** | Headless, sortable, filterable, virtualizable, supports row selection and column resize — all the power-user table features without imposing UI. | AG Grid (rejected: heavy, license-gated). |
| AD-08 | **Recharts for charts.** | Already used in v7. SVG-based, themeable via tokens, sufficient for our chart needs (line, bar, area, pie, sparkline). | Visx (rejected: too low-level for our time budget). D3 (rejected: hand-rolled charts cost more than they save). ECharts (rejected: not React-native). |
| AD-09 | **cmdk for the command palette.** | Used by Linear, Raycast, Vercel — the same UX we want. | Headless combobox (rejected: rebuild what cmdk already does). |
| AD-10 | **Radix UI primitives under every interactive component.** | Accessibility is solved (focus management, keyboard nav, ARIA), behavior is unstyled, theming is via our tokens. | Headless UI (rejected: smaller primitive set). React Aria (rejected: harder to compose). |
| AD-11 | **React Hook Form + Zod for forms.** | Already in the Bizar ecosystem. Schema-first validation matches our MCP tool registration. | Formik (rejected: legacy). |
| AD-12 | **date-fns for date math.** | Tree-shakeable, immutable, locale-aware. Used by the kanban and goal views. | Day.js (rejected: OOP-style chains, less composable). Luxon (rejected: heavier). |
| AD-13 | **No Tailwind in `ui/`.** | All `ui/` components consume CSS variables only. Tailwind utility classes are used at the page/view layer to compose components, never inside `ui/` itself. | (a) Tailwind everywhere (rejected: leaks utility classes into primitives). (b) CSS-in-JS (rejected: runtime cost). |
| AD-14 | **No CSS modules, no styled-components.** | Plain CSS files co-located with each component (`Button.tsx` + `Button.css`). Tokens are global. | CSS Modules (rejected: heavier, same outcome). |
| AD-15 | **No state-management library inside `ui/`.** | `ui/` is presentational. All data, WS, and mutation logic lives in `views/`, `hooks/`, and `stores/`. | (a) Allow data in `ui/` (rejected: leaks, untestable in isolation). |
| AD-16 | **Single WebSocket connection.** | All live data flows over `/ws/dashboard`. Per-feature subscriptions multiplexed via message-type discrimination. | (a) One WS per feature (rejected: connection overhead). (b) SSE (rejected: one-way). |
| AD-17 | **No new dependencies unless justified.** | The Bizar harness is conservative on deps. Each new dep must be approved in a sprint contract. | — |


---

## 3 · Tech stack

### Runtime

| Layer | Choice | Version |
|--|--|--|
| Build | Vite | 5+ |
| Language | TypeScript (strict) | 5.5+ |
| UI framework | React | 19 |
| Routing | TanStack Router | 1.x |
| Server state | TanStack Query | 5.x |
| UI state | Zustand | 4.x |
| Forms | React Hook Form + Zod | latest |
| DnD | dnd-kit | 6.x |
| Tables | TanStack Table | 8.x |
| Virtualization | TanStack Virtual | 3.x |
| Charts | Recharts | 2.x |
| Date | date-fns | 3.x |
| Icons | lucide-react | latest |
| Toasts | sonner | 1.x |
| Command palette | cmdk | 0.2.x |
| Primitives | Radix UI | latest |
| Class merge | clsx + tailwind-merge | latest |

### Why no Tailwind inside `ui/`

Tailwind utility classes leak implementation details. If a future
maintainer changes `Button.tsx` and removes a class, there's no
compiler error — just a silent regression. Co-located plain CSS
keeps the surface tight and reviewable.

### pnpm workspaces

The dashboard lives in `bizar-dash/` and shares the root
`pnpm-workspace.yaml`. All third-party deps are pinned at the root
in `pnpm-lock.yaml`.

---

## 4 · File structure

```
bizar-dash/
├── DESIGN.md              # this rewrite's design system
├── PLAN.md                # this file
├── ARCHITECTURE.md        # module-level doc (rewritten for v8)
├── CONSTRAINTS.md         # module-level rules
├── README.md              # developer quick-start
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
├── playwright.config.ts   # visual + keyboard E2E
├── public/
│   ├── favicon.svg
│   └── fonts/             # Inter + JetBrains Mono subsets
├── scripts/
│   ├── check-design-tropes.sh   # banned-pattern audit (§12 DESIGN)
│   ├── check-arch.sh            # moved from repo root
│   └── test-in-container.sh
├── src/
│   ├── server/                  # unchanged from v7 (REST + WS)
│   │   ├── api.mjs
│   │   ├── ws.mjs
│   │   └── routes/
│   ├── web/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── routes.tsx
│   │   ├── lib/
│   │   │   ├── ws.ts                  # WS singleton + typed subscribe
│   │   │   ├── api.ts                 # typed fetch wrapper
│   │   │   ├── query-client.ts        # TanStack Query setup
│   │   │   └── types.ts               # shared TS types
│   │   ├── stores/
│   │   │   ├── theme.ts
│   │   │   ├── density.ts
│   │   │   ├── palette.ts             # Cmd+K open state
│   │   │   ├── sidebar.ts             # collapse state
│   │   │   └── selection.ts           # current kanban/agents selection
│   │   ├── ui/                        # the library (no business logic)
│   │   │   ├── index.ts               # barrel
│   │   │   ├── primitives/
│   │   │   ├── controls/
│   │   │   ├── feedback/
│   │   │   ├── data/
│   │   │   ├── navigation/
│   │   │   ├── kanban/
│   │   │   ├── popups/
│   │   │   ├── theme/
│   │   │   ├── hooks/
│   │   │   ├── utils/
│   │   │   └── styles/
│   │   │       ├── reset.css
│   │   │       ├── tokens.css         # generated from §3 DESIGN
│   │   │       └── globals.css
│   │   ├── views/
│   │   │   ├── Overview/
│   │   │   ├── Tasks/
│   │   │   ├── Goals/
│   │   │   ├── Agents/
│   │   │   ├── Activity/
│   │   │   ├── Memory/
│   │   │   ├── Libraries/
│   │   │   └── Settings/
│   │   ├── icons/                     # domain icons
│   │   └── shell/                     # AppShell + Topbar + Sidebar
│   │       ├── AppShell.tsx
│   │       ├── Topbar.tsx
│   │       ├── Sidebar.tsx
│   │       └── StatusBar.tsx
│   └── shared/
│       └── tokens.json          # source of truth for tokens.css
└── tests/
    ├── unit/                    # vitest
    │   ├── ui/                  # per-component
    │   └── views/               # per-view
    ├── e2e/                     # playwright
    │   ├── smoke.spec.ts
    │   ├── keyboard.spec.ts
    │   └── visual.spec.ts
    └── a11y/                    # axe-core
```


---

## 5 · Component library breakdown

The full inventory lives in DESIGN.md §8. This section is the
**build order** — which components ship in which sprint.

### Wave 1 — Foundation (Sprint 1)

Tokens, theme, layout shell, and the 11 primitives. Everything else
depends on these.

- `ui/styles/{reset,tokens,globals}.css`
- `ui/theme/{ThemeProvider,ThemeToggle,DensityProvider,useTheme,useDensity}.tsx`
- `ui/primitives/*` (11 components)
- `shell/{AppShell,Topbar,Sidebar,StatusBar}.tsx`

### Wave 2 — Controls & feedback (Sprint 2)

Buttons, inputs, dialogs, popovers — the bulk of the form system.

- `ui/controls/*` (20 components)
- `ui/feedback/*` (16 components)
- `ui/utils/{cx,formatters,useHotkeys,useFocusTrap,useMediaQuery,useReducedMotion,useDebouncedValue,useLocalStorage}.ts`

### Wave 3 — Data display (Sprint 3)

Cards, tables, charts, avatars, badges — everything for showing
information.

- `ui/data/*` (24 components)

### Wave 4 — Navigation (Sprint 4)

Sidebar/nav wiring, tabs, menus, command palette, pagination.

- `ui/navigation/*` (23 components)
- `ui/popups/*` (8 components)
- `stores/{palette,sidebar,selection}.ts`

### Wave 5 — Kanban (Sprint 5)

The centerpiece. Card, column, board, filters, group-by, sort,
density, context menu, drag overlay, detail drawer.

- `ui/kanban/*` (15 components)
- `hooks/useTasks.ts` (query + mutations)
- `views/Tasks/*`

### Wave 6 — Views (Sprint 6-8)

Overview, Goals, Agents, Activity, Memory, Libraries, Settings —
one sprint per major view.

### Wave 7 — Polish (Sprint 9)

Empty states, error states, motion audit, accessibility audit,
keyboard walkthrough, visual regression, banned-trope scan.


---

## 6 · Data model & API surface

The dashboard consumes the existing REST + WS surface. No new
endpoints in v8. The data model is documented per-view in
`views/<name>/README.md`.

### 6.1 Core entities

```ts
// Shared types — src/web/lib/types.ts

type ID = string;        // UUID v4 or short slug
type ISODate = string;   // ISO-8601 UTC
type Priority = 'p0' | 'p1' | 'p2' | 'p3' | 'p4';
type Status = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';

interface Task {
  id: ID;
  workspace_id: ID;
  project_id: ID;
  title: string;
  description?: string;
  status: Status;
  priority: Priority;
  assignee_agent_id?: ID;
  labels: string[];
  due_at?: ISODate;
  estimate_min?: number;
  parent_goal_id?: ID;
  parent_task_id?: ID;
  created_at: ISODate;
  updated_at: ISODate;
}

interface Goal {
  id: ID;
  workspace_id: ID;
  title: string;
  description?: string;
  cadence: 'weekly' | 'monthly' | 'quarterly' | 'annual';
  progress_pct: number;          // 0..100, derived from task weights
  milestones: Milestone[];
  task_ids: ID[];
  status: 'active' | 'paused' | 'completed' | 'archived';
  review_at?: ISODate;
  created_at: ISODate;
  updated_at: ISODate;
}

interface Agent {
  id: ID;
  type: 'coder' | 'tester' | 'reviewer' | 'system-architect'
      | 'planner' | 'researcher' | 'performance-engineer'
      | 'security-auditor' | 'memory-specialist';
  display_name: string;
  status: 'idle' | 'busy' | 'offline' | 'errored';
  current_task_id?: ID;
  tokens_used: number;
  cost_usd: number;
  registered_at: ISODate;
  last_active_at: ISODate;
}

interface ActivityEvent {
  id: ID;
  workspace_id: ID;
  type: 'task_created' | 'task_updated' | 'task_completed'
      | 'agent_spawned' | 'agent_terminated' | 'routing_decision'
      | 'cost_reserved' | 'cost_committed' | 'memory_distilled'
      | 'consensus_proposed' | 'goal_progress' | 'system';
  actor: { kind: 'user' | 'agent' | 'system'; id?: ID };
  target?: { kind: 'task' | 'goal' | 'agent' | 'memory'; id: ID };
  payload: Record<string, unknown>;
  created_at: ISODate;
}
```

### 6.2 REST endpoints (consumed, unchanged)

| Method | Path | Purpose |
|--|--|--|
| GET | `/api/tasks` | List tasks (filters: `?status=&assignee=&label=`) |
| POST | `/api/tasks` | Create task |
| PATCH | `/api/tasks/:id` | Update task |
| DELETE | `/api/tasks/:id` | Archive task |
| POST | `/api/tasks/reorder` | Move task across columns |
| GET | `/api/goals` | List goals |
| POST | `/api/goals` | Create goal |
| PATCH | `/api/goals/:id` | Update goal |
| GET | `/api/agents` | List agents |
| GET | `/api/activity?since=` | Activity events since timestamp |
| GET | `/api/memory?q=` | Memory search |
| GET | `/api/distill/patterns` | Distilled patterns |
| GET | `/api/cost/status` | Cost gate status |
| GET | `/api/routing/decisions?limit=` | Recent routing decisions |
| GET | `/api/skills` | Skills |
| GET | `/api/mcps` | MCP servers |
| GET | `/api/hooks` | Hook config |
| GET/PATCH | `/api/settings/:section` | Settings CRUD |

### 6.3 WebSocket messages (consumed, unchanged)

| Type | Direction | Payload |
|--|--|--|
| `tasks:change` | server→client | `{ task: Task }` |
| `tasks:delete` | server→client | `{ id: ID }` |
| `agents:change` | server→client | `{ agent: Agent }` |
| `goals:change` | server→client | `{ goal: Goal }` |
| `activity:event` | server→client | `{ event: ActivityEvent }` |
| `routing:decision` | server→client | `{ decision: RoutingDecision }` |
| `cost:tick` | server→client | `{ reservation: CostReservation }` |
| `system:status` | server→client | `{ health, version, build }` |

### 6.4 Settings payload (v8)

Settings are stored under `/api/settings/:section`. v8 adds the
following sections: `general`, `appearance`, `agents`, `goals`,
`tasks`, `skills`, `mcps`, `hooks`, `routing`, `memory`,
`notifications`, `security`, `integrations`, `billing`, `team`,
`advanced`. Each is a Zod-validated object; the server rejects
unknown keys.

---

## 7 · Routing

### 7.1 Route tree (TanStack Router, code-based)

```ts
// src/web/routes.tsx
const rootRoute = createRootRoute({ component: AppShell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: OverviewPage,
});

const tasksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'tasks',
  component: TasksLayout,
});

const tasksIndex = createRoute({
  getParentRoute: () => tasksRoute,
  path: '/',
  component: TasksKanban,    // default view
  validateSearch: z.object({
    group: z.enum(['status', 'assignee', 'label', 'priority', 'due', 'project']).optional(),
    assignee: z.string().optional(),
    label: z.string().optional(),
    q: z.string().optional(),
  }),
});

const tasksListRoute = createRoute({
  getParentRoute: () => tasksRoute,
  path: 'list',
  component: TasksList,
});

const tasksCalendarRoute = createRoute({
  getParentRoute: () => tasksRoute,
  path: 'calendar',
  component: TasksCalendar,
});

// ... goals, agents, activity, memory, libraries, settings ...

const routeTree = rootRoute.addChildren([
  indexRoute,
  tasksRoute.addChildren([tasksIndex, tasksListRoute, tasksCalendarRoute]),
  // ...
]);
```

### 7.2 Route guards

- `/settings/*` requires `localStorage.bizar_workspace_id` to be set;
  otherwise redirects to `/setup`.
- `/agents/:id` validates `:id` is a valid agent id; otherwise 404.
- All other routes are open.

### 7.3 Search params

Each route that supports filters declares a `validateSearch` Zod
schema. Filters survive reloads via URL state. The kanban view
serializes its filters into the URL so a deep link reproduces the
exact view.

---

## 8 · State management

### 8.1 Server state (TanStack Query)

```ts
// src/web/lib/query-client.ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
```

Query keys are namespaced: `['tasks']`, `['tasks', filters]`,
`['goals']`, `['agents']`, `['activity', since]`, `['settings', section]`.

WS events invalidate the relevant keys:

```ts
ws.on('tasks:change', () => {
  queryClient.invalidateQueries({ queryKey: ['tasks'] });
});
```

### 8.2 UI state (Zustand)

Stores live at `src/web/stores/`. Each store is a single Zustand
slice with no nested state.

```ts
// stores/palette.ts
interface PaletteState {
  open: boolean;
  scope: 'actions' | 'navigate' | 'settings';
  toggle: () => void;
  setScope: (scope: PaletteState['scope']) => void;
}
```

Other stores: `theme`, `density`, `sidebar` (collapsed), `selection`
(current kanban/agents selection for bulk actions).

### 8.3 Form state (React Hook Form)

Forms auto-save on blur; explicit save button is reserved for
multi-field forms in settings. Schema is Zod, error rendering uses
`react-hook-form`'s `formState.errors` mapped to `Field`'s error slot.

### 8.4 URL state (TanStack Router search params)

Anything filterable lives in the URL. The kanban view's group,
assignee, label, and search query are all in the URL.


---

## 9 · Real-time updates

### 9.1 WS singleton

```ts
// src/web/lib/ws.ts
class DashboardWS {
  private ws: WebSocket | null = null;
  private listeners = new Map<string, Set<(payload: unknown) => void>>();
  private status: 'connecting' | 'open' | 'reconnecting' | 'closed' = 'closed';
  private reconnectAttempts = 0;

  connect() {
    if (this.ws) return;
    this.status = 'connecting';
    this.ws = new WebSocket('/ws/dashboard');
    this.ws.onopen = () => { this.status = 'open'; this.reconnectAttempts = 0; };
    this.ws.onclose = () => {
      this.status = 'closed';
      const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts++);
      setTimeout(() => this.connect(), delay);
    };
    this.ws.onmessage = (event) => {
      const { type, payload } = JSON.parse(event.data);
      this.listeners.get(type)?.forEach((cb) => cb(payload));
      this.listeners.get('*')?.forEach((cb) => cb({ type, payload }));
    };
  }

  on(type: string, cb: (payload: unknown) => void): () => void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(cb);
    this.listeners.set(type, set);
    return () => set.delete(cb);
  }

  getStatus() { return this.status; }
}

export const ws = new DashboardWS();
```

### 9.2 Hook

```ts
// src/web/ui/hooks/useWebSocket.ts
export function useWebSocket<T>(
  type: string,
  handler: (payload: T) => void,
) {
  useEffect(() => {
    ws.connect();
    return ws.on(type, handler as (p: unknown) => void);
  }, [type, handler]);
}
```

### 9.3 Cache invalidation pattern

```ts
// src/web/lib/ws-invalidate.ts
ws.on('tasks:change', () => queryClient.invalidateQueries({ queryKey: ['tasks'] }));
ws.on('tasks:delete', () => queryClient.invalidateQueries({ queryKey: ['tasks'] }));
ws.on('agents:change', () => queryClient.invalidateQueries({ queryKey: ['agents'] }));
ws.on('goals:change', () => queryClient.invalidateQueries({ queryKey: ['goals'] }));
ws.on('activity:event', () => queryClient.invalidateQueries({ queryKey: ['activity'] }));
ws.on('routing:decision', () => queryClient.invalidateQueries({ queryKey: ['routing'] }));
ws.on('cost:tick', () => queryClient.invalidateQueries({ queryKey: ['cost'] }));
ws.on('system:status', () => queryClient.invalidateQueries({ queryKey: ['system'] }));
```

### 9.4 Status indicator

The topbar shows a status pill driven by `ws.getStatus()`:
- `open` → green pulse, "Live"
- `reconnecting` → amber pulse, "Reconnecting"
- `closed` → red dot, "Offline"

---

## 10 · Theme system

### 10.1 Provider

```tsx
// src/web/ui/theme/ThemeProvider.tsx
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(
    () => (localStorage.getItem('bizar.theme') as any) ?? 'system',
  );
  const resolved = useMemo(() => resolveTheme(theme), [theme]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    localStorage.setItem('bizar.theme', theme);
  }, [theme, resolved]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolved }}>
      {children}
    </ThemeContext.Provider>
  );
}
```

### 10.2 Tokens

`tokens.css` is generated from `src/shared/tokens.json` by a small
build script. The JSON is the source of truth; the CSS is generated
on every `pnpm build`. Any token added to the JSON must also be
added to DESIGN.md §3 — this is checked in CI.

### 10.3 Token generation

```ts
// scripts/generate-tokens.ts
import tokens from '../src/shared/tokens.json';
import fs from 'node:fs';

const light = generateCSS(':root', tokens.light);
const dark = generateCSS('.dark', tokens.dark);
const fs_write = `${light}\n\n${dark}\n`;
fs.writeFileSync('src/web/ui/styles/tokens.css', fs_write);
```

### 10.4 Density

Density is a separate concern, also a provider. The `<html>`
element carries `data-density="compact|comfortable"`. CSS reads
the attribute to swap row heights and padding.

---

## 11 · Settings model

### 11.1 Server-side schema

Each setting section is a Zod schema. The server validates on every
PATCH. The client mirrors the schema in `src/web/lib/settings-schemas.ts`.

```ts
// src/web/lib/settings-schemas.ts
import { z } from 'zod';

export const AgentsSettingsSchema = z.object({
  defaultRosterSize: z.number().int().min(1).max(64).default(8),
  maxConcurrent: z.number().int().min(1).max(64).default(16),
  enabledTypes: z.array(z.enum(AGENT_TYPES)).default(AGENT_TYPES),
  autoSpawnOnSession: z.boolean().default(true),
  restartOnConfigChange: z.boolean().default(false),
});
```

### 11.2 Settings store

Settings are stored under `/api/settings/:section` (one file per
section). The UI hydrates from the server on mount, mirrors to
TanStack Query cache, and auto-saves on blur.

```ts
export function useSettings<T>(section: string) {
  return useQuery({
    queryKey: ['settings', section],
    queryFn: () => api.get(`/api/settings/${section}`),
    staleTime: Infinity, // settings rarely change
  });
}

export function useUpdateSettings(section: string) {
  return useMutation({
    mutationFn: (data: unknown) => api.patch(`/api/settings/${section}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', section] }),
  });
}
```

### 11.3 Auto-save

Field blur triggers `useUpdateSettings.mutate(fieldValue)`. On
success: green checkmark flash for 1s. On error: inline error,
toast, no revert (settings don't auto-revert).

### 11.4 Settings sidebar (in-page)

The settings layout (`views/Settings/SettingsLayout.tsx`) renders a
secondary sidebar on the left of the page with the 16 sections,
each linking to its route. Active section uses `--sidebar-accent`.

### 11.5 Cmd+K integration

Every settings key is a Command Palette entry. The palette's
Settings scope renders one entry per settings section with its
icon, name, and the parent breadcrumb.


---

## 12 · Migration / deletion of old dashboard

### 12.1 What gets deleted

Everything inside `bizar-dash/src/web/` from the v7 release:

```
bizar-dash/src/web/
├── ui/                  # DELETE all (F-040 primitives, controls, data, feedback, layout, navigation, styles, theme, utils)
├── views/               # DELETE all (Overview, Tasks, Agents, Active, Skills, Memory, Mods, Schedules, Settings, Mobile*, Chat, Chat*)
├── components/          # DELETE all
├── hooks/               # DELETE all (replaced by ui/hooks + stores)
├── lib/                 # KEEP only what v8 reuses (ws, api, types, query-client)
├── locales/             # DELETE all (v8 is en-only for now)
├── mobile/              # DELETE all (F-041 mobile pass — replaced by responsive web)
├── styles/              # KEEP only what v8 needs
├── App.tsx              # REPLACE
├── MobileApp.tsx        # DELETE
├── main.tsx             # REPLACE
├── mobile.html          # DELETE
├── mobile.tsx           # DELETE
└── index.html           # REPLACE
```

Plus:

- `bizar-dash/DESIGN.md` — replaced by the new DESIGN.md (this rewrite)
- `bizar-dash/ARCHITECTURE.md` — replaced with v8 module doc
- `bizar-dash/CONSTRAINTS.md` — replaced with v8 constraints
- `bizar-dash/README.md` — replaced
- `feature_list.json` — F-040 and F-041 entries are **reverted to not_started** and re-scoped as v8 sprints (§14)

### 12.2 What stays

- `bizar-dash/src/server/` — REST API and WebSocket server (unchanged).
- `bizar-dash/scripts/` — keeps `check-arch.sh` (renamed if needed);
  deletes other shell helpers that v8 doesn't reuse.
- `bizar-dash/package.json`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts` — replace with v8 versions.
- `bizar-dash/dist/` — generated; rebuilt on `pnpm build`.
- `bizar-dash/plans/`, `skills/`, `templates/`, `tests/` — module
  metadata; preserve what v8 still consumes.

### 12.3 Migration script

A single bash script handles the destructive phase:

```sh
#!/usr/bin/env bash
# scripts/v8-migrate.sh — run once at the start of Sprint 0
set -euo pipefail

cd "$(dirname "$0")/.."

# 1. Delete the old web/ subtree (except shared lib/)
rm -rf src/web/ui src/web/views src/web/components src/web/hooks
rm -rf src/web/locales src/web/mobile src/web/styles
rm -f src/web/App.tsx src/web/MobileApp.tsx src/web/main.tsx
rm -f src/web/mobile.html src/web/mobile.tsx src/web/index.html

# 2. Reset F-040 and F-041 in feature_list.json
node scripts/v8-feature-list-reset.mjs

# 3. Clear v8 token
git mv DESIGN.md DESIGN.md.v7-bak || true
git mv ARCHITECTURE.md ARCHITECTURE.md.v7-bak || true
git mv CONSTRAINTS.md CONSTRAINTS.md.v7-bak || true
git mv README.md README.md.v7-bak || true

echo "v8 migration complete. Old artifacts in *.v7-bak; delete after v8.0 ships."
```

### 12.4 Rollback plan

If v8.0 fails its gate (post-Sprint 9), revert to v7.0.0 via git.
The `*.v7-bak` files preserve DESIGN.md, ARCHITECTURE.md,
CONSTRAINTS.md, README.md so a revert restores documentation as
well as code.

---

## 13 · Phased implementation plan

### Sprint 0 — Bootstrap (½ day)

- Branch `worktree-v8-dashboard-rewrite` off `master`.
- Run `scripts/v8-migrate.sh`.
- `pnpm dlx shadcn@latest init --preset b7kBsBkh7b` (creates
  `components.json`, `tailwind.config.ts`, baseline `globals.css`).
- Override `tailwind.config.ts` to consume only our token CSS
  variables (no utility classes leak into `ui/`).
- Replace generated `globals.css` with our `tokens.css` from §3
  DESIGN.

**Exit gate:** `pnpm dev` boots a blank page with our token CSS
applied. `pnpm check:design-tropes` exits 0.

### Sprint 1 — Foundation

- `ui/styles/{reset,tokens,globals}.css` (delivered)
- `ui/theme/{ThemeProvider,ThemeToggle,DensityProvider,useTheme,useDensity}.tsx`
- `ui/primitives/*` (11 components, each with `.test.tsx`)
- `shell/{AppShell,Topbar,Sidebar,StatusBar}.tsx`

**Exit gate:** App shell renders with sidebar + topbar. Theme
toggle works. Density toggle works. 11 primitives have unit tests.

### Sprint 2 — Controls & feedback

- `ui/controls/*` (20 components)
- `ui/feedback/*` (16 components)
- `ui/utils/*` (8 utilities)

**Exit gate:** Form playground page exercises every control +
feedback component. Visual screenshot matches DESIGN §3 tokens.

### Sprint 3 — Data display

- `ui/data/*` (24 components)
- `views/Overview/*` (uses StatTile, Chart, DataTable, BarList)

**Exit gate:** Overview page renders against live `/api/agents`,
`/api/tasks`, `/api/cost/status`. Visual screenshot at 1440 / 1100.

### Sprint 4 — Navigation

- `ui/navigation/*` (23 components)
- `ui/popups/*` (8 components)
- `stores/{palette,sidebar,selection}.ts`
- Command palette wired with Actions + Navigate scopes.

**Exit gate:** Cmd+K opens palette with all 6 nav items + 10+
actions. Keyboard walkthrough passes for every nav item.

### Sprint 5 — Kanban (the main focus)

- `ui/kanban/*` (15 components)
- `hooks/useTasks.ts`
- `views/Tasks/*` (Kanban view + List view + Calendar view)
- Right-click context menu on every card
- Drag-and-drop across columns (with keyboard alternative)
- Filters: status, assignee, label, priority, due, search
- Group-by: status / assignee / label / priority / due / project
- Sort: created / updated / priority / due
- Density: compact / comfortable
- Detail drawer (right side)

**Exit gate:** 100 tasks in seeded data render in <100ms. Drag
works via mouse + keyboard. Right-click menu opens on every card.
URL state survives reload.

### Sprint 6 — Goals + Agents

- `views/Goals/*` — list, detail, milestones, progress
- `views/Agents/*` — roster, detail, live status

**Exit gate:** Goal → task breakdown visible. Agent roster shows
live status with WS updates. Detail drawer works for both.

### Sprint 7 — Activity + Memory + Libraries

- `views/Activity/*` — event log + comm log + routing decisions
- `views/Memory/*` — vault browser + distillation patterns
- `views/Libraries/*` — Skills / MCPs / Hooks in a tabbed page

**Exit gate:** Activity feed live-updates via WS. Memory search
hits the existing `/api/memory?q=`. Libraries page shows all
skills/MCPs/hooks with right-click context menus.

### Sprint 8 — Settings (16 sections)

- `views/Settings/*` — hierarchical with in-page sidebar
- `lib/settings-schemas.ts` — Zod schemas for all 16 sections
- Cmd+K Settings scope wired

**Exit gate:** Every settings section renders, auto-saves, and
survives reload. Cmd+K "Settings" scope lists every section.

### Sprint 9 — Polish & verification

- Empty/loading/error states for every view
- Motion audit (every transition matches §6)
- Accessibility audit (`pnpm check:a11y`)
- Visual regression at 1440 / 1100 / 768 / 390
- Keyboard walkthrough (`pnpm check:keyboard`)
- Banned-trope scan (`pnpm check:design-tropes`)
- Mobile responsive pass (single breakpoint at 768px; no mobile-
  native apps)
- Performance: lighthouse > 90 on `/tasks`

**Exit gate:** All 5 checks green. L09 layers 1+2+3 all green.
PROGRESS.md updated; release notes drafted.


---

## 14 · Sprint schedule

Sprint length: **3 working days** each. Total: 9 sprints × 3 = ~27
working days, or roughly **5–6 calendar weeks** with a single full-
time engineer + review.

| Sprint | Focus | Feature IDs | Days |
|--|--|--|--|
| **S0** | Bootstrap (delete old, init preset) | F-042 | 0.5 |
| **S1** | Foundation (tokens, primitives, shell) | F-043 | 3 |
| **S2** | Controls + feedback | F-044 | 3 |
| **S3** | Data display + Overview | F-045 | 3 |
| **S4** | Navigation + palette + popups | F-046 | 3 |
| **S5** | Kanban (the centerpiece) | F-047 | 4 |
| **S6** | Goals + Agents | F-048 | 3 |
| **S7** | Activity + Memory + Libraries | F-049 | 3 |
| **S8** | Settings (16 sections) | F-050 | 3 |
| **S9** | Polish + verification | F-051 | 2.5 |

Total: **28 working days** ≈ **5.5 calendar weeks**.

### Feature ID assignments

`F-042` through `F-051` are reserved for the v8 sprint. `F-040`
(F-040 redesign) and `F-041` (mobile UI pass) are reset to
`not_started` and treated as historical context — their evidence
is preserved in `docs/decisions/DEC-026-v8-dashboard-rewrite.md`
but they do not count toward VCR.

### Sprint contracts

Each sprint starts with a sprint contract template (see
`templates/sprint-contract.md`). The contract includes:
- Scope (which files, which features)
- Definition of Done (L09 layers 1+2+3)
- Exclusions (what is *not* in scope)
- Risks + mitigations
- Reviewer (Forseti)

### WIP=1 rule

Per CLAUDE.md, only one feature active at a time. Each sprint ships
one feature (`F-NNN`) end-to-end. We do **not** ship partial
features; the gate is the gate.

---

## 15 · Testing strategy

### 15.1 Unit (vitest)

Every component in `ui/` has a colocated `.test.tsx`. Patterns:
- AAA (Arrange / Act / Assert).
- `@testing-library/react` for rendering + queries.
- `userEvent` (not `fireEvent`) for interactions.
- `vitest-axe` for a11y assertions.
- One snapshot per visual state (default, hover, focus, disabled,
  loading, error).
- Aim: 80%+ coverage per component file.

### 15.2 Integration (vitest)

Per-view integration tests render the full view against a mocked
MSW server. Cover:
- Initial load → first paint
- User action → optimistic update → server confirm
- User action → server error → revert + toast
- WS event → cache invalidation → re-render

### 15.3 E2E (playwright)

`tests/e2e/` covers the critical user flows:
- `smoke.spec.ts` — boot the app, land on Overview, navigate to
  every route, no console errors.
- `keyboard.spec.ts` — walk through every interactive element
  using only Tab + Enter + arrow keys. Cmd+K, Shift+F10, Esc.
- `visual.spec.ts` — screenshot diff at 1440 / 1100 / 768 / 390.
- `kanban.spec.ts` — drag a card across columns, verify URL state,
  verify the move persists after reload.
- `settings.spec.ts` — change a setting, verify auto-save, verify
  Cmd+K shows it.

### 15.4 Accessibility (axe-core)

`tests/a11y/` runs axe-core against every route. CI fails if any
page has a critical violation. Manual screen-reader pass on Tasks,
Goals, Settings, and Command Palette before each release.

### 15.5 Visual regression (playwright visual)

Screenshot diff against committed baselines. Baseline PR is
generated automatically; reviewer approves deltas before merge.

### 15.6 Performance

Lighthouse runs in CI on `/tasks` with seeded data. Targets:
- LCP < 1.5s
- TBT < 200ms
- CLS < 0.05
- Performance score ≥ 90

### 15.7 Banned-trope scan

`scripts/check-design-tropes.sh` greps the codebase for the §12
DESIGN banned patterns. Runs on every PR; CI fails on hit.

---

## 16 · Integration with Bizar harness

### 16.1 MCP tools (no changes)

v8 consumes the same 22+ MCP tools that v7 did. No new tools.

### 16.2 Plugin shim

The dashboard never imports from `plugins/bizar/`. Per CLAUDE.md
L10: "Skill must not import from `bizar-dash/` (cross-layer)."
The reverse is also true — dashboard imports nothing from the
plugin layer.

### 16.3 Data flow

```
┌─────────────────┐    REST + WS    ┌──────────────────┐
│  bizar-dash     │◄──────────────►│  bizar-dash      │
│  src/web/       │                 │  src/server/     │
│  (React SPA)    │                 │  (Express + WS)  │
└─────────────────┘                 └──────────────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │  plugins/bizar   │
                                   │  (MCP server)    │
                                   └──────────────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │  packages/sdk    │
                                   │  (Claude Code    │
                                   │   Agent SDK)     │
                                   └──────────────────┘
```

### 16.4 Build pipeline

- `pnpm dev` — Vite dev server on `:5173`, proxied to `node
  src/server/main.mjs` on `:8787` for REST + WS.
- `pnpm build` — Vite production build → `dist/`.
- `pnpm preview` — serve `dist/` + `src/server/`.
- `make dashboard-dev` — orchestrator target that runs both in
  watch mode.

### 16.5 CI gates

- `pnpm typecheck` — TypeScript strict, 0 errors.
- `pnpm test` — vitest, all unit + integration.
- `pnpm e2e` — playwright smoke + keyboard.
- `pnpm check:design-tropes` — banned patterns.
- `pnpm check:a11y` — axe-core.
- `pnpm check:visual` — screenshot diff (advisory, manual approve).
- `pnpm check:arch` — architectural rules (skill/dashboard/SDK
  boundaries).
- `make check` — full pipeline; existing in CLAUDE.md.

### 16.6 Release

- v8.0 ships when all 10 sprints (F-042..F-051) are passing.
- v8.0.1+ is patch-only on v8.0; no new features until v8.1.
- The `*.v7-bak` files are deleted at v8.0 release.

---

## 17 · Risks & open questions

| # | Risk | Likelihood | Impact | Mitigation |
|--|--|--|--|--|
| R-01 | shadcn preset `b7kBsBkh7b` is unverified / doesn't resolve as expected | Med | High | Appendix A of DESIGN.md documents the fallback: override `components.json`, run `shadcn add` for each missing primitive. The plan still holds; §3 is the contract. |
| R-02 | TanStack Router file-based routing is incompatible with the existing Vite build | Low | Med | Sprint 0 verifies routing setup before committing. Code-based routing works as fallback. |
| R-03 | dnd-kit keyboard sensors don't cover all kanban interactions | Med | Med | Sprint 5 includes a manual keyboard walkthrough; we write a custom keyboard sensor if needed. |
| R-04 | The existing REST endpoints don't match v8's data shape | Low | High | Sprint 0 includes an endpoint audit. Where shapes diverge, v8 adapts (Zod parse + map) without changing the server. |
| R-05 | Performance regression on `/tasks` with 1000+ tasks | Med | Med | Virtualization via TanStack Virtual; pagination on the list view; lazy-render off-screen columns. Lighthouse gate in §15.6 catches it. |
| R-06 | Custom-popup right-click interferes with browser gestures | Low | Low | `oncontextmenu` returns `false` only on our interactive surfaces. Long-press on touch (650ms) opens the same menu. |
| R-07 | Settings schema sprawl — 16 sections × N fields each | High | Med | Settings schemas are Zod-validated end-to-end. Each section is its own Zod schema. Cmd+K surfaces them. We resist adding new sections unless justified. |
| R-08 | v7 mobile users break (no MobileApp.tsx) | Med | Med | The new design is responsive web; mobile users get the same responsive UI at 390px. Communicate the change in v8 release notes. |
| R-09 | Real-time updates overwhelm the kanban with WS events | Low | Med | WS events invalidate query keys; React Query batches invalidations. No re-render storm because TanStack Query debounces identical fetches. |
| R-10 | Single-engineer timeline (5–6 weeks) slips | Med | Med | Each sprint ships a working app (compiles + boots + 1 view). If Sprint 5 (kanban) slips, v8.0 ships without goals/agents (deferred to v8.1). |

### Open questions for the operator

1. **shadcn preset ID.** Confirm `b7kBsBkh7b` is the intended
   preset; if not, provide the correct one and we re-run Sprint 0.
2. **Mobile.** Confirm mobile-web responsive (no native app) is the
   right scope for v8.
3. **Settings depth.** Are 16 sections the right level? Some teams
   prefer fewer, deeper sections; others prefer more, flatter ones.
4. **Routing library.** Confirm TanStack Router (vs. React Router).
5. **Drag-and-drop library.** Confirm dnd-kit (vs. Pragmatic drag
   and drop, the newer alternative).
6. **Multi-workspace UI.** Confirm single-workspace for v8 (vs.
   switching UI in the topbar).

---

**End of PLAN.md — v8.0.0**
