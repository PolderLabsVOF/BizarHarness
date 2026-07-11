# DESIGN.md — Bizar Dashboard

> **v8.0 — Minimalist overhaul.** The dashboard now reads as one
> functional system: Supabase-style icon rail, Grafana-style metric
> density, flat cards, solid status colors, no gradients, no
> glow, no decorative stripes, no AI-looking chrome. Every
> component is built from the tokens defined here; if a future
> change isn't covered, add it to this file first.

## 0 · How to use this file

This document is the **single source of truth** for visual decisions
in the dashboard. Every component, every color, every animation must
be derivable from the tokens and rules below.

**Token binding.** Components consume CSS variables (`--bg`,
`--text-strong`, `--accent`) defined in `:root` of `styles/main.css`.
Do not hardcode hex outside `:root`. Derive tints with
`color-mix(in oklab, var(--accent) X%, var(--bg-elev))`.

**Themes.** Two themes — **dark** (default) and **light**
(`[data-theme="light"]`). Both share the same token names; only
the values change. Every component reads correctly in both themes.

## 1 · Principles

1. **Operator-quality, not consumer-quality.** Dense, numeric,
   monospace-friendly. Information per square inch > breathing
   room. Whitespace is spent on legibility, not decoration.
2. **One accent, used with intent.** The accent earns its place by
   signaling primary action, active state, or data emphasis. Solid
   color fills only — **no gradients**, no purple washes, no
   drop-shadow glows.
3. **State is signal, not decoration.** Active / streaming / awaiting /
   error / success must be distinguishable at a glance without
   reading copy. Use weight, background fill, motion, color — but
   **never vertical accent edges on containers**.
4. **Type does hierarchy.** Inter carries body, JetBrains Mono
   carries metadata. Tabular numerics on every number. Display
   sizes scale with container.
5. **Layout over chrome.** Sidebar is a thin icon-rail with labels.
   Topbar is one row. Cards carry the design — chrome doesn't.

## 2 · Anti-patterns (audited before each PR)

These break the design system. Review blocker if found:

- ❌ **Any gradient declaration** — `linear-gradient`, `radial-gradient`,
  `conic-gradient` — anywhere except in the rare preview swatch.
- ❌ **Drop shadows on text/brand glyphs** (`drop-shadow`, `text-shadow`
  on body copy).
- ❌ **Decorative top stripes** on cards, toasts, providers, tasks.
  `::before { background: var(--accent); height: 2px }` is banned.
- ❌ **Left accent edges** on containers (`border-left: 3px solid`,
  `box-shadow: inset 2px 0 0`).
- ❌ **Pulsing glow rings** on chrome (`box-shadow: 0 0 12px ...`).
- ❌ **Generic emoji icons** in cards, lists, or empty states. Use
  Lucide.
- ❌ **Backdrop-blur on every surface** — reserved for modal overlays.
- ❌ **Filler copy** — "Feature One", "Lorem ipsum", invented metrics.
- ❌ **Raw hex outside `:root`** — every color must reference a token.

## 3 · Color tokens

### 3.1 Surface scale (dark, default)

```
--bg            #0e1014    page canvas
--bg-elev       #15171c    cards, topbar, sidebars
--bg-elev-2     #1c1f25    nested surfaces (inputs, hover)
--bg-elev-3     #24272f    pressed / active surface
--border        #24272f    hairlines
--border-strong #2f333d    focus rings, dividers
```

### 3.2 Surface scale (light)

```
--bg            #fafafa
--bg-elev       #ffffff
--bg-elev-2     #f4f4f5
--bg-elev-3     #e4e4e7
--border        #e4e4e7
--border-strong #d4d4d8
```

### 3.3 Text scale

| Token | Dark | Light | Use |
|---|---|---|---|
| `--text-strong` | `#fafafa` | `#0a0a0a` | Headings, primary content |
| `--text` | `#a1a1aa` | `#27272a` | Body |
| `--text-dim` | `#71717a` | `#52525b` | Captions, metadata |
| `--text-on-accent` | `#ffffff` | `#ffffff` | Text on accent fills |

### 3.4 Brand accent

Solid teal-green (Supabase-aligned). Used sparingly:

