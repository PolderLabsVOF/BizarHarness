# GLYPH.md — Visual Summary · Bizar Dashboard v8

> A single-page visual rendering of the v8 design and plan. Best viewed
> in a monospace font (Inter Mono, JetBrains Mono, Menlo, Consolas).
> Width: 100 columns. Height: ~110 rows.

---

## 1 · The mark

```
                                          
        ██████  ██  ██ ███████ ███████     
        ██  ██  ████   ██      ██          
        ██████   ██    █████   ███████     
        ██      ████   ██           ██     
        ██████  ██  ██ ███████ ███████     
                                          
              v 8 . 0 . 0                   
        B I Z A R    D A S H B O A R D     
                                          
       ░ the green mark · single accent     
       ░ OKLch · light + dark peer          
       ░ gradients banned · density first   
                                          
```

The mark is a stylized `B` (for Bizar) formed from solid blocks, set in
the accent green (`oklch(0.527 0.154 150.069)` light /
`oklch(0.448 0.119 151.328)` dark). No fill, no gradient, no glow. A
single shape; the accent earns its keep by being the only color that
gets to be loud.

---

## 2 · The shell

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ▣  Bizar │ workspace ▾   Tasks › Kanban              ⌕ search           🔔  │
│                                                                              │
│           ┌─ WORKSPACE ───────────┐    ┌─────────────────────────────────┐    │
│           │ ▦ Overview            │    │                                 │    │
│           │ ▤ Tasks           47  │◀── │   ┌────────┐ ┌────────┐ ┌────┐  │    │
│           │ ◐ Goals            3  │    │   │ BACKLOG│ │  TODO  │ │DOING│  │    │
│           ├─ OPERATIONS ──────────┤    │   │   12   │ │   23   │ │  9 │  │    │
│           │ ◈ Agents          8/16│    │   └────────┘ └────────┘ └────┘  │    │
│           │ ▣ Activity   ●  live │    │   ┌────────┐ ┌────────┐         │    │
│           │ ◇ Memory             │    │   │ REVIEW │ │  DONE  │         │    │
│           ├─ LIBRARIES ──────────┤    │   │   2    │ │   1    │         │    │
│           │ ❖ Skills          18 │    │   └────────┘ └────────┘         │    │
│           │ ⬢ MCPs            3  │    │                                 │    │
│           │ ⚓ Hooks            5  │    │   KANBAN BOARD · 47 tasks       │    │
│           ├─ SYSTEM ─────────────┤    │   group: status ▾  + filters    │    │
│           │ ⚙ Settings            │    │                                 │    │
│           │                       │    └─────────────────────────────────┘    │
│           │ ◉ online · v8.0.0     │                                              │
│           │   build 1542e72       │                                              │
└──────────────────────────────────────────────────────────────────────────────┘
   T O P B A R   56 p x     S I D E B A R   2 6 0 p x     I N S E T   m a x 1440
```

The shell is two fixed regions: **topbar (56px)** on top,
**sidebar (260px, collapsible to 60px)** on the left, and a 1440px-max
**SidebarInset** on the right. Status bar at the bottom appears only
when there is an active alert.

---

## 3 · Right-click, the centerpiece

Every interactive surface in v8 has a custom right-click menu — no
browser defaults. Example: right-click on a kanban card.

```
   ┌──────────────────── ▴ KANBAN-123 ─────────────────────┐
   │  ▦  Refactor auth middleware             P1 · coder   │
   │  ◐  in_progress · updated 2h ago          47 tokens    │
   └────────────────────────────────────────────────────── ┘
                              │       (right-click here)
                              ▼
   ┌──────────────────────────────────────┐
   │  Open in drawer              ⌘ ↵    │
   │  Edit                        E      │
   │  Duplicate                   ⇧ D     │
   │  Copy link                   ⌥ L     │
   │  ────────────────────────────────  │
   │  Assign to agent             ▸      │
   │  Move to column              ▸      │
   │  Set priority                ▸      │
   │  ────────────────────────────────  │
   │  Archive                  ⌘ ⇧ A     │
   │  ⌫  Delete task          danger     │
   └──────────────────────────────────────┘
