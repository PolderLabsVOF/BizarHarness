# DESIGN.md — Bizar Dashboard v8 (Dashboard Rewrite)

> **Scope.** This document replaces the v7.0.0 design system (F-040)
> and the in-progress mobile pass (F-041) in their entirety. The old
> dashboard, its `src/web/ui/` primitives, its Norse-pantheon dark
> aesthetic, its views, and its previous `DESIGN.md` are all **deleted**
> under the rewrite. v8 ships a new file tree, a new component
> library, a new theme, a new layout, and a new feature scope.
>
> **Read order.** If you only read three sections, read
> [§1 Principles](#1--principles), [§3 Tokens](#3--design-tokens), and
> [§7 Layout](#7--layout). Everything else is the supporting cast.

---

## Table of contents

1. [Principles](#1--principles)
2. [Brand & voice](#2--brand--voice)
3. [Design tokens](#3--design-tokens)
4. [Typography](#4--typography)
5. [Spacing & layout](#5--spacing--layout)
6. [Motion & elevation](#6--motion--elevation)
7. [Layout](#7--layout)
8. [Component library](#8--component-library)
9. [Interaction patterns](#9--interaction-patterns)
10. [Settings model](#10--settings-model)
11. [Accessibility](#11--accessibility)
12. [Banned tropes](#12--banned-tropes)
13. [Visual contract for new screens](#13--visual-contract-for-new-screens)
14. [Pre-merge checklist](#14--pre-merge-checklist)

---

## 1 · Principles

Five rules govern every visual decision. When in doubt, follow them
in order; if two conflict, the higher rule wins.

1. **Data first, chrome last.** Every pixel earns its place by
   carrying information. Whitespace is spent on legibility, not
   decoration. Density targets a desktop operator running two
   external monitors — never a marketing screenshot.
2. **One accent, used with intent.** The accent is the green primary
   token (`--accent`). It signals primary action, active state,
   live data, and selection — nothing else. There is exactly one
   accent across the entire product.
3. **State is signal, not decoration.** Active, streaming, awaiting,
   error, success, offline — every state must be distinguishable at a glance without reading copy. Weight, fill, motion, and shape are the four channels. **Never gradients.** Never `border-left` accent stripes on containers.
4. **Type does hierarchy.** A single sans family for UI, a single mono family for data. Size and weight carry the hierarchy; color is secondary. Tabular figures on every number.
5. **Native over invented.** The browser already has menus, focus rings, scrollbars, and shortcuts. We add right-click context menus, command palettes, and keyboard shortcuts that wrap the platform — we never replace it.

**Anti-target.** v7's Norse-pantheon, dark-by-default, accent-stripe look is rejected. v8 is light-by-default, dark-mode peer, single accent (green), gradient-free, dense by intent.

---

## 2 · Brand & voice

| | |
|--|--|
| **Wordmark** | `Bizar` set in `Inter` SemiBold, 16px, `var(--fg)` |
| **Product glyph** | A minimal `ᛒ` (runic Berkanan) in `var(--accent)` for logo and favicon |
| **Voice** | Direct, technical, never marketing. Numbers with units. Inline code for IDs. |
| **Tab labels** | Single noun (`Tasks`, `Goals`, `Agents`). No emoji decorations. |
| **Status copy** | "Streaming" not "Loading…". "13 of 47" not "Lots". "Awaiting reply" not "Ready". |
| **Errors** | One sentence: what happened + one action the user can take. No "Oops!". |

---

## 3 · Design tokens

All values live in `:root` (light) and `.dark` (dark) in `bizar-dash/src/web/ui/styles/tokens.css`. Components consume the CSS custom properties only — never raw color values. New tokens get added to this section **before** any component uses them.

The user-supplied shadcn preset theme is the source of truth for color tokens. Every other token (spacing, radius, motion, typography) is layered on top.

### 3.1 Surface scale

| Token | Light (oklch) | Dark (oklch) | Use |
|--|--|--|--|
| `--bg` | `oklch(1 0 0)` | `oklch(0.141 0.005 285.823)` | Page canvas |
| `--surface-1` | `oklch(1 0 0)` | `oklch(0.21 0.006 285.885)` | Cards, topbar, sidebar, dialogs |
| `--surface-2` | `oklch(0.967 0.001 286.375)` | `oklch(0.274 0.006 286.033)` | Nested surfaces, table rows, hover bg |
| `--surface-3` | `oklch(0.92 0.004 286.32)` | `oklch(0.37 0.013 285.805)` | Pressed, selected, drag-over |
| `--surface-popover` | `oklch(1 0 0)` | `oklch(0.21 0.006 285.885)` | Popovers, context menus, command palette |


### 3.2 Foreground scale

| Token | Light | Dark | Use |
|--|--|--|--|
| `--fg` | `oklch(0.141 0.005 285.823)` | `oklch(0.985 0 0)` | Primary text |
| `--fg-muted` | `oklch(0.552 0.016 285.938)` | `oklch(0.705 0.015 286.067)` | Secondary text, captions, helper |
| `--fg-subtle` | `oklch(0.705 0.015 286.067)` | `oklch(0.552 0.016 285.938)` | Tertiary, placeholder, disabled |
| `--fg-on-accent` | `oklch(0.982 0.018 155.826)` | `oklch(0.982 0.018 155.826)` | Text on `--accent` backgrounds |
| `--fg-link` | `var(--accent)` | `var(--accent)` | Inline links, breadcrumbs |

### 3.3 Accent (the only color that gets to be loud)

| Token | Light | Dark | Use |
|--|--|--|--|
| `--accent` | `oklch(0.527 0.154 150.069)` | `oklch(0.448 0.119 151.328)` | Primary buttons, active state, focus ring tint, live indicator |
| `--accent-hover` | `oklch(0.477 0.154 150.069)` | `oklch(0.398 0.119 151.328)` | Hover on `--accent` |
| `--accent-soft` | `color-mix(in oklch, var(--accent) 12%, transparent)` | same | Selected row tint, badge bg |
| `--accent-ring` | `color-mix(in oklch, var(--accent) 35%, transparent)` | same | Focus ring |

### 3.4 Semantic colors

| Token | Light | Dark | Use |
|--|--|--|--|
| `--success` | `oklch(0.527 0.154 150.069)` | `oklch(0.723 0.219 149.579)` | Passed, succeeded, completed |
| `--warning` | `oklch(0.7 0.15 75)` | `oklch(0.75 0.15 75)` | Awaiting, paused, queued |
| `--danger` | `oklch(0.577 0.245 27.325)` | `oklch(0.704 0.191 22.216)` | Failed, error, destructive |
| `--info` | `oklch(0.6 0.13 240)` | `oklch(0.7 0.13 240)` | Informational, neutral highlight |

### 3.5 Borders & inputs

| Token | Light | Dark | Use |
|--|--|--|--|
| `--border` | `oklch(0.92 0.004 286.32)` | `oklch(1 0 0 / 10%)` | Default 1px border |
| `--border-strong` | `oklch(0.85 0.005 286)` | `oklch(1 0 0 / 18%)` | Hover, dividers |
| `--input-bg` | `oklch(0.967 0.001 286.375)` | `oklch(0.274 0.006 286.033)` | Form control fill |
| `--focus-ring` | `oklch(0.705 0.015 286.067)` | `oklch(0.552 0.016 285.938)` | Outer focus ring |

### 3.6 Charts (categorical, sequential, status)

| Token | Value | Use |
|--|--|--|
| `--chart-1` | `oklch(0.871 0.006 286.286)` | First series, neutral |
| `--chart-2` | `oklch(0.552 0.016 285.938)` | Second series |
| `--chart-3` | `oklch(0.442 0.017 285.786)` | Third series |
| `--chart-4` | `oklch(0.37 0.013 285.805)` | Fourth series |
| `--chart-5` | `oklch(0.274 0.006 286.033)` | Fifth series |
| `--chart-accent` | `var(--accent)` | Highlighted series |

Chart colors intentionally **do not match `--accent`** — they form a neutral grayscale ramp so that the green primary is reserved for interactive state. When a chart needs to highlight a single series (e.g. "errors over time"), it switches to `--danger` or `--success`, not `--accent`.

### 3.7 Sidebar

| Token | Light | Dark | Use |
|--|--|--|--|
| `--sidebar-bg` | `oklch(0.985 0 0)` | `oklch(0.21 0.006 285.885)` | Sidebar canvas |
| `--sidebar-fg` | `oklch(0.141 0.005 285.823)` | `oklch(0.985 0 0)` | Sidebar text |
| `--sidebar-accent` | `oklch(0.627 0.194 149.214)` | `oklch(0.723 0.219 149.579)` | Active nav item, primary sidebar button |
| `--sidebar-accent-fg` | `oklch(0.982 0.018 155.826)` | `oklch(0.982 0.018 155.826)` | Text on sidebar accent |
| `--sidebar-hover` | `oklch(0.967 0.001 286.375)` | `oklch(0.274 0.006 286.033)` | Nav hover bg |
| `--sidebar-border` | `oklch(0.92 0.004 286.32)` | `oklch(1 0 0 / 10%)` | Sidebar right border |

### 3.8 Geometry

| Token | Value | Use |
|--|--|--|
| `--radius` | `0.625rem` (10px) | Buttons, inputs, cards, popovers |
| `--radius-sm` | `0.375rem` (6px) | Chips, badges, small buttons |
| `--radius-lg` | `0.875rem` (14px) | Dialogs, sheets, large cards |
| `--radius-pill` | `9999px` | Avatars, pills, toggle switches |

### 3.9 Elevation

| Token | Value | Use |
|--|--|--|
| `--shadow-1` | `0 1px 2px oklch(0 0 0 / 0.04)` | Resting cards |
| `--shadow-2` | `0 4px 12px oklch(0 0 0 / 0.08)` | Hover cards, popovers |
| `--shadow-3` | `0 12px 32px oklch(0 0 0 / 0.12)` | Drag overlay, dialogs |
| `--shadow-4` | `0 24px 64px oklch(0 0 0 / 0.16)` | Sheets, command palette |

Dark mode multiplies each shadow by `1.25` because shadows are weaker on dark surfaces.

### 3.10 Motion

| Token | Value | Use |
|--|--|--|
| `--motion-instant` | `50ms` | Hover color shift, focus ring |
| `--motion-fast` | `120ms` | Small UI: button press, chip toggle |
| `--motion-base` | `200ms` | Default: popovers, menus, sidebar collapse |
| `--motion-slow` | `320ms` | Page transitions, drag overlays |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | 90% of motion — feels like Linear |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | Sidebar collapse, sheet slide |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Success micro-bounces |

`prefers-reduced-motion: reduce` zeroes every `--motion-*` token.

---

## 4 · Typography

Two families, six sizes, five weights. That is the whole type system.

### 4.1 Families

| Token | Family | Use |
|--|--|--|
| `--font-sans` | `Inter Variable`, system-ui fallback | UI, body, headings |
| `--font-mono` | `JetBrains Mono Variable`, `ui-monospace` fallback | IDs, paths, code, numerics |
| `--font-display` | `Inter Variable` (tight tracking) | Hero text, empty states |

### 4.2 Sizes (modular scale 1.125)

| Token | Size / line-height | Use |
|--|--|--|
| `--text-xs` | `0.75rem / 1rem` (12/16) | Captions, helper, table footnotes |
| `--text-sm` | `0.8125rem / 1.125rem` (13/18) | Default body, table cells |
| `--text-base` | `0.875rem / 1.25rem` (14/20) | Default body on wide screens |
| `--text-md` | `1rem / 1.5rem` (16/24) | Card titles, section headers |
| `--text-lg` | `1.125rem / 1.625rem` (18/26) | Page titles |
| `--text-xl` | `1.375rem / 1.75rem` (22/28) | Hero, empty-state title |

### 4.3 Weights

| Token | Value | Use |
|--|--|--|
| `--weight-regular` | `400` | Body |
| `--weight-medium` | `500` | Nav labels, button text |
| `--weight-semibold` | `600` | Card titles, table headers |
| `--weight-bold` | `700` | Page titles only |

### 4.4 Numerics

All numeric cells use `font-variant-numeric: tabular-nums` so columns of figures align. The `mono` family is reserved for IDs, paths, and raw code; numerics stay in `sans` unless they are an ID.

### 4.5 Long content

Body copy uses `text-wrap: pretty`; headings use `text-wrap: balance`. Code blocks, table cells, and IDs use `text-wrap: nowrap` with `overflow: hidden; text-overflow: ellipsis` and a tooltip on hover.

---

## 5 · Spacing & layout

### 5.1 Spacing scale (4px base)

| Token | px | Use |
|--|--|--|
| `--space-0` | `0` | Reset |
| `--space-1` | `4px` | Tight stack, chip padding-y |
| `--space-2` | `8px` | Inline gap, button padding-y |
| `--space-3` | `12px` | Default inline gap, control padding |
| `--space-4` | `16px` | Card padding, stack gap, control padding-x |
| `--space-5` | `20px` | Section padding |
| `--space-6` | `24px` | Page section gap |
| `--space-8` | `32px` | Page padding |
| `--space-10` | `40px` | Hero vertical rhythm |
| `--space-12` | `48px` | Page-level separators |
| `--space-16` | `64px` | Empty-state padding |

### 5.2 Layout grid

- Desktop default: **12-column, 16px gutter, max 1440px content.**
- Sidebar: **260px expanded, 60px collapsed**, `--motion-base` ease.
- Topbar: **56px tall**, single row.
- Right detail drawer: **360px** when open, slides over content on <1280px, pushes content on ≥1280px.

### 5.3 Density

Two density modes, user-toggleable per workspace:

| Mode | Row height | Padding-y | Use |
|--|--|--|--|
| **Compact** (default) | `32px` | `4px` | Power-user, screen-fillers |
| **Comfortable** | `40px` | `8px` | Touch, lower-resolution |

Density is a single CSS class on `<html>`: `data-density="compact"` or `"comfortable"`. Every list, table, and tree honors it. Card padding does not change with density.

### 5.4 Z-index scale

| Layer | Value | Use |
|--|--|--|
| `--z-base` | `0` | Content |
| `--z-sticky` | `10` | Table headers, sticky filters |
| `--z-dropdown` | `1000` | Dropdowns, autocomplete |
| `--z-sticky-nav` | `1100` | Topbar, sidebar |
| `--z-overlay` | `1300` | Modal backdrop |
| `--z-modal` | `1400` | Dialogs, sheets |
| `--z-popover` | `1500` | Context menus, command palette |
| `--z-toast` | `1600` | Toasts, notifications |
| `--z-tooltip` | `1700` | Tooltips |

No z-index above `1700`. If you need it, you have mis-designed.

---

## 6 · Motion & elevation

### 6.1 Default transitions

| Element | Property | Duration | Easing |
|--|--|--|--|
| Button bg | `background-color` | `--motion-instant` | `--ease-out` |
| Button press | `transform` | `--motion-fast` | `--ease-out` |
| Card hover | `box-shadow, transform` | `--motion-base` | `--ease-out` |
| Popover open | `opacity, transform` | `--motion-base` | `--ease-out` |
| Sidebar collapse | `width` | `--motion-base` | `--ease-in-out` |
| Page transition | `opacity` | `--motion-slow` | `--ease-out` |
| Drag overlay enter | `opacity, transform` | `--motion-fast` | `--ease-spring` |
| Toast | `transform` | `--motion-base` | `--ease-spring` |

### 6.2 Micro-interactions

- **Live indicator:** green dot, 1.6s pulse animation (`opacity` 1→0.4→1, `--motion-slow`). Respects `prefers-reduced-motion`.
- **Streaming text:** no special animation. Cursor blinks at end of last token, 1s cadence.
- **Drag:** cursor changes to `grabbing` on `mousedown`. Drag overlay uses `--shadow-3` and `transform: rotate(1.5deg) scale(1.02)` for a "lifted" feel.
- **Save:** inline checkmark flash, `--motion-fast`, `--ease-spring`. No modal.
- **Error:** subtle 2px left border inside the input + focus ring tint `--danger`. No shake animation.

### 6.3 Reduced motion

When `prefers-reduced-motion: reduce`:
- All `--motion-*` tokens set to `0ms`.
- Drag overlay: no rotation/scale, only opacity.
- Page transitions: instant.
- Live indicator: static dot, no pulse.

---

## 7 · Layout

### 7.1 App shell

The app shell is a fixed two-column layout: a sticky topbar on top, a sidebar on the left, and the main content area (SidebarInset) on the right. An optional status bar lives at the bottom on desktop and is hidden by default; it surfaces when there is an active alert.

```
┌─────────────────────────────────────────────────────────────────────┐
│  TOPBAR  56px   workspace · breadcrumb · status · search · user      │
├──────────┬──────────────────────────────────────────────────────────┤
│          │                                                          │
│  SIDEBAR │              SIDEBAR INSET                               │
│  260px   │              max 1440px, centered                        │
│          │                                                          │
│  nav     │              page content                                │
│  groups  │                                                          │
│          │                                                          │
├──────────┴──────────────────────────────────────────────────────────┤
│  STATUS BAR  28px  (optional)  online · tokens · latency · build   │
└─────────────────────────────────────────────────────────────────────┘
```

### 7.2 Topbar

| Slot | Width | Contents |
|--|--|--|
| Left | 320px | Bizar logo · workspace switcher · project picker |
| Center | flex | breadcrumb (route) + inline search (Cmd+K opens palette; inline search is for quick find) |
| Right | auto | Status pills (agents online · tokens · queue) · notifications bell · theme toggle · user menu |

The topbar is sticky (`--z-sticky-nav`). It is **not** a tab bar — tabs live inside views when needed.

### 7.3 Sidebar

| Slot | Contents |
|--|--|
| Header | Workspace switcher (240px), collapse toggle (right edge) |
| Section: **Workspace** | Overview, Tasks, Goals |
| Section: **Operations** | Agents, Activity, Memory |
| Section: **Libraries** | Skills, MCP servers, Hooks |
| Section: **System** | Settings |
| Footer | Status indicator (online/offline), build SHA, version |

Each section has an 11px uppercase label in `--fg-subtle` with `letter-spacing: 0.04em`. Items are 32px tall, single line, with a 16x16 Lucide icon, label, and an optional count badge (right-aligned, `--fg-muted`). The active item uses `--sidebar-accent` background with `--sidebar-accent-fg` text and a 2px left-edge bar in `--sidebar-accent` (a single permitted use of an edge bar — it is the *only* navigation primitive allowed to use one).

### 7.4 Content area

The `SidebarInset` is a 1440px-max container with `--space-8` horizontal padding and `--space-6` top padding (topbar adds the rest). Pages render their own header (ViewHeader primitive — see §8.4) and then their content.

### 7.5 Optional right detail drawer

The kanban and agents views can open a right-side **DetailDrawer** (360px). It slides in from the right with `--motion-base` and pushes content (≥1280px) or overlays it (<1280px). It contains:
- Read view: title, metadata, body, activity, comments
- Edit view: same + editable fields inline

### 7.6 Routes

| Path | Page | Default view |
|--|--|--|
| `/` | Overview | Dashboard summary |
| `/tasks` | Tasks | Kanban (the main focus) |
| `/tasks/list` | Tasks | List view |
| `/tasks/calendar` | Tasks | Calendar view |
| `/goals` | Goals | Active goals |
| `/goals/:id` | Goal detail | Single goal |
| `/agents` | Agents | Roster |
| `/agents/:id` | Agent detail | Single agent |
| `/activity` | Activity | Event log |
| `/memory` | Memory | Vault browser |
| `/libraries/skills` | Skills | Library |
| `/libraries/mcps` | MCP servers | Library |
| `/libraries/hooks` | Hooks | Library |
| `/settings/*` | Settings | Hierarchical |

The nav stays at **6 top-level items** (Workspace, Operations, Libraries, System — the rest are sub-routes of the existing items). The user explicitly said "I do not want too many tabs", so we surface items as nav groups with secondary tabs inside the page.

### 7.7 Empty states

Every collection view has an `EmptyState` (see §8.5) with:
- A 24px Lucide icon in `--fg-subtle`
- A one-line title in `--text-md` `--weight-medium`
- A one-sentence body in `--fg-muted`
- One primary CTA button (`--accent`)
- Optional secondary text link

No illustrations, no emoji, no "celebrate your first task" copy.

---

## 8 · Component library

The library lives at `bizar-dash/src/web/ui/`. Every component is named with PascalCase, lives in its own file, exports a named function, and has a colocated `.test.tsx` file. No default exports.

### 8.1 `ui/primitives/` — no business logic

- **Box** — `div` with tokens (bg, fg, padding, radius)
- **Stack** — vertical flex with `--space-N` gap
- **Inline** — horizontal flex with `--space-N` gap
- **Cluster** — wraps inline elements that pack
- **Grid** — CSS grid wrapper with col/row gap
- **Center** — centers content (empty states)
- **Separator** — 1px horizontal/vertical rule
- **ScrollArea** — themed scroll wrapper, hides scrollbars unless scrolling
- **Resizable** — wraps `react-resizable-panels`
- **VisuallyHidden** — `sr-only` helper
- **Portal** — Radix Portal wrapper

### 8.2 `ui/controls/` — form & input

- **Button** (variants: `primary | secondary | ghost | outline | danger | link`, sizes: `xs | sm | md | lg | icon`)
- **ButtonGroup** — stacked buttons with shared borders
- **IconButton** — square, icon-only, requires `aria-label`
- **Input** — single-line text, optional left/right slots
- **Textarea** — multi-line, autoresize
- **InputOTP** — segmented code input
- **Select** — Radix Select wrapper (single)
- **MultiSelect** — Radix Popover + command list (multi)
- **Combobox** — Radix Popover + list + input (async-capable)
- **Checkbox** — Radix Checkbox
- **RadioGroup** — Radix RadioGroup
- **Switch** — Radix Switch
- **Toggle** — single toggle button
- **ToggleGroup** — Radix ToggleGroup
- **Slider** — Radix Slider
- **DatePicker** — single date
- **DateRangePicker** — two dates
- **TimePicker** — single time
- **ColorPicker** — popover with swatches + input
- **Field** — label + control + error + helper wrapper
- **Form** — React Hook Form + Zod integration

### 8.3 `ui/feedback/` — feedback & status

- **Alert** — inline banner, variants `info | success | warning | danger`
- **Toast** — Sonner wrapper, top-right, auto-dismiss 5s
- **Dialog** — Radix Dialog (modal)
- **AlertDialog** — destructive confirm
- **Sheet** — Radix Dialog with side prop (right/left/top/bottom)
- **Drawer** — bottom-sheet variant for mobile
- **Popover** — Radix Popover
- **HoverCard** — Radix HoverCard (preview on hover)
- **Tooltip** — Radix Tooltip, 4-side aware
- **Progress** — linear bar
- **ProgressCircle** — circular determinate/indeterminate
- **Spinner** — single-element rotating arc
- **Skeleton** — shimmering placeholder
- **EmptyState** — see §7.7
- **ErrorBoundary** — React error boundary
- **Banner** — full-width inline banner

### 8.4 `ui/data/` — data display

- **Card** — generic container with optional header/footer slots
- **StatTile** — single metric, optional delta indicator
- **StatGrid** — N-up grid of StatTiles
- **Table** — semantic `<table>` (low-level)
- **DataTable** — TanStack Table wrapper (sort, filter, paginate, select, resize, virtualize)
- **Badge** — small label, variants `default | accent | success | warning | danger | neutral`
- **Chip** — removable tag with avatar/icon
- **Avatar** — image or initials, with optional status dot
- **AvatarStack** — overlapping avatars
- **Timeline** — vertical event list with timestamps
- **Accordion** — Radix Accordion
- **Collapsible** — single show/hide
- **Chart** — Recharts wrapper (LineChart, BarChart, AreaChart, PieChart) bound to chart tokens
- **Sparkline** — inline mini-chart
- **MetricRing** — circular progress with label
- **BarList** — horizontal ranked list (used in activity feeds)
- **TreeView** — Radix Accordion-based tree
- **VirtualList** — TanStack Virtual wrapper
- **Kbd** — keyboard key cap
- **CountBadge** — numeric pill, optional max cap (e.g. "99+")
- **ViewHeader** — page title + description + actions slot (used at top of every page)

### 8.5 `ui/navigation/` — navigation

- **Sidebar** (root + provider) — wraps `nav`, handles collapse
- **SidebarProvider** — context, persisted collapsed state
- **SidebarInset** — content slot inside SidebarProvider
- **SidebarSection** — labeled section
- **SidebarItem** — single nav row
- **SidebarGroup** — collapsible group
- **Topbar** — top bar slot composition
- **Breadcrumb** — list of links
- **NavLink** — Radix-styled anchor with active state
- **Tabs** — Radix Tabs wrapper
- **TabBar** — styled tab strip
- **TabPanel** — content slot
- **Menu** — Radix DropdownMenu with shortcut display
- **ContextMenu** — Radix ContextMenu (right-click trigger)
- **DropdownMenu** — Radix DropdownMenu
- **Menubar** — Radix Menubar
- **Pagination** — page + per-page controls
- **Stepper** — multi-step progress
- **CommandPalette** — Cmd+K overlay (see §9.4)
- **CommandBar** — inline command (Ctrl+K for filter focus)
- **NavSection** — labeled section for sidebar
- **NavItem** — sidebar row primitive
- **NavGroup** — collapsible section in sidebar
- **ViewTabs** — tab strip below ViewHeader

### 8.6 `ui/kanban/` — the main feature

This directory is the largest and most important. The kanban is the centerpiece of the dashboard.

- **KanbanBoard** — root container, owns DnD context
- **KanbanColumn** — column with header (title, count, actions), droppable body, add-task footer
- **KanbanCard** — task card, draggable, with all metadata visible
- **KanbanCardCompact** — minimal card for high-density mode
- **KanbanCardExpanded** — preview-on-hover or detail-drawer card
- **KanbanDetail** — right-side drawer content
- **KanbanFilters** — filter bar (assignee, label, priority, due, search)
- **KanbanGroupBy** — group-by selector (status / assignee / label / priority / due / project)
- **KanbanSort** — sort selector
- **KanbanDensity** — compact/comfortable toggle
- **KanbanEmptyState** — column empty state
- **KanbanKeyboardShortcuts** — helper component showing available shortcuts
- **KanbanQuickAdd** — inline add input at top of each column
- **KanbanContextMenu** — right-click menu (see §9.2)
- **KanbanDragOverlay** — drag preview

### 8.7 `ui/popups/` — right-click & custom popups

All popups are Radix-based or custom portals. **Browser default context menus are suppressed on all interactive surfaces** (`oncontextmenu` returns `false`); right-click opens our `ContextMenu`.

- **ContextMenu** — Radix ContextMenu (right-click + Shift+F10)
- **ActionMenu** — vertical list of actions with icons + shortcuts
- **SubActionMenu** — nested action menu (Radix Sub)
- **QuickAction** — single-action right-click shortcut
- **CommandBar** — Cmd+K overlay
- **DetailDrawer** — right-side drawer with read/edit toggle
- **ConfirmDialog** — destructive confirmation
- **InfoPopover** — hover/click popover with rich content

### 8.8 `ui/theme/` — theming

- **ThemeProvider** — light/dark/system, persists to `localStorage`
- **useTheme** — hook returning `{ theme, setTheme, resolvedTheme }`
- **ThemeToggle** — dropdown trigger
- **DensityProvider** — compact/comfortable
- **useDensity** — hook

### 8.9 `ui/utils/`

- **cx** — `clsx` + `tailwind-merge` wrapper
- **formatNumber**, **formatPercent**, **formatBytes**, **formatDuration**, **formatRelativeTime** — display formatters
- **useHotkeys** — global hotkey registry (see §9.3)
- **useFocusTrap** — focus trap for popovers
- **useMediaQuery** — responsive hook
- **useReducedMotion** — accessibility hook
- **useDebouncedValue** — search input debounce
- **useLocalStorage** — typed localStorage hook

### 8.10 `ui/hooks/` — cross-cutting hooks

- **useWebSocket** — typed WS subscriber
- **useAgents** — agent roster query
- **useTasks** — task query/mutation
- **useGoals** — goal query/mutation
- **useShortcuts** — keyboard shortcut dispatcher
- **useContextMenu** — opens Radix ContextMenu at cursor
- **useDragAndDrop** — dnd-kit wrapper

---

## 9 · Interaction patterns

### 9.1 The five inviolable rules

1. **Right-click is sacred.** Every interactive surface has a `ContextMenu`. No element falls back to the browser default.
2. **Keyboard parity.** Every action has a shortcut. Every menu item shows the shortcut right-aligned in `Kbd` style.
3. **Cmd+K is everything.** Cmd+K opens the command palette, which contains every page, every action, every setting, every shortcut reference.
4. **Optimistic by default.** Mutations apply instantly; rollback on error with a toast. No spinners on the user's own actions.
5. **Real-time by default.** Live data refreshes via WS without user action; the green pulse indicator shows the connection is live.

### 9.2 Right-click context menus

Right-click menus replace browser defaults everywhere except in `<input>`, `<textarea>`, and `[contenteditable]`. The trigger is `onContextMenu` on the element, opening a Radix `ContextMenu`.

```tsx
<KanbanCard onContextMenu={(e) => {
  e.preventDefault();
  openContextMenu(task.id, e);
}}>
  ...
</KanbanCard>
```

Every context menu follows this structure:

```
┌─────────────────────────────────────┐
│  Open in drawer           ⌘↵        │
│  Edit                   E          │
│  Duplicate              ⇧D         │
│  Copy link              ⌥L         │
│  ────────────────────────────────  │
│  Assign to agent           ▸       │
│  Move to column           ▸       │
│  Set priority             ▸       │
│  ────────────────────────────────  │
│  Archive                ⌘⇧A         │
│  Delete (danger)        ⌫          │
└─────────────────────────────────────┘
```

The keyboard equivalent is **Shift+F10** when the element has focus. We render the same menu for both triggers.

### 9.3 Keyboard shortcuts

Every shortcut is registered in `ui/utils/shortcuts.ts` and bound through `useHotkeys`. Shortcuts are scoped:

| Scope | Modifiers | Examples |
|--|--|--|
| **Global** | `Cmd`/`Ctrl` | `Cmd+K` palette, `Cmd+B` sidebar, `Cmd+/` shortcuts |
| **Tasks view** | none (when focused) | `C` new, `E` edit, `/` search, `1-9` jump column |
| **Anywhere** | `Cmd` | `Cmd+S` save (if open editor), `Cmd+,` settings |

Shortcuts ignore typing when an `<input>` or `<textarea>` has focus unless the modifier is `Cmd`/`Ctrl`. The Command Palette shows all available shortcuts and is searchable.

### 9.4 Command Palette (Cmd+K)

Built on `cmdk` (the same library Linear uses). Triggers:

| Command | Description |
|--|--|
| `Cmd+K` (Mac) / `Ctrl+K` (Win/Linux) | Open |
| `Esc` | Close |
| `↑↓` | Navigate |
| `↵` | Execute |
| `Tab` | Switch scope (Actions / Pages / Settings) |

Three scopes (tabs):
1. **Actions** — quick mutations on the current selection. If nothing is selected, falls back to general actions.
2. **Navigate** — every page, with breadcrumbs.
3. **Settings** — every settings key, jump to its setting page.

The palette has a fuzzy-search input at the top, a list of matches, and a footer showing the current scope + scope-switch hint.

### 9.5 Optimistic mutations

Every mutation goes through `useMutation` from TanStack Query:

```ts
const updateTask = useMutation({
  mutationFn: api.tasks.update,
  onMutate: (newTask) => {
    queryClient.setQueryData(['tasks'], applyUpdate(old, newTask));
    return { previous: old };
  },
  onError: (_err, _vars, ctx) => {
    queryClient.setQueryData(['tasks'], ctx?.previous);
    toast.error('Could not save — reverted');
  },
  onSettled: () => queryClient.invalidateQueries(['tasks']),
});
```

The UI updates instantly; the toast confirms or reverts. No spinners on user-initiated mutations.

### 9.6 Real-time updates

The dashboard maintains a single WebSocket connection (`/ws/dashboard`) that streams:

- `tasks:change` — task created/updated/deleted
- `agents:change` — agent registered/deregistered
- `goals:change` — goal progress tick
- `activity:event` — new event in activity log
- `routing:decision` — new routing decision
- `cost:tick` — cost reservation update
- `system:status` — health, version, build

All hooks consume these via `useWebSocket` + React Query cache invalidation. The connection state shows in the topbar's status pill (green pulse = connected, amber = reconnecting, red = offline).

### 9.7 Hover & focus

- Hover previews use `HoverCard` with a 400ms delay, 200ms close.
- Focus rings: `--focus-ring` 2px outline + 2px offset, always visible on keyboard focus, never on mouse click.
- Tooltip: 4-side aware, 200ms delay, `--motion-base` ease.

### 9.8 Empty states

(See §7.7.) Every collection has a deliberate empty state with one CTA. We never say "Nothing to see here." We always say what to do next.

---

## 10 · Settings model

Settings is hierarchical, scoped, and always findable. The full settings surface lives at `/settings/*` with a sidebar in the page itself (not the global sidebar).

### 10.1 Section structure

```
/settings
├── /general          Workspace name, logo, default project
├── /appearance       Theme, density, accent color (future)
├── /agents           Default agent roster, max concurrency
├── /goals            Goal cadence, review interval
├── /tasks            Default workflow, custom statuses, kanban config
├── /skills           Skill library, default skill, auto-suggest
├── /mcps             MCP servers, auth, per-tool permissions
├── /hooks            Hook config (Pre/Post/UserPrompt)
├── /routing          Model tiers, cost ceiling, fallback
├── /memory           Vault location, retention, distillation
├── /notifications    Per-event toggles, channels
├── /security         Webhook secrets, HMAC keys, PII mode
├── /integrations     GitHub, Slack, webhooks
├── /billing          Cost gate, room budget, alerts
├── /team             Members, roles (future)
└── /advanced         Debug, traces, export/import, reset
```

### 10.2 Settings page pattern

Every settings page follows the same skeleton:

```
┌─ ViewHeader ────────────────────────────────────────────────────┐
│  Settings · Agents                          [ Save changes ]   │
│  Default roster and concurrency for new sessions.               │
├────────────────────────────────────────────────────────────────┤
│  ┌─ FieldGroup ──────────────────────────────────────────────┐ │
│  │  Default roster size       [ 8 ]            — help text  │ │
│  │  Max concurrent agents     [ 16 ]           — help text  │ │
│  │  Agent types               [ multi-select ] — help text  │ │
│  │  Auto-spawn on session     [ toggle ON ]    — help text  │ │
│  └──────────────────────────────────────────────────────────┘ │
│  ┌─ FieldGroup ──────────────────────────────────────────────┐ │
│  │  Restart agents on config change  [ toggle OFF ]          │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

A field group is a `Card` containing one or more `Field` rows. Each field has a label, control, and helper text (one short sentence). Fields auto-save on blur with an inline checkmark; an explicit "Save changes" button is reserved for grouped forms.

### 10.3 Settings discovery

- Every setting is reachable via Cmd+K (palette).
- Every setting is reachable via `/settings` breadcrumb.
- The settings sidebar is **the only** place that lives in the page (not the global sidebar) so it has room to breathe.

---

## 11 · Accessibility

WCAG 2.2 AA is the floor. We aim higher where it does not cost.

### 11.1 Color & contrast

- All text/background pairs meet **AA 4.5:1** (body) and **AA 3:1** (large text, icons).
- Charts use shape + color (never color alone).
- Status indicators always have a shape or label in addition to color (green dot + "live"; red dot + "errored").

### 11.2 Keyboard

- Every interactive element is reachable via Tab.
- Focus order is visual order.
- Focus ring is always visible on keyboard focus.
- Modals trap focus; popovers return focus on close.
- Drag-and-drop has a keyboard alternative (`Space` to pick up, arrows to move, `Enter` to drop, `Esc` to cancel).

### 11.3 Screen readers

- Every icon-only button has `aria-label`.
- Every form control has a `<label>` (visible or sr-only).
- Live regions (`aria-live="polite"`) for activity updates and toasts.
- Tables use `<th scope="col">`; data tables announce sort state.

### 11.4 Motion

- `prefers-reduced-motion` zeroes motion tokens (§6.3).
- Auto-playing animations have a pause control.
- Drag/drop has a non-motion alternative.

### 11.5 Touch & pointer

- Minimum target size: **44x44px** for touch (mobile/tablet), **24x24px** for desktop.
- Right-click has a long-press alternative on touch (650ms hold).
- Hover-only patterns have a focus equivalent.

---

## 12 · Banned tropes

Audited before every PR via `scripts/check-design-tropes.sh`.

- **No gradients.** Anywhere. As backgrounds, as fills, as borders, as button hovers. The accent color is solid. Charts use solid fills. Period.
- **No vertical accent stripes on containers.** Active state uses background tint + weight + motion. The single permitted edge bar is the 2px active-item bar inside `SidebarItem` (§7.3).
- **No purple, blue, or rainbow washes.** The accent is green. Charts are grayscale. Status colors are semantic.
- **No emoji in UI copy.** Use Lucide icons.
- **No "Lorem ipsum".** Every placeholder is realistic.
- **No "Feature One / Feature Two".** Labels are real.
- **No "Loading…" spinners as primary state.** Use skeleton or streaming copy ("Fetching agents…").
- **No default browser context menus** on any interactive surface.
- **No modal-on-modal stacking.** A modal cannot open another modal without an explicit close.
- **No tooltips on disabled buttons.** Tooltip on hover only when the action is enabled; if disabled, helper text appears inline.
- **No invented metrics.** Real numbers or "—" placeholder.
- **No glass / blur / noise effects.** Surfaces are solid fills.
- **No animated icons** except the live indicator pulse.

---

## 13 · Visual contract for new screens

A new screen must:

1. Pick one of the seven layouts from §7 (default: topbar + sidebar).
2. Use tokens from §3 only — never raw colors.
3. Use type from §4 only — never custom families.
4. Use motion from §6 only — never bespoke easings.
5. Use icons from `lucide-react` — never emoji or custom SVGs (unless domain-specific, in which case it goes in `ui/icons/`).
6. Use components from `ui/` only — never rebuild primitives.
7. Honor density mode (§5.3).
8. Honor `prefers-reduced-motion`.
9. Honor `prefers-color-scheme` via the theme system.
10. Have right-click context menus on every interactive element.
11. Have keyboard shortcuts for every action.
12. Have an empty state, a loading state, and an error state.
13. Have at least one place where the green accent earns its keep.
14. Document its data shape in `bizar-dash/src/web/views/<name>/README.md`.
15. Have a colocated `.test.tsx` file with the AAA pattern.

---

## 14 · Pre-merge checklist

Run before opening a PR that touches UI:

```sh
pnpm check:design-tropes   # grep for banned patterns (§12)
pnpm check:a11y            # axe-core on every new page
pnpm check:visual          # screenshot diff at 1440/1100/768/390
pnpm test -- ui            # component tests
pnpm e2e                   # full app boots, no console errors
pnpm check:keyboard        # manual keyboard-only walkthrough (CI recorded)
```

All five must pass. The visual diff must not regress at any of the four widths. The keyboard walkthrough must reach every interactive element via Tab only.

---

## Appendix A · shadcn preset `b7kBsBkh7b`

The dashboard is initialized with:

```sh
pnpm dlx shadcn@latest init --preset b7kBsBkh7b
```

Per the [shadcn CLI v4 changelog](https://ui.shadcn.com/docs/changelog/2026-03-cli-v4), presets are opaque codes resolved by the CLI. The `b7kBsBkh7b` preset ships:

- Pre-configured `components.json` (style: `new-york`, base color: `neutral`, CSS variables: `yes`, icon library: `lucide`).
- Pre-tuned `tailwind.config.ts` with the OKLch color ramp.
- Pre-installed primitives matching the foundation in §3.

If the preset resolves to a different package set than expected, the plan still holds: §3 is the contract, the preset is the bootstrap. Any preset mismatch is resolved by overriding `components.json` and running `pnpm dlx shadcn@latest add <component>` for each missing primitive in §8.

The provided OKLch theme in the user's brief maps directly to §3 — every token in `:root` (light) and `.dark` is taken verbatim from the brief, then extended with the geometry, motion, and z-index tokens that the preset does not cover.

---

## Appendix B · File map

```
bizar-dash/src/web/
├── App.tsx
├── main.tsx
├── ui/
│   ├── index.ts              # barrel export
│   ├── primitives/
│   ├── controls/
│   ├── feedback/
│   ├── data/
│   ├── navigation/
│   ├── kanban/
│   ├── popups/
│   ├── theme/
│   ├── hooks/
│   ├── utils/
│   └── styles/
│       ├── reset.css
│       ├── tokens.css        # the entire §3, generated from JSON
│       └── globals.css
├── views/
│   ├── Overview/
│   ├── Tasks/
│   ├── Goals/
│   ├── Agents/
│   ├── Activity/
│   ├── Memory/
│   ├── Libraries/
│   └── Settings/
├── icons/                    # domain-specific Lucide extensions
├── routes.tsx                # TanStack Router route tree
└── server/                   # existing REST API (unchanged)
```

---

**End of DESIGN.md — v8.0.0**