| Token | Dark | Light | Use |
|---|---|---|---|
| `--accent` | `#10b981` | `#059669` | Primary action, active state |
| `--accent-2` | `#34d399` | `#047857` | Hover state on accent |
| `--accent-3` | `#6ee7b7` | `#065f46` | Subdued accent text |
| `--accent-bg` | `rgba(16,185,129,0.10)` | `rgba(5,150,105,0.08)` | Tinted panel backgrounds |
| `--accent-border` | `rgba(16,185,129,0.35)` | `rgba(5,150,105,0.30)` | Tinted borders |

**Accent budget.** Two uses per region, max.

### 3.5 Status colors

| Token | Dark | Light | Use |
|---|---|---|---|
| `--success` | `#10b981` | `#059669` | OK, done, connected |
| `--warning` | `#f59e0b` | `#d97706` | Stuck, retry, spike |
| `--error` | `#ef4444` | `#dc2626` | Failed, deleted, auth error |
| `--info` | `#3b82f6` | `#2563eb` | Neutral informational |
| `--success-soft` | `rgba(16,185,129,0.12)` | `rgba(5,150,105,0.10)` | Pill bg |
| `--error-soft` | `rgba(239,68,68,0.12)` | `rgba(220,38,38,0.08)` | Error region bg |
| `--warning-soft` | `rgba(245,158,11,0.12)` | `rgba(217,119,6,0.10)` | Warning region bg |
| `--info-soft` | `rgba(59,130,246,0.12)` | `rgba(37,99,235,0.10)` | Info region bg |

### 3.6 Chart palette (Grafana-aligned, discrete)

Used for time-series bars, area fills, multi-series:

```
--chart-1   #10b981  primary series (success-aligned)
--chart-2   #f59e0b  warn
--chart-3   #ef4444  error
--chart-4   #3b82f6  info
--chart-5   #8b5cf6  secondary (sparingly — no gradients)
--chart-grid #24272f
```

## 4 · Typography

### 4.1 Font stacks

```
--font-sans:  'Inter var', 'Inter', system-ui, -apple-system, ...
--font-mono:  'JetBrains Mono', 'Fira Code', 'SF Mono', monospace
```

### 4.2 Scale

| Token | px | Use |
|---|---|---|
| `--fs-display` | 28 | View titles |
| `--fs-h3` | 14 | Card titles |
| `--fs-body` | 13 | Default body |
| `--fs-meta` | 12 | Captions, timestamps |
| `--fs-micro` | 11 | Numeric eyebrows, badges |

### 4.3 Weight scale

| Weight | Use |
|---|---|
| 400 | Body, captions |
| 500 | Tab labels, button text |
| 600 | Card titles, section heads, active nav |
| 700 | Reserved for hero metrics |

## 5 · Spacing (8-point grid)

```
--space-1  4px    --space-2  8px    --space-3  12px
--space-4  16px   --space-5  20px   --space-6  24px
--space-8  32px   --space-12 48px
```

Card padding defaults to `--space-4` (16px). View padding
`--space-6` (24px). Page-level hero `var(--space-12)` top.

## 6 · Radius

```
--radius-sm   6px    inputs, small buttons, badges
--radius      8px    buttons, tabs, default cards
--radius-md   10px    metric cards
--radius-lg   12px    modals, kanban cards, topbar dropdowns
--radius-xl   16px    dialog, command palette
--radius-pill 999px   status pills
```

## 7 · Elevation

```
--shadow-1   0 1px 0 0 var(--border)         hairline on raised
--shadow-2   0 1px 3px 0 rgba(0,0,0,0.40)    dropdowns, popovers
--shadow-3   0 8px 24px 0 rgba(0,0,0,0.45)   modals
--shadow-focus 0 0 0 2px var(--accent-bg)    focus ring (no glow)
```

**No glow shadows.** No `0 0 12px var(--accent)`. Borders and flat
shadows separate surfaces, glow does not.

## 8 · Motion

```
--motion-fast   120ms
--motion-base   200ms
--motion-slow   320ms
--ease          cubic-bezier(0.4, 0, 0.2, 1)
```

