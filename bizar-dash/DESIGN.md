# DESIGN.md — Bizar Dashboard

> The BizarHarness dashboard. Norse-pantheon operator surface, dark-mode
> first, dense by intent. **v7.0** — adds the comprehensive view index,
> per-view data shapes, and the patterns needed for the eight secondary
> tabs (Overview, Agents, Active, Skills, Memory, Mods, Schedules,
> Settings) that v6 didn't fully document.

## 0 · How to use this file

This document is the **single source of truth** for visual decisions in
the dashboard. Every component, every color, every animation should be
derivable from the tokens and rules below. If a future change isn't
covered here, **add it to this file first**, then implement it.

**Token binding.** Components consume CSS variables (`--bg`,
`--text-strong`, `--accent`) defined in `:root` of `styles/main.css`.
Do not hardcode hex outside `:root`. Derive tints with
`color-mix(in oklch, var(--accent) 12%, transparent)` rather than
inventing new tokens.

**Themes.** The dashboard ships two themes — **dark** (default) and
**light** (`[data-theme="light"]`). Both share the same token names;
only the values change. Every component must read correctly in both
themes without per-component overrides. Tokens are written in
**OKLch** because the lightness/chroma/hue model flips cleanly across
themes without the dark-mode channel separation that hex/rgb needs.

**Visual contract for new screens.** A new view must:
1. Sit on one of three layouts (topbar / sidebar / both).
2. Use tokens from §3-§8 only.
3. Document its data shape in §15.
4. Have a P0 entry in the checklist (§14) and pass it.

---

## 1 · Principles

These five rules govern every visual decision. When in doubt, follow
them in order; if two conflict, the higher rule wins.

1. **Operator-quality, not consumer-quality.** Surfaces are dense,
   numeric, monospace-friendly. Information per square inch matters
   more than breathing room. Whitespace is spent on legibility, not
   decoration.
2. **One accent, used with intent.** The accent earns its place by
   signaling primary action, active state, or data emphasis. No AI
   gradients. No purple washes behind text. No purple stripes on
   container edges.
3. **State is signal, not decoration.** Active, streaming, awaiting,
   error, success — every state must be distinguishable at a glance
   without reading copy. Use weight, glow, motion, and color — but
   **never vertical accent edges on containers**.
4. **Type does hierarchy.** `Inter` carries the body, `JetBrains Mono`
   carries the metadata. Tabular numerics on every number. Display
   sizes scale with container, not viewport. Long copy wraps pretty.
5. **Layout over chrome.** The sidebar is rail-thin. The topbar is one
   row. The chat thread is the product. Chrome that doesn't pay rent
   gets removed.

---

## 2 · Brand & voice

| | |
|--|--|
| **Wordmark** | Bizar · runic `ᛒ` glyph in `var(--accent)` |
| **Version pill** | mono text on a `var(--accent)` → `oklch(0.55 0.22 25)` gradient |
| **Voice** | Direct, technical, never marketing. "404 not found" not "Oops! Something went wrong." Numbers with units. |
| **Tab labels** | Single noun (`Chat`, `Agents`, `Tasks`). No icons-in-paragraphs. |
| **Status copy** | "Streaming" not "Loading…". "Awaiting your reply" not "Ready". "13 of 47" not "Lots". |

**Banned tropes** (audited before each PR):

- Aggressive purple gradient backgrounds behind text or as page chrome.
- Vertical accent stripes on containers (`box-shadow: inset 2px 0 0 …`,
  `border-left: 3px solid …`). State-encoded or not. Active state uses
  background, weight, glow, or motion — **never a left-edge bar**.
- Generic emoji icons in feature lists (✨ 🚀 🎯 ❓). Use Lucide.
- Inter as a display face for hero/section titles (Inter is body;
  display uses larger sizes of the same family but tighter tracking).
- Filler copy: "Feature One", "Lorem ipsum", invented metrics.

---

## 3 · Color tokens

All values written in OKLch where possible. Hex kept only for legacy
or external-tool interop.

### 3.1 Surface scale (dark, default)

```
--bg            oklch(15% 0.012 260)    #0b0e14  page canvas
--bg-elev       oklch(18% 0.012 260)    #12161f  cards, topbar, sidebars
--bg-elev-2     oklch(22% 0.014 260)    #1a1f2b  nested surfaces
--bg-elev-3     oklch(27% 0.016 260)    #232a39  hover / pressed surfaces
--border        oklch(27% 0.016 260)    #232a39  hairlines
--border-strong oklch(33% 0.018 260)    #2d3648  focus rings, dividers
```

`--bg-1` and `--bg-2` from v6.x are deprecated; use `--bg-elev` and
`--bg-elev-2` instead. (The chat composer backdrop uses
`color-mix(in oklch, var(--bg-elev), black 12%)` for that nested feel.)

### 3.2 Surface scale (light)

```
--bg            oklch(98% 0.004 240)    #f7f8fa
--bg-elev       oklch(100% 0 0)        #ffffff
--bg-elev-2     oklch(96% 0.006 240)    #f0f3f8
--bg-elev-3     oklch(92% 0.008 240)    #e6ebf2
--border        oklch(90% 0.008 240)    #e2e8f0
--border-strong oklch(82% 0.012 240)    #cbd5e1
```

### 3.3 Text scale