```

The keyboard equivalent is **Shift+F10** when the card has focus.
Both triggers open the same Radix ContextMenu. No `window.confirm`,
no `window.alert`, no `window.prompt` anywhere in the app.

---

## 4 · Command palette (Cmd+K)

```
   ┌──────────────────────────────────────────────────────────────────┐
   │  ⌕  Type a command, page, or setting…                            │
   │ ─────────────────────────────────────────────────────────────── │
   │  ACTIONS                                                  ⌥ 1  │
   │    ⚡  Add task to current column              C                │
   │    ⚡  Move selected to in_review              ⇧ ↵              │
   │    ⚡  Bulk archive (12 selected)              ⌘ ⇧ A           │
   │ ─────────────────────────────────────────────────────────────── │
   │  NAVIGATE                                                ⌥ 2  │
   │    ◦  Tasks › Kanban                                        ⌘ 1│
   │    ◦  Goals › Active goals                                  ⌘ 2│
   │    ◦  Settings › Agents                                     ⌘ ,│
   │ ─────────────────────────────────────────────────────────────── │
   │  SETTINGS                                                ⌥ 3  │
   │    ⚙  Settings › General › Workspace name                      │
   │    ⚙  Settings › Routing › Cost ceiling                       │
   │                                                                  │
   │                                              ↵ run · esc close  │
   └──────────────────────────────────────────────────────────────────┘
```

Three scopes — Actions, Navigate, Settings — switched via `Tab`. Fuzzy
search across all three scopes simultaneously. Built on `cmdk`, the
same library Linear and Raycast use.

---

## 5 · The component library

```
bizar-dash/src/web/ui/
│
├── primitives/      11     layout · a11y helpers
│   ├─ Box              Stack              Inline
│   ├─ Cluster          Grid               Center
│   ├─ Separator        ScrollArea         Resizable
│   ├─ VisuallyHidden   Portal
│
├── controls/        20     forms · inputs
│   ├─ Button (6 variants · 5 sizes)       ButtonGroup   IconButton
│   ├─ Input   Textarea   InputOTP
│   ├─ Select   MultiSelect   Combobox
│   ├─ Checkbox   RadioGroup   Switch
│   ├─ Toggle   ToggleGroup   Slider
│   ├─ DatePicker   DateRangePicker   TimePicker
│   ├─ ColorPicker                    Field   Form
│
├── feedback/        16     status · popups
│   ├─ Alert (4 variants)    Toast          Dialog   AlertDialog
│   ├─ Sheet (4 sides)       Drawer         Popover  HoverCard
│   ├─ Tooltip (4-side)      Progress       ProgressCircle  Spinner
│   ├─ Skeleton              EmptyState     ErrorBoundary    Banner
│
├── data/           24     display · viz
│   ├─ Card   StatTile   StatGrid
│   ├─ Table   DataTable (sort · filter · paginate · select · virtualize)
│   ├─ Badge (6 variants)   Chip   Avatar   AvatarStack
│   ├─ Timeline   Accordion   Collapsible
│   ├─ Chart (Recharts)    Sparkline   MetricRing   BarList
│   ├─ TreeView   VirtualList   Kbd   CountBadge   ViewHeader
│
├── navigation/     23     nav · menus · tabs
│   ├─ Sidebar   SidebarProvider   SidebarInset   SidebarSection
│   ├─ SidebarItem   SidebarGroup   Topbar   Breadcrumb
│   ├─ NavLink   Tabs   TabBar   TabPanel
│   ├─ Menu   ContextMenu   DropdownMenu   Menubar
│   ├─ Pagination   Stepper
│   ├─ CommandPalette   CommandBar
│   ├─ NavSection   NavItem   NavGroup   ViewTabs
│
├── kanban/         15     the centerpiece
│   ├─ KanbanBoard   KanbanColumn   KanbanCard
│   ├─ KanbanCardCompact   KanbanCardExpanded   KanbanDetail
│   ├─ KanbanFilters   KanbanGroupBy   KanbanSort   KanbanDensity
│   ├─ KanbanEmptyState   KanbanKeyboardShortcuts
│   ├─ KanbanQuickAdd   KanbanContextMenu   KanbanDragOverlay
│
├── popups/          8     custom popups (no browser defaults)
│   ├─ ContextMenu   ActionMenu   SubActionMenu   QuickAction
│   ├─ CommandBar   DetailDrawer   ConfirmDialog   InfoPopover
│
├── theme/           5     theming · density
│   ├─ ThemeProvider   useTheme   ThemeToggle
│   ├─ DensityProvider   useDensity
│
├── hooks/          10     cross-cutting
│   ├─ useWebSocket   useAgents   useTasks   useGoals   useShortcuts
│   ├─ useContextMenu   useDragAndDrop
│   ├─ useFocusTrap   useReducedMotion   useLocalStorage
│
├── utils/           8     pure helpers
│   ├─ cx   formatNumber   formatPercent   formatBytes
│   ├─ formatDuration   formatRelativeTime
│   ├─ useHotkeys   useMediaQuery   useDebouncedValue
│
└── styles/          3     the entire §3 DESIGN.md, generated from JSON
    ├─ reset.css   tokens.css   globals.css

            ── total:  11 + 20 + 16 + 24 + 23 + 15 + 8 + 5 + 10 + 8 = 140 ──