**No animations on data.** Numbers update in place. Streaming dots
pulse opacity only, never scale or rotate. Pulse rings on system
chrome only (WebSocket connecting, Cline runtime).

## 9 · Layout shells

### 9.1 Sidebar (default — Supabase-style rail)

```
┌────────────┐
│  ᛒ         │ ← logo + runic glyph (no drop-shadow)
│            │
│ ⌂ Overview │ ← 200px wide, label always visible, icon 16px
│ 💬 Chat    │
│ 🤖 Agents  │
│ ◆ Glyphs   │
│ ✓ Tasks    │
│ ⚡ Active  │
│ ✦ Skills   │
│ 🧠 Memory  │
│ ⏱ Schedules│
│ ⌚ History │
│ ⛁ Usage    │
│ ✓ Eval     │
│ ⚕ Doctor   │
│ ⛨ Harness  │
│ ⊙ Goals    │
│ ─────────  │
│ ⚙ Settings │ ← pinned to bottom
└────────────┘
```

- Width: 200px collapsed (icons + labels).
- Active: `--bg-elev-2` background, `--accent` left edge (2px solid,
  full height of the row) + `--text-strong` text. This is the ONE
  exception to "no left edges" — it replaces the banned gradient
  with a single 2px solid bar.
- Hover: `--bg-elev-2` background, `--text` text.
- Section divider: hairline `--border` between built-in and mod tabs.
- Settings row pinned to bottom of the rail.

### 9.2 Topbar

```
┌──────────────────────────────────────────────────────────────────┐
│  ⌂  /  Bizar · project-name                            🔍 ⌘K  • │  ← 48px tall, flat
└──────────────────────────────────────────────────────────────────┘
```

- Height: 48px.
- Background: `--bg-elev`.
- Bottom border: 1px `--border`.
- Brand left, breadcrumb middle, search + ws status right.
- **No backdrop-blur.** No version pill glow.
- Tabs row removed — sidebar carries navigation.

### 9.3 View frame

```
┌──────────────────────────────────────────────────────────────────┐
│  view-header                                                     │
│  ──────────                                                      │
│  [stat grid]                                                     │
│  [content grid]                                                  │
└──────────────────────────────────────────────────────────────────┘
```

- View padding: `--space-6`.
- Header has bottom border `--border`.
- No animation on view-in. Pages snap in.

## 10 · Components

### 10.1 Card

- Background: `--bg-elev`.
- Border: 1px `--border`.
- Radius: `--radius` (8px) for default; `--radius-md` (10px) for metric.
- Padding: `--space-4`.
- **No `::before` top stripe.** **No glow on hover.** Hover: border
  becomes `--border-strong`, no transform.
- Header: title (`--fs-h3`, weight 600) + optional meta (`--fs-meta`,
  `--text-dim`).
- Body: stack with `--space-3` gap.

### 10.2 Metric card (StatCard)

```
┌──────────────────────────┐
│ Total requests       ⓘ   │  ← 11px uppercase eyebrow
│                          │
│ 582                      │  ← 28px weight 700 mono numeric
│ ▁▂▃▄▅▆▇▅▄▃▂▁             │  ← inline sparkline 32px tall
│ Jul 22 ──── Jul 28       │  ← 11px caption
└──────────────────────────┘
```

- Background: `--bg-elev`.
- Border: 1px `--border`.
- Padding: `--space-4`.
- **No icon box.** Sparkline only.
- Sparkline stroke 1.5px in `--chart-1`.

### 10.3 Button

```
.btn-sm    24px tall, 8px 12px padding
.btn       32px tall, default
.btn-lg    40px tall, primary CTAs only

Variants:
  .btn-primary    --accent fill, white text
  .btn-secondary  --bg-elev-2 fill, --border outline
  .btn-ghost      transparent, hover = --bg-elev-2
  .btn-danger     transparent, --error text + border
```

- Radius: `--radius`.
- Weight: 500.
- Hover: background change only. No translate, no shadow.

### 10.4 Status pill / badge

```
.pill            --bg-elev-2 bg, --text mono uppercase 10px
.pill-success    --success-soft bg, --success text
.pill-warning    --warning-soft bg, --warning text
.pill-error      --error-soft bg, --error text
.pill-info       --info-soft bg, --info text
```