| Token | Dark (OKLch) | Light (hex) | Use |
|---|---|---|---|
| `--text-strong` | `oklch(96% 0.005 240)` | `#0f172a` | Headings, primary content |
| `--text` | `oklch(82% 0.010 245)` | `#1f2937` | Body |
| `--text-dim` | `oklch(72% 0.012 245)` | `#475569` | Captions, metadata |
| `--text-on-accent` | `oklch(100% 0 0)` | `#ffffff` | Text over accent fills |

### 3.4 Brand accent

| Token | Dark | Light | Use |
|---|---|---|---|
| `--accent` | `oklch(0.62 0.18 273)` | `oklch(0.55 0.20 273)` | Primary action, active state, focus |
| `--accent-2` | `oklch(0.72 0.16 273)` | `oklch(0.48 0.20 273)` | Hover state on accent |
| `--accent-3` | `oklch(0.82 0.10 273)` | `oklch(0.40 0.18 273)` | Subdued accent text |
| `--accent-bg` | `color-mix(in oklch, var(--accent) 12%, transparent)` | same, 8% | Tinted panel backgrounds |
| `--accent-border` | `color-mix(in oklch, var(--accent) 40%, transparent)` | same, 30% | Tinted borders |
| `--accent-glow` | `color-mix(in oklch, var(--accent) 18%, transparent)` | same | Focus glow shadow |
| `--accent-soft` | `color-mix(in oklch, var(--accent) 8%, transparent)` | same, 6% | Hover wash on neutral surface |

**Accent budget.** Two uses per region, max. Default allocation:
1. Active nav item background OR primary CTA fill.
2. Active state badge OR streaming pill.

### 3.5 Status colors (OKLch in both themes)

| Token | Dark | Light | Use |
|---|---|---|---|
| `--success` | `oklch(0.72 0.16 145)` | `oklch(0.50 0.15 145)` | Streaming OK, task done, connected |
| `--warning` | `oklch(0.78 0.14 70)` | `oklch(0.55 0.15 70)` | Stuck agent, retry, cost spike |
| `--error` | `oklch(0.66 0.20 25)` | `oklch(0.52 0.20 25)` | Failed, deleted, auth error |
| `--info` | `oklch(0.72 0.13 235)` | `oklch(0.50 0.15 235)` | Neutral informational |
| `--success-soft` | `color-mix(in oklch, var(--success) 15%, transparent)` | same, 12% | Status pill bg |
| `--error-soft` | `color-mix(in oklch, var(--error) 12%, transparent)` | same, 10% | Error region bg |
| `--warning-soft` | `color-mix(in oklch, var(--warning) 15%, transparent)` | same, 10% | Warning region bg |

### 3.6 Derived tokens (chat overhaul, v3.21 — preserved)

```
--gradient-hello   linear 90deg, var(--accent-3) → var(--accent)
--gradient-name    linear 90deg, var(--accent) → oklch(0.55 0.22 25)
```

Both gradients are reserved for the **chat greeting** (`hello, name`)
and **brand mark** (`ᛒ Bizar`) — never used elsewhere.

### 3.7 Syntax highlight (json tree in JSON viewer)

```
--syntax-key      oklch(0.78 0.13 235)
--syntax-string   oklch(0.84 0.10 235)
--syntax-number   oklch(0.78 0.16 60)
--syntax-boolean  oklch(0.68 0.20 25)
--syntax-null     oklch(0.68 0.20 25)
```

### 3.8 Anti-pattern reference colors

| Token | Value | When to use |
|---|---|---|
| ~~`--left-stripe`~~ | *banned* | Never. See §1.3. |
| ~~purple page wash~~ | *banned* | Body backgrounds must be `--bg` or `--bg-elev`. |
| ~~`#fff` raw~~ | `--text-strong` | Pure white is jarring on dark; use `--text-strong`. |

---

## 4 · Typography

### 4.1 Font stacks

```
--font-sans:
  'Inter var', 'Inter', system-ui, -apple-system, 'Segoe UI',
  Roboto, 'Helvetica Neue', sans-serif

--font-mono:
  'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code',
  Consolas, monospace
```

Inter variable enables `cv02`, `cv03`, `cv04`, `cv11` stylistic sets
for more legible numbers, parentheses, and `@` symbol.

### 4.2 Scale

| Token | px | Use |
|---|---|---|
| `--fs-display` | 28 | Section title in chrome bars |
| `--fs-h3` | 16 | Card title |
| `--fs-body` | 14 | Default body (small for density) |
| `--fs-meta` | 12 | Captions, timestamps |
| `--fs-micro` | 11 | Numeric eyebrows, badges |

Tabular numerics (`font-variant-numeric: tabular-nums`) on every cell
that contains numbers: token counters, costs, latencies, timestamps,
session ids.

### 4.3 Weight scale

| Weight | Use |
|---|---|
| 400 | Body, captions |
| 500 | Tab labels, button text |
| 600 | Card titles, section heads, active nav |
| 700 | Reserved for hero metrics only |

### 4.4 Heading rhythm

- h1: never used in dashboard chrome. Display goes to `--fs-display` with
  letter-spacing `-0.02em`.
- h2 / h3: card-level. `--fs-h3` (16px) weight 600.
- Avoid long display copy inside cards; let the body carry meaning.