```

---

## 6 · The views

```
   /                          Overview       hero · 4 stat tiles · 3 charts
   │
   ├── /tasks                 Tasks          default: Kanban
   │   ├─ /tasks/list         Tasks          list · filter · sort
   │   └─ /tasks/calendar     Tasks          calendar · week · month
   │
   ├── /goals                 Goals          active · paused · completed
   │   └─ /goals/:id          Goal detail    description · milestones · tasks
   │
   ├── /agents                Agents         roster · live status
   │   └─ /agents/:id         Agent detail   type · status · cost · activity
   │
   ├── /activity              Activity       event log · live tail
   │
   ├── /memory                Memory         vault · distillation · search
   │
   ├── /libraries             Libraries      tabs: skills · MCPs · hooks
   │
   └── /settings/*            Settings       hierarchical, in-page sidebar
       ├─ /general            · workspace name · logo · default project
       ├─ /appearance         · theme · density · accent
       ├─ /agents             · roster · max concurrency · types
       ├─ /goals              · cadence · review interval
       ├─ /tasks              · workflow · statuses · kanban config
       ├─ /skills             · library · default · auto-suggest
       ├─ /mcps               · servers · auth · per-tool permissions
       ├─ /hooks              · Pre · Post · UserPrompt
       ├─ /routing            · tiers · cost ceiling · fallback
       ├─ /memory             · vault location · retention · distillation
       ├─ /notifications      · per-event toggles · channels
       ├─ /security           · webhook secrets · HMAC · PII mode
       ├─ /integrations       · GitHub · Slack · webhooks
       ├─ /billing            · cost gate · room budget · alerts
       ├─ /team               · members · roles (future)
       └─ /advanced           · debug · traces · export · reset
```

The nav stays at **6 top-level items** (Workspace · Operations ·
Libraries · System). Settings gets a dedicated in-page sidebar so it
has room to breathe.

---

## 7 · The token system

```
   ┌────────────────────────────────────────┐
   │ tokens.json   (the contract)           │
   │   ├─ light   →  light CSS vars         │
   │   └─ dark    →  dark  CSS vars         │
   │         │                              │
   │         ▼  scripts/generate-tokens.ts  │
   │   ui/styles/tokens.css (generated)     │
   │         │                              │
   │         ▼                              │
   │   every component consumes only        │
   │   var(--token) — never raw color       │
   └────────────────────────────────────────┘

   ── color (oklch) ─────────────────────────────────────────
   bg · surface-1..3 · surface-popover
   fg · fg-muted · fg-subtle · fg-on-accent · fg-link
   accent · accent-hover · accent-soft · accent-ring     ◀ green
   success · warning · danger · info
   border · border-strong · input-bg · focus-ring
   chart-1..5 · chart-accent
   sidebar-bg · sidebar-fg · sidebar-accent · sidebar-accent-fg
   sidebar-hover · sidebar-border

   ── geometry ─────────────────────────────────────────────
   radius (10px) · radius-sm (6px) · radius-lg (14px) · radius-pill

   ── elevation ────────────────────────────────────────────
   shadow-1 (rest) · shadow-2 (hover) · shadow-3 (drag) · shadow-4 (sheet)

   ── motion ───────────────────────────────────────────────
   motion-instant (50ms) · motion-fast (120ms)
   motion-base (200ms) · motion-slow (320ms)
   ease-out · ease-in-out · ease-spring
   (all zeroed under prefers-reduced-motion)

   ── z-index ──────────────────────────────────────────────
   base (0) · sticky (10) · dropdown (1000)
   sticky-nav (1100) · overlay (1300) · modal (1400)
   popover (1500) · toast (1600) · tooltip (1700)            ◀ no higher
```

---

## 8 · The sprint roadmap

```
   Sprint  Days  Feature   Focus                                        Status
   ──────  ────  ───────   ──────────────────────────────────────────  ──────
   S0      0.5   F-042     Bootstrap: delete v7 subtree, init preset     ☐
                                   │
   S1      3     F-043     Foundation: tokens, primitives, shell        ☐
                                   │
   S2      3     F-044     Controls + feedback (36 components)           ☐
                                   │
   S3      3     F-045     Data display + Overview view                 ☐
                                   │
   S4      3     F-046     Navigation + Cmd+K palette + popups          ☐
                                   │
   S5      4     F-047     KANBAN (centerpiece · 15 components)         ☐
                                   │
   S6      3     F-048     Goals + Agents                               ☐
                                   │
   S7      3     F-049     Activity + Memory + Libraries                ☐
                                   │
   S8      3     F-050     Settings (16 sections, hierarchical)         ☐
                                   │
   S9      2.5   F-051     Polish + verification + release               ☐
                                   │
   ─────────────────── 28 working days · ~5.5 calendar weeks ────────

   gate per sprint (L09 layers):
     ├─ L1  make check           · 0 TS errors
     ├─ L2  make test            · all unit + integration pass
     └─ L3  make e2e             · smoke + keyboard + visual + a11y
```

---

## 9 · The data flow

```
        ┌────────────────────┐  REST + WS   ┌────────────────────┐
        │   bizar-dash       │ ◄──────────► │   bizar-dash       │
        │   src/web/         │              │   src/server/      │
        │   (React 19 SPA)   │              │   (Express + WS)   │
        └────────────────────┘              └────────────────────┘
                                                       │
                                                       ▼
                                            ┌────────────────────┐
                                            │   plugins/bizar    │
                                            │   (MCP server)     │
                                            │   22 tools         │
                                            └────────────────────┘
                                                       │
                                                       ▼
                                            ┌────────────────────┐
                                            │   packages/sdk     │
                                            │   (Claude Code     │
                                            │    Agent SDK)      │
                                            └────────────────────┘

   WS messages (single connection · /ws/dashboard):
     tasks:change       → invalidate ['tasks']
     tasks:delete       → invalidate ['tasks']
     agents:change      → invalidate ['agents']
     goals:change       → invalidate ['goals']
     activity:event     → invalidate ['activity']
     routing:decision   → invalidate ['routing']
     cost:tick          → invalidate ['cost']
     system:status      → update topbar status pill
```

---

## 10 · The banned tropes

```
   ✗  gradients           anywhere — backgrounds, fills, borders, hovers
   ✗  vertical stripes    left-edge accent bars on containers
   ✗  purple / blue wash  the accent is green, charts are grayscale
   ✗  emoji in UI copy    use Lucide icons
   ✗  Lorem ipsum         every placeholder is realistic
   ✗  "Loading…" spinner  use skeleton or streaming copy
   ✗  browser context     every interactive surface has our ContextMenu
   ✗  modal-on-modal      a modal cannot open another modal
   ✗  tooltip on disabled tooltip only when enabled; else inline helper
   ✗  invented metrics    real numbers or "—" placeholder
   ✗  glass / blur        surfaces are solid fills
   ✗  animated icons      except the live indicator pulse

   audited on every PR by scripts/check-design-tropes.sh
```

---

## 11 · The five inviolable rules

```
   ┌──────────────────────────────────────────────────────────────────┐
   │                                                                  │
   │   1.  RIGHT-CLICK IS SACRED                                      │
   │       every interactive surface has a ContextMenu                 │
   │                                                                  │
   │   2.  KEYBOARD PARITY                                            │
   │       every action has a shortcut; every menu shows it           │
   │                                                                  │
   │   3.  CMD+K IS EVERYTHING                                        │
   │       palette contains every page, action, setting, shortcut     │
   │                                                                  │
   │   4.  OPTIMISTIC BY DEFAULT                                      │
   │       mutations apply instantly; rollback on error with toast    │
   │                                                                  │
   │   5.  REAL-TIME BY DEFAULT                                       │
   │       live data refreshes via WS; green pulse = connected        │
   │                                                                  │
   └──────────────────────────────────────────────────────────────────┘
```

---

**End of GLYPH.md — v8.0.0**