Pills = uppercased categorical labels.
Badges = numeric counts.

### 10.5 Inputs

```
.input       32px tall, --bg-elev fill, --border outline
             focus: --accent border + 2px --accent-bg ring
```

- Radius: `--radius`.
- Mono font only for paths/hex; sans for everything else.

### 10.6 Kanban (Tasks)

4 columns (Backlog → Todo → In progress → Review → Done).

- Column: `--bg-elev` background, `--border` outline.
- Header: 12px mono uppercase title + numeric count.
- Card: 14px padding, 8px radius, **no top stripe**. Priority encoded
  with a small dot in the corner (high=red, mid=info, low=dim).
- Drag: 1px `--accent` outline + `--shadow-2`.

### 10.7 Tables

- Hairline borders (`--border`), no row striping.
- Header: `--text-dim`, `--font-mono`, 12px uppercase.
- Body row: 13px, `--text`. Hover: `--bg-elev-2` wash.

### 10.8 Toast

- Bottom-right, stacks upward.
- 360px wide, `--bg-elev-2`, `--radius`, `--shadow-2`.
- **No top stripe.** Status encoded with a 4px square dot prefix.
- Lifetimes: `info` 2.5s, `success` 3s, `warning` 5s, `error` 8s.

### 10.9 Modal

- Backdrop: `--overlay-bg` (60% black).
- Surface: `--bg-elev`, `--radius-lg`, `--shadow-3`.
- Title: 14px weight 600.
- Footer: `--border` top hairline, right-aligned actions.

## 11 · Iconography

Lucide React. 1.6 stroke width. Standard sizes:

| Size | Use |
|---|---|
| 12px | Inline-with-text icons |
| 14px | Button icons, badge icons |
| 16px | Sidebar nav, card-level |
| 20px | Empty-state hero |
| 24px | Brand glyph `ᛒ` (no drop-shadow) |

## 12 · Accessibility

- WCAG 2.2 AA contrast on all body text vs its surface.
- `:focus-visible` ring: 2px `--accent` outline + 2px offset.
- Keyboard navigation: tab order follows visual order. Modals trap
  focus. Esc closes. `Cmd/Ctrl+K` opens search.
- `aria-current="true"` on active nav.
- Color is never the sole signal — always pair with text or icon.

## 13 · Responsive

| Breakpoint | Behavior |
|---|---|
| ≥ 1440px | Sidebar visible + content full |
| 1024–1439 | Sidebar visible, content max-width 1200 |
| 768–1023 | Sidebar collapses to icons-only (56px) |
| < 768 | Mobile shell takes over (separate code path) |

## 14 · View index

Each view declares a layout shape and the metrics it displays.
Live data is bound from `/snapshot.*` endpoints.

| View | Layout |
|---|---|
| Overview | Hero stats (4) + 2-col (activity + memory) + chart row |
| Chat | 3-column (rail · thread · info) |
| Agents | 3-col card grid |
| Glyphs | Masonry grid |
| Tasks | 5-column kanban |
| Activity | Timeline |
| Active (BG) | List with collapsible rows |
| Skills | 3-col card grid |
| Memory | 3-column (source rail · main · detail) |
| Mods | Sidebar list + detail |
| Schedules | Card list |
| History | Session list |
| Usage | 4 stat cards + chart row |
| Eval | Run list + last detail |
| Doctor | Hero score + 8 subsystem cards |
| Harness | Audit rules list |
| Settings | SettingsNav (left) + sections (right) |
| Goals | Goal planner |

## 15 · Versioning

- **v8.0 (this rev)** — Minimalist overhaul. Removed all gradients,
  drop-shadows, decorative top stripes, pulsing glows. Flat,
  functional, Supabase + Grafana inspired. Sidebar becomes icon-rail
  with visible labels. Topbar flattens to one row.
- v7.0 — View index, data shapes.
- v6.0 — Cline runtime badge, Harness tab, brand pill.
- v5.x — Eval framework, Doctor.
- v4.x — Settings mode, char-counter, semi-collapsed topbar.
- v3.x — Mods, chat overhaul, semantic spacing, command palette.
- v2.x — Light theme, kanban, hooks refactor.