---

## 5 · Spacing

8-point grid, with semantic aliases introduced in v4.6.0:

```
--space-1  4px    --spacing-xs    icon-to-text, micro gap
--space-2  8px    --spacing-sm    between rows in a stack
--space-3  12px   --spacing-md    default card padding
--space-4  16px   --spacing-lg    section padding
--space-6  24px   --spacing-xl    page-level padding
--space-8  32px                    topbar vertical padding
--space-10 40px
--space-12 48px                    panel header padding
--space-16 64px                    rare, full-page sections
--space-20 80px
--space-24 96px                    hero only
```

**Card padding.** Default is `--space-3` (12px) — the dashboard is dense.
Use `--space-4` (16px) only on kanban cards and chat info panels.

---

## 6 · Radius

```
--radius-sm    6px    inputs, small buttons, badges
--radius       8px    buttons, tabs, default cards
--radius-md    10px    chat message bubbles
--radius-lg    14px    modals, kanban cards, topbar dropdowns
--radius-xl    16px    dialog, command palette
--radius-pill  999px   status pills, tag chips
```

---

## 7 · Elevation

```
--shadow-1   0 1px 2px rgba(0,0,0,0.45)              hairlines on cards
--shadow-2   0 4px 12px rgba(0,0,0,0.45)             dropdowns, popovers
--shadow-3   0 12px 32px rgba(0,0,0,0.45)            modals
--shadow-glow 0 0 0 1px accent-border + glow         focused/active surfaces
```

Shadows are dark-tinted (not blurred gray) to read on the dark canvas.
Avoid shadows on hairline borders; the border already separates.

---

## 8 · Motion

```
--motion-fast   120ms
--motion-base   200ms
--motion-slow   320ms
--ease          cubic-bezier(0.4, 0, 0.2, 1)
--motion-ease   cubic-bezier(0.2, 0, 0, 1)   sharp, intentional
```

**Streaming indicator.** Three dots in `--accent`, staggered opacity
animation, `--motion-slow` per dot. Never use a spinner on a streaming
chat — the user knows it's typing.

**Pulsing badges** (Cline runtime, WebSocket connecting). Use `--ease`,
`--motion-slow`, infinite, alternate. Never use on content inside the
chat thread; only on system-state chrome.

**No animations on data.** Token counts, cost numbers, task counts
update in place. The number just changes — no flicker, no count-up.

---

## 9 · Components catalog

The dashboard ships ~60 components. Every new component must slot into
one of these categories.

### 9.1 Chrome

#### Topbar
```
┌─────────────────────────────────────────────────────────────────────────┐
│  ᛒ Bizar v6.0.0 │ project ▾ │ ⌘K Search... │  • Cline·active • ws·live │  ← 1 row, ~52px tall
│  [Overview][Chat][Agents][Glyphs][Tasks][Activity][Active][Skills]...   ← 2nd row, tabs (topbar layout only)
└─────────────────────────────────────────────────────────────────────────┘
```

- Brand block: runic `ᛒ` (24px, `--accent`) + "Bizar" wordmark +
  version pill. Pill uses `--gradient-name` and
  `text-shadow: 0 1px 0 rgba(0,0,0,0.2)` so it reads on light too.
- Project selector: pill button with `Folder` icon + project name +
  chevron. Dropdown is `--bg-elev-2` with 8px radius, items 32px tall.
- Search trigger: pill button with kbd hint `⌘K`, `--border` outline.
- WebSocket status: dot (8px) + label. Dot color encodes state:
  green=live, yellow=connecting, red=closed, gray=disabled.

#### Sidebar (sidebar / both layout)
```
┌──────┐
│  ⌂   │  ← icon-only buttons, 56px wide × 44px tall
│  💬  │
│  🤖  │
│  ✦   │  ← ~17 tabs in scrollable column
│  ... │
│  ⚙   │  ← Settings pinned to bottom
└──────┘
```

- Width: 56px collapsed.
- Active state: `--accent-bg` background + `--accent` icon color +
  bold weight on the (hidden) label. **No left edge stripe.**
- Mod tabs (post v3.20.3) sit below a hairline divider labelled "Mods".
- Settings mode (v4.9.0) replaces tab list with the full SettingsNav.

### 9.2 Buttons

```
.btn-sm   24px tall, 8px 12px padding, 12px text
.btn      32px tall, default, 13px text
.btn-lg   40px tall, primary CTAs only

Variants
  .btn-primary       accent fill, white text, accent border
  .btn-secondary     transparent, --border, --text
  .btn-ghost         transparent, no border, hover → --fg
  .btn-danger        transparent, --error text on hover
  .btn-icon          square, icon-only, 32×32
```

Disabled = 50% opacity, `cursor: not-allowed`, no hover. **Never** show
a disabled button with a spinner inside it — show the spinner *instead*
of the button or use a loading state on the button itself.

### 9.3 Inputs

```
.input       32px tall, --bg-elev, --border, focus = --accent border + glow
.textarea    auto, min 96px tall, resizes vertically
.input-mono  same as .input, font-family: --font-mono  (used for hex/path fields)
```

Search trigger in the topbar is a `.input` styled as a pill with a kbd
hint inside it on the right.

### 9.4 Status pills & badges

```
.pill            999px radius, --accent-bg bg, --accent text, 11px mono uppercase
.pill-success    --success-soft bg, --success text
.pill-warning    --warning-soft bg, --warning text
.pill-error      --error-soft bg, --error text
.pill-info       --info bg (muted), --info text

.badge           square corner, --bg-elev-2 bg, --text text, 11px mono, 14px square
.dot             8px circle, color encodes state
```

Pills = uppercased categorical labels (`STREAMING`, `MOD`, `BETA`).
Badges = numeric counts (unread messages, queued tasks).

### 9.5 Cards

```
.card            --bg-elev, --border, --radius-lg (14px), --space-3 padding
.card-elev-2     --bg-elev-2 (nested surfaces)
.card-flat       no background, no border
.card-rule       top border in --text-strong, used in log-style lists
```

Kanban card: 16px padding, 14px radius, `box-shadow: --shadow-1` only
on drag.

### 9.6 Modal & dialog

- Backdrop: `--overlay-bg` (60% black).
- Surface: `--bg-elev-2`, `--radius-xl`, `--shadow-3`.
- Title: `--fs-h3` weight 600, `--space-3` from top.
- Footer: `--border` top hairline, right-aligned actions.

Command palette (v3.1.0+): 520px wide, centered, 16px padding, kbd row
in footer showing shortcuts.

### 9.7 Toast

- Bottom-right, stacks upward, 4 visible max.
- Width 360px, `--bg-elev-2`, `--radius-md`, `--shadow-2`.
- Color-coded left edge of *icon*, not the toast background.
- Lifetimes: `info` 2.5s, `success` 3s, `warning` 5s, `error` 8s.

### 9.8 Tabs (topbar variant)

- 36px tall, `--fs-meta` text, `--font-mono`.
- Active: `--text-strong` + 2px `--accent` underline (positioned at
  bottom of the tab, full-width).
- Hover: `--text-strong` (no underline).
- Settings tab: shows a small `Settings2` icon next to its label when
  settings mode is active.

### 9.9 Sidebar tabs (sidebar / both layout)

- 56px wide column, 44px tall.
- Icon 18px, label hidden (tooltip via `title`).
- Active: `--accent-bg` background, `--accent` icon, 600 weight label.
- Inactive: `--text-dim` icon.

### 9.10 Chat

#### Rail (`<aside class="chat-rail">`)
- Width 280px. Sections grouped by recency: Today, Yesterday, This
  week, Earlier.
- Each row: state indicator (8px dot, color per state) + title + time
  + unread badge + 3-dot menu.
- Active session background: `--accent-bg` with no left stripe.
- Sub-agent tree: collapsible, indented 12px, smaller text, hairline
  connector.

#### Thread (`<section class="chat-thread-section">`)
- Center column, fills remaining width.
- Thread head: title + source badge (`cline` / `bizar chat`) + subtitle
  with state (idle / Replying / Your turn).
- Messages: alternating bubbles. User right-aligned, `--bg-elev-2`
  bubble. Assistant left-aligned, no bubble (transparent).
- Streaming indicator: three pulsing dots in `--accent`, animated.
- Jump-to-latest pill (when scrolled up): floating, bottom-right of
  thread, `--bg-elev-2` + `--shadow-2`.

#### Composer
- Pill-shaped input, `--bg-elev` outer, `--bg-elev-2` inner field.
- Attachments: chip row above input.
- Slash command suggestions: popover above, mono, `--font-mono`.
- Agent + model selectors: pill chips on left, opens dropdown on
  click.

#### Info panel (`<aside class="chat-info">`)
- Width 320px, sections (Session, Agent, Model, Tokens, Cost,
  Attached agents, MCPs, Slash commands, Actions).
- Token usage: numeric + horizontal progress bar (`--bg-elev-2` track,
  `--accent` fill, 4px tall).
- Cost: numeric + "approx · live from MiniMax" caption when not
  measured.

### 9.11 Tables

- Hairline borders (`--border`), no row striping.
- Header row: `--text-dim`, `--font-mono`, 12px, uppercase, 0.04em
  letter-spacing.
- Body row: 14px, `--text`, 12px 14px padding.
- Numerics: `--font-mono`, `tabular-nums`, right-aligned.
- Hover: `--bg-elev-2` wash — not a colored row.

### 9.12 Kanban (Tasks)

5-column board: Backlog → Todo → In progress → Review → Done.

- Column header: 12px mono uppercase, count badge, scrollable column
  body.
- Card: 14px radius, 16px padding, kanban-card-shadow only on drag.
- Team badge (v6.0.0): pill with sparkle icon, attached to cards
  tagged `team:*`.
- Drag: 1px `--accent-border` outline, `--shadow-3`.

### 9.13 Status indicators (session, agent, runtime)

| State | Dot | Background | Animation |
|---|---|---|---|
| idle | `--text-dim` | none | none |
| streaming | `--success` | `--success-soft` 4px wash on icon | pulsing glow |
| awaiting | `--warning` | none | none |
| error | `--error` | `--error-soft` ring | shake once on entry |
| connecting | `--text-dim` | none | opacity 0.4↔1, slow |

### 9.14 Glyph artifact cards

- Square 1:1, `--bg-elev`, 1px `--accent-border` on hover.
- Title in `--fs-h3`, 11px mono caption.
- Send / Copy / Edit icon row in footer.

### 9.15 Notifications bell

- 16px bell icon, dot for unread count.
- Panel: 360px wide, scrolls, items 64px tall, hairline separators.

### 9.16 Search modal

- 600px wide, 80vh max height.
- Input at top (large), results list below.
- Each result: icon + title + path (mono, dim) + kbd hint.
- Arrow keys to navigate, Enter to open.

### 9.17 Sparkline & metric charts

- Inline SVG, 32px tall, `--accent` stroke 1.5px, gradient fill (8% → 0%).
- Right-aligned delta: `--success` for "up is good", `--error` for "up is bad".
- Numeric body always tabular-nums.

### 9.18 Workflow DAG visualizer (v6.0.0)

Used in Tasks card detail and Eval reports.
- Nodes: rounded rectangles (8px radius), `--bg-elev-2` background, hairline border.
- Node states: idle / running / done / failed / skipped — colored border + center dot.
- Edges: 1.5px lines in `--text-dim`, animated dashed line on the "currently running" edge.
- Vertical timeline: time on the left axis in mono.

### 9.19 Approval queue (v6.0.0)

Used in Plans & Memory tabs.
- Each row: 56px tall, agent avatar + plan title + target file (mono) + Approve / Steer / Reject buttons.
- Hairline separators; rejected plans get a thin `--error-soft` wash on hover-to-undo.
- Bulk action toolbar floats above the queue when ≥1 selected.

### 9.20 Cost / token chart card (v6.0.0)

Used in Usage (MiniMax) and Overview.
- Card: title + period selector (24h / 7d / 30d) + big numeric + sparkline + breakdown bars.
- Breakdown bars: horizontal stacked bar by model, `--accent` for primary, `--text-dim` for others.
- Always tabular-nums. Always right-aligned.

### 9.21 BG agent live panel (v6.0.0)

Used in Active tab.
- Row: 56px tall, agent avatar + name + status pill + elapsed (mono, 1s tick) + action buttons (pause / steer / stop).
- Status pill variants: `running` (success pulse) / `paused` (warning) / `stuck` (warning static + Retry) / `done` (text-dim).
- Collapsed by default, expands to show streaming output and tool calls.

---

## 10 · Patterns

### 10.1 Layout shells

Three layouts selectable in Settings → UI → Layout:

| Layout | Topbar tabs | Sidebar nav | Main grid |
|---|---|---|---|
| `topbar` | visible | hidden | topbar + view |
| `sidebar` | collapsed (no tabs row) | visible | sidebar + view |
| `both` | collapsed | visible | sidebar + view + small topbar |

Default is `sidebar` (v6.0.0). Switching layouts preserves the active
tab.

### 10.2 3-column chat

```
┌────────┬──────────────────────────────┬─────────┐
│  Rail  │  Thread                      │  Info   │
│ 280px  │  flex                        │  320px  │
│        │                              │         │
│        │  [composer always at bottom] │         │
└────────┴──────────────────────────────┴─────────┘
```

- All three columns scroll independently.
- Composer sticks to bottom of thread column (`position: sticky`,
  `bottom: 0`, `--bg-elev` backdrop).
- Info panel collapses below 1100px (becomes a sheet above 768px).

### 10.3 Streaming thread

When a session is in `streaming` state:

- Source badge in thread head pulses `--success` glow.
- Subtitle reads "Replying · odin · open-design".
- Footer of thread shows three pulsing dots in `--accent`.
- Composer is disabled (`pointer-events: none` on the textarea, send
  button replaced with a small stop icon).

### 10.4 Active tab navigation

- Active tab has accent underline (topbar) or accent background
  (sidebar).
- Keyboard: `1`–`9` for first 9 tabs, `0` for Overview (v3.2.0).
- Browser back/forward navigates tab history.

### 10.5 Status of background agents

`Active` tab shows live background agents. Each row:

```
[●] odin       odin@open-design  · streaming   4m12s   [pause][steer][stop]
```

- Dot color = agent state.
- Time elapsed updates every second (`--motion-fast`).
- Action buttons are `.btn-sm .btn-ghost`.
- Stuck agents (>5 min no progress) get a yellow dot + a `Retry`
  button.

### 10.6 Memory sources

4 sources, each with its own glyph + accent-tinted background:

| Source | Glyph | Accent |
|---|---|---|
| project notes | `Brain` | `--accent` |
| skills | `Sparkles` | `--accent-2` |
| tasks | `CheckSquare` | `--success` |
| activity log | `Activity` | `--info` |

A unified search bar queries all 4 in parallel; results are grouped by
source with the matching glyph on the left of each row.

### 10.7 Cline runtime badge (v6.0.0)

```
┌──────────────────────────┐
│  ● Cline · active        │   ← pulse when state=active
└──────────────────────────┘
```

8px dot, label in mono. Lives in topbar-right. `active` = pulsing
green. `idle` = static dim. `unavailable` = static red. `unknown` =
static gray.

### 10.8 Doctor / Harness status pills

Subsystem status: 4 pill states, 5-dim progress bars.

```
[●] Cline runtime          active     ▰▰▰▰▰▱▱▱▱  5/8
[●] Task scheduler         active     ▰▰▰▰▰▰▱▱▱  6/8
[●] Memory store           degraded   ▰▰▰▱▱▱▱▱▱  3/8
[●] WebSocket              active     ▰▰▰▰▰▰▰▰▱  7/8
```

Pills are pill-success / pill-warning / pill-error as appropriate.
Progress bars: `--bg-elev-2` track, `--accent` fill. **No colored
track backgrounds** — color stays on the fill, not on the rail.

### 10.9 Overview dashboard layout (v6.0.0)

```
┌────────────────────────────────────────────────────────────────┐
│  HEADER:  ⌂ Bizar   project▾   ⌘K Search  • ws·live  • cline   │
├────────────────────────────────────────────────────────────────┤
│  HERO ROW (4 cards):                                           │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ │
│  │ tokens/hr  │ │ latency    │ │ error rate │ │ cost/hr    │ │
│  │ 1.42M      │ │ 842ms      │ │ 0.21%      │ │ $1.84      │ │
│  │ +12% ▲     │ │ −18ms ▼    │ │ +0.04 ▲    │ │ −8% ▼      │ │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘ │
├────────────────────────────────────────────────────────────────┤
│  TWO-COL:                                                      │
│  ┌──────────────────────┐ ┌──────────────────────────────┐    │
│  │ Live activity feed   │ │ Active agents (3 running)    │    │
│  │ (timestamped rows)   │ │ (status rows w/ pause)       │    │
│  │                      │ │                              │    │
│  │                      │ │ Memory health                │    │
│  │                      │ │ (4 sources at a glance)      │    │
│  └──────────────────────┘ └──────────────────────────────┘    │
├────────────────────────────────────────────────────────────────┤
│  GRAPH ROW:                                                    │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ Token spend · last 24h  (large sparkline + breakdown)   │ │
│  └──────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
```

### 10.10 Cost dashboard layout (Usage tab)

```
┌────────────────────────────────────────────────────────────────┐
│  HEADER  Usage  · 24h ▾    $1.84/hr  −8% ▲                    │
├────────────────────────────────────────────────────────────────┤
│  STAT CARDS (4):                                               │
│  [spent 24h] [cost/hr] [tokens/hr] [alerts]                   │
├──────────────────────────────┬─────────────────────────────────┤
│  TOKEN SPEND CHART           │  MODEL BREAKDOWN               │
│  (stacked area, last 24h)    │  (horizontal bars per model)   │
│                              │                                 │
├──────────────────────────────┼─────────────────────────────────┤
│  RECENT ALARMS               │  BUDGET STATUS                 │
│  (timeline of cost spikes)   │  (4 budgets, percent gauges)   │
└──────────────────────────────┴─────────────────────────────────┘
```

### 10.11 Active BG agents layout

```
┌────────────────────────────────────────────────────────────────┐
│  HEADER  Active · 3 running 1 paused 1 stuck                   │
├────────────────────────────────────────────────────────────────┤
│  ROW (collapsible, default collapsed):                         │
│  ● odin       streaming  4m12s   [pause][steer][stop][expand]  │
│   ─ expanded: streaming output + tool call list ─              │
│                                                                │
│  ● thor       paused     8m03s   [resume][steer][stop]         │
│  ● mimir      stuck      5m21s   [retry][steer][stop]          │
│  ● tyr        done       2m41s   [restart][remove]             │
└────────────────────────────────────────────────────────────────┘
```

### 10.12 Settings mode (v4.9.0)

When the user enters the Settings tab, the sidebar replaces its
tab list with the full SettingsNav (16 sections). The active section
lights up in the sidebar and the main panel scrolls to it.

```
┌──────┬───────────────────────────────────────────────┐
│ ⌂    │  Theme                                          │
│ 💬   │  ──────                                         │
│ 🤖   │  Accent color        [color picker]             │
│ ... │  Font family         [Inter ▾]                  │
│ ⚙ → │  Compact mode        [▢]                       │
│      │                                                 │
│ ▼    │  Layout                                         │
│ Theme│  ──────                                         │
│ Layo │  UI layout         (•) sidebar ( ) topnav ( ) both│
│ Net  │  Show header        [✓]                       │
│ Auth │                                                 │
│ ...  │                                                 │
└──────┴───────────────────────────────────────────────┘
```

---

## 11 · Iconography

Lucide React. 1.6 stroke width. Two sizes:

| Size | Use |
|---|---|
| 11px | Inline-with-text icons (chat thread head, info panel headers) |
| 12px | Button icons, badge icons |
| 14px | Topbar & sidebar nav icons |
| 16px | Card-level icons |
| 18px | Sidebar collapsed icons (intentional bump for visibility) |
| 20px | Hero / empty-state |

The runic `ᛒ` (berkanan) is the brand glyph — not a Lucide icon. Always
rendered in `var(--accent)` at 24px in the topbar brand block, 14px in
the collapsed sidebar footer.

---

## 12 · Accessibility

- **WCAG 2.2 AA** contrast on all body text vs its surface.
- `:focus-visible` ring: 2px `--accent` outline, 2px offset, 4px
  radius.
- Keyboard navigation: tab order follows visual order. Modals trap
  focus. Esc closes. `Cmd/Ctrl+K` opens search.
- Skip-to-main link (v4.8.0): visually hidden until focused, then pops
  in at top-left.
- `aria-current="true"` on active nav, active session.
- `aria-live="polite"` on the chat log region.
- `aria-selected` on tabs.
- Color is never the sole signal — always pair with text or icon.

---

## 13 · Responsive

Three breakpoints (in addition to mobile which has a dedicated shell
`MobileApp.tsx`):

| Breakpoint | Behavior |
|---|---|
| ≥ 1440px | 3-column chat, sidebar + topbar visible |
| 1100–1439 | 3-column chat, sidebar collapses to icons, info panel optional |
| 768–1099 | Topbar-only layout, info panel becomes sheet |
| < 768 | Mobile shell takes over (separate code path) |

The desktop dashboard never tries to reflow to mobile — `MobileApp.tsx`
is its own tree with its own components.

---

## 14 · Anti-patterns (audited before each PR)

These break the design system. Any of these in a PR gets a review
blocker.

- ❌ **Left color stripes on containers.** `box-shadow: inset 2px 0 0`,
  `border-left: 3px solid`, or any vertical accent edge. Use background,
  weight, glow, or motion instead.
- ❌ **Purple gradient backgrounds behind text or as page chrome.**
  Gradients are reserved for the greeting/brand mark only.
- ❌ **Generic emoji as feature icons** in cards, lists, or empty
  states. Use Lucide or `ᛒ`.
- ❌ **Spinners on disabled buttons.** Use a button-loading state or
  replace the button with the spinner.
- ❌ **Inter as display face at >32px.** Inter is body. If you need a
  display face, propose it in a PR and add the stack to `--font-display`.
- ❌ **Filler copy**: "Feature One", "Lorem ipsum", invented metrics.
- ❌ **Raw hex outside `:root`.** All colors must reference a token.
- ❌ **Row striping in tables.** Use hover wash only.
- ❌ **Shadowed hairlines.** Borders OR shadows, not both.
- ❌ **Status conveyed by color alone.** Always pair with text/icon.
- ❌ **Decimal alignment broken.** Numerics in tables must use
  `tabular-nums` or be right-aligned.
- ❌ **Horizontal scroll on viewport ≥ 1100px.** If your component
  breaks the layout, fix the component.

---

## 15 · View index & data shapes

Every view declares the data it consumes. Mock data lives in
`canvas.html` for visual development; the live API endpoint that
backs each view is documented in `docs/api.md`.

### 15.1 Overview

**Layout:** §10.9. **Endpoint:** `GET /snapshot.overview`.

```ts
interface OverviewData {
  // Live activity (last 50 items, newest first)
  recentActivity: ActivityItem[];

  // Hero metrics
  metrics: {
    tokensPerHour: number;
    avgLatencyMs: number;
    errorRate: number;        // 0..1
    costPerHour: number;      // USD
    activeBgAgents: number;
    activeSessions: number;
  };

  // Active agents (subset of BackgroundAgents)
  activeAgents: BgInstance[];

  // Memory health (4 sources)
  memoryHealth: {
    source: 'lightrag' | 'obsidian' | 'gitsync' | 'semantic';
    state: 'ok' | 'degraded' | 'down';
    lastSync: string;
  }[];

  // Token spend chart (last 24h, hourly buckets)
  tokenSpend: { hour: string; tokens: number; cost: number }[];
}
```

### 15.2 Chat

**Layout:** §10.2. **Endpoints:** `GET /snapshot.sessions` (list),
`GET /api/cline-sessions` (cline), `POST /api/chat` (send),
`WS /ws` (stream).

```ts
interface ChatSession {
  id: string;
  title: string;
  mtime: number;
  state: 'idle' | 'streaming' | 'awaiting';
  source: 'bizar' | 'cline';
  agent: string;
  unread?: number;
  pinned?: boolean;
  tree?: { root: AgentTreeNode };  // orchestrator sub-agents
}

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'tool';
  author: string;
  ts: string;       // HH:MM
  text: ReactNode;
  toolCalls?: ToolCall[];
  pinned?: boolean;
}
```

### 15.3 Agents

**Layout:** Roster grid (3-col on ≥1440px, 2-col on ≥1024px, 1-col
below). **Endpoint:** `GET /snapshot.agents`.

```ts
interface Agent {
  name: string;          // 'odin', 'thor', 'mimir', ...
  model: string;         // 'anthropic/claude-sonnet-4-6'
  mode: string;          // 'plan-then-forseti'
  status: 'idle' | 'busy' | 'stuck' | 'down';
  lastSeen: number;
  tasksCompleted: number;
  avgLatencyMs: number;
}
```

Each card: avatar (first 2 letters), name (mono), model (dim mono),
status pill, last seen time, 3 mini stats.

### 15.4 Glyphs (Artifacts)

**Layout:** Masonry grid of square cards. **Endpoint:**
`GET /snapshot.artifacts`.

```ts
interface Artifact {
  id: string;
  title: string;
  kind: 'glyph' | 'note' | 'doc';
  createdAt: number;
  thumbnail?: string;   // data URL or absent
  size: number;         // bytes
}
```

### 15.5 Tasks

**Layout:** 5-column kanban (§9.12). **Endpoint:** `GET /snapshot.tasks`.

```ts
interface Task {
  id: string;            // 'T-120'
  title: string;
  col: 'backlog' | 'todo' | 'in_progress' | 'review' | 'done';
  priority: 'high' | 'mid' | 'low';
  tags: string[];
  team?: boolean;        // v6 team badge
  by: string;            // agent name
  when: string;          // 'now', '3h', '1d'
}
```

### 15.6 Activity

**Layout:** Timeline (§9.7). **Endpoint:** `WS /api/activity/stream`.

```ts
interface ActivityItem {
  kind: 'agent' | 'task' | 'error' | 'info';
  ts: string;            // HH:MM
  text: ReactNode;       // allows inline mono spans
  target?: string;       // optional file/task id
}
```

### 15.7 Active (Background agents)

**Layout:** §10.11. **Endpoints:** `GET /background`, `WS bg:*`.

```ts
interface BgInstance {
  instanceId: string;
  agent: string;
  prompt: string;
  status: 'pending' | 'running' | 'paused' | 'done' | 'failed';
  startedAt: number;
  elapsedMs: number;
  toolCalls: BgToolCall[];
  output: string;        // last 32k chars
  stuck?: boolean;       // server-flagged
}
```

### 15.8 Skills

**Layout:** Card grid (3-col), each card collapsible. **Endpoint:**
`GET /skills` (planned).

```ts
interface Skill {
  id: string;            // 'design-taste-frontend'
  name: string;
  description: string;
  enabled: boolean;
  triggers: string[];
  updatedAt: number;
}
```

### 15.9 Memory

**Layout:** 3-column (source rail · main panel · detail). **Endpoint:**
`GET /memory/overview`, `GET /memory/{source}`, `POST /memory/search`.

```ts
interface MemoryOverview {
  sources: {
    id: 'lightrag' | 'obsidian' | 'gitsync' | 'semantic';
    state: 'ok' | 'degraded' | 'down';
    noteCount: number;
    lastSync: number;
  }[];
  recent: MemoryNote[];
}

interface MemoryNote {
  id: string;
  source: MemoryOverview['sources'][number]['id'];
  title: string;
  preview: string;
  tags: string[];
  updatedAt: number;
}
```

### 15.10 Mods

**Layout:** List of installed mods with enable/disable, install new
from URL. **Endpoint:** `GET /mods`, `POST /mods/install`.

```ts
interface Mod {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  hasViews: boolean;
  installPath: string;
  updatedAt: number;
}
```

### 15.11 Schedules

**Layout:** Card list with cron expression, last run, next run,
toggle. **Endpoint:** `GET /schedules`.

```ts
interface Schedule {
  id: string;
  name: string;
  cron: string;          // '0 */6 * * *'
  prompt: string;
  agent: string;
  enabled: boolean;
  lastRun: number | null;
  lastResult: 'ok' | 'fail' | null;
  nextRun: number;
}
```

### 15.12 Usage (MiniMax)

**Layout:** §10.10. **Endpoint:** `GET /api/usage?range=24h|7d|30d`.

```ts
interface UsageData {
  range: '24h' | '7d' | '30d';
  totalCost: number;
  totalTokens: number;
  costPerHour: number;
  byModel: { model: string; tokens: number; cost: number }[];
  byHour: { hour: string; tokens: number; cost: number }[];
  alerts: { ts: number; severity: 'warn' | 'error'; text: string }[];
  budgets: { id: string; label: string; cap: number; spent: number }[];
}
```

### 15.13 Eval

**Layout:** Run list (top) + last run detail (bottom). **Endpoint:**
`GET /eval/runs`, `GET /eval/runs/:id`.

```ts
interface EvalRun {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  passed: number;
  total: number;
  cases: { name: string; pass: boolean; latencyMs: number }[];
}
```

### 15.14 Doctor

**Layout:** Hero score + 8 subsystem cards (§9.18). **Endpoint:**
`GET /doctor`.

```ts
interface DoctorData {
  checkedAt: number;
  overall: number;        // 0..8
  subsystems: {
    name: string;
    state: 'ok' | 'degraded' | 'warning' | 'error';
    score: number;
    total: number;
    note: string;
  }[];
}
```

### 15.15 Harness

**Layout:** Audit rules list + 6/6 pass badge. **Endpoint:**
`GET /harness/audit`.

```ts
interface HarnessAudit {
  version: string;
  rules: { rule: string; pass: boolean; detail: string }[];
}
```

### 15.16 Settings

**Layout:** §10.12. **Endpoint:** `GET /settings`, `POST /settings`.

16 sections: theme, updates, layout, general, env-vars, network,
notifications, auth, agents, dashboard, background, system-llm,
headroom, activity-log, workspaces, about. Each section is its own
component in `src/web/views/settings/`.

---

## 16 · Versioning

- v7.0 — this document. Adds view index, data shapes, 5 new component
  patterns (DAG, approvals, cost chart, BG panel, workflow). Token
  system migrated to OKLch + color-mix.
- v6.0.0 — Cline runtime badge, Harness tab, Tasks kanban team badge,
  brand version pill, Mods-only navigation.
- v5.x — Eval framework, Doctor page.
- v4.x — Settings mode, char-counter, semi-collapsed topbar, slash
  commands.
- v3.x — Mods system, chat overhaul (3-column, rail, info panel),
  semantic spacing aliases, command palette.
- v2.x — Light theme, kanban board, hooks refactor.

Future changes update this file first, then ship.