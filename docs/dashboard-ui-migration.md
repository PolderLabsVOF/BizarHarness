# Dashboard UI Migration Guide

> For Bizar Harness `f040-dashboard-redesign` and future maintainers.
> Targets the new design system at `bizar-dash/src/web/ui/`.

---

## 1. Overview

### Why migrate incrementally

Migrating all views in one pass is high-risk: the dashboard has 20+ views, a large CSS surface, and active development on the Overview, Tasks, and Agents redesigns. Replacing everything at once would block the current session's work and create an unreviewable diff. Instead, each view is migrated independently, tested in isolation, and committed separately. This keeps VCR (Verification Completion Ratio) at 1.0 throughout and allows rollback of a single view without affecting the rest.

### What's in the new ui/ library

The new design system lives at `bizar-dash/src/web/ui/` and is organized into seven categories:

| Category | Path | Purpose |
|---|---|---|
| `styles/` | `ui/styles/` | `reset.css`, `tokens.css`, `globals.css` — token definitions and base resets |
| `theme/` | `ui/theme/ThemeProvider, useTheme` | Light/dark switching, token exposure |
| `utils/` | `ui/utils/cx` | Class-name combiner (drop-in for `lib/utils/cn`) |
| `primitives/` | `ui/primitives/` | Box, Stack, Inline, Grid, Separator, VisuallyHidden |
| `controls/` | `ui/controls/` | Button, IconButton, Toggle, TextInput, NumberInput, Select, Checkbox, RadioGroup, Slider, SearchInput, Kbd |
| `data/` | `ui/data/` | StatTile, Sparkline, BarChart, DataTable, KeyValueList, EmptyState, LoadingState, ErrorState |
| `feedback/` | `ui/feedback/` | Toast, Dialog, Tooltip, Badge, StatusDot, ProgressBar |
| `layout/` | `ui/layout/` | AppShell, Sidebar, Topbar, Panel, PanelHeader, Tabs, Breadcrumbs |
| `navigation/` | `ui/navigation/` | NavLink, NavGroup, CommandPalette |

### What stays

The old components at `bizar-dash/src/web/components/` (Button, Card, Modal, etc.) and the legacy CSS at `bizar-dash/src/web/styles/main.css` are **still functional**. They are not removed during migration. A view is considered migrated when it imports exclusively from `ui/`; the old components remain available for views that have not yet been migrated.

### Token-first migration principle

**Always switch to CSS variables BEFORE swapping components.** This separates concerns: first make the old component tree themable via tokens, then swap the components. Skipping this step means theme bugs get locked inside new components and become harder to find.

---

## 2. Migration Order

| # | View | Old components used (typical) | Reason for order |
|---|---|---|---|
| 1 | **Settings** | Card, Button, Toggle, Select | Simplest view; few components; validates the migration pattern end-to-end |
| 2 | **Providers** | Card, Button, Badge, Toggle | Low complexity, no external data dependencies |
| 3 | **Memory** | Card, Button, StatTile, DataTable | Demonstrates data components; validates token bindings for numeric displays |
| 4 | **Activity** | Card, Badge, StatusDot | Low interactivity; validates badge/status migration |
| 5 | **History** | Card, Button, DataTable | Demonstrates table + pagination; uses tabular-nums token |
| 6 | **Configs** | Card, Button, TextInput, Toggle | Form-heavy; validates input migration |
| 7 | **Doctor** | Card, Badge, ErrorState, Button | Uses semantic tokens (error, warning); validates dark mode for diagnostics |
| 8 | **Artifacts** | Card, Button, Badge, Dialog | File/artifact list; validates dialog + badge in context |
| 9 | **BackgroundAgents** | Card, Button, Toggle, StatTile | Agent list; validates numeric/stat components |
| 10 | **Schedules** | Card, Button, DataTable, Toggle | Temporal data; validates time formatting with tokens |
| 11 | **Chat** | Card, Button, Input, Dialog | High interactivity; do late because changes here risk sessions |
| 12 | **Eval** | Card, Button, BarChart, StatTile | Analytics-heavy; validates chart components and data bindings |
| 13 | **EvalReport** | Card, BarChart, DataTable, Badge | Most complex analytics view; depends on Eval (#12) being stable |
| 14 | **GoalPlanner** | Card, Button, Panel, Tabs | Layout-heavy (tabs + panels); validates full layout stack |
| 15 | **Harness** | Card, Button, Toggle, StatTile | Configuration + stats; leverages several categories |
| 16 | **MiniMaxUsage** | Card, BarChart, StatTile, DataTable | Chart-heavy; depends on BarChart being settled |
| 17 | **Mods** | Card, Button, Toggle, Badge | Extension list; straightforward |
| 18 | **ModView** | Card, Button, Panel, Tabs | Detail view for a single mod; layout-heavy |
| 19 | **Skills** | Card, Button, Toggle, Badge | Simple list view |
| 20 | **SpawnAgentModal** | Dialog, Button, Select, TextInput | Modal form; validates Dialog + form controls |
| 21 | **Workspace** | AppShell, Sidebar, Topbar, Panel, NavLink | Heavy layout shell; last because it affects every view |

> **Note:** Overview, Tasks, and Agents are being redesigned in the current session (`f040-dashboard-redesign`) and are excluded from this migration guide. Do not migrate them here.

---

## 3. Per-Component Migration Guide

### 3.1 Primitives

#### Box

- **Old:** `<div className={cn("flex flex-col p-4")}>` from `lib/utils/cn`
- **New:** `<Box padding="4" direction="col">` from `ui/primitives/Box`

#### Stack (vertical)

- **Old:** `<div className="flex flex-col gap-2">`
- **New:** `<Stack gap="2" direction="vertical">` from `ui/primitives/Stack`

#### Inline (horizontal)

- **Old:** `<div className="flex items-center gap-2">`
- **New:** `<Inline gap="2" align="center">` from `ui/primitives/Inline`

#### Grid

- **Old:** `<div className="grid grid-cols-3 gap-4">`
- **New:** `<Grid columns={3} gap="4">` from `ui/primitives/Grid`

#### Separator

- **Old:** `<div className="border-t border-slate-200" />` (light) / `border-slate-700` (dark)
- **New:** `<Separator />` from `ui/primitives/Separator` — handles light/dark automatically

#### VisuallyHidden

- **Old:** `<span className="sr-only">Label</span>`
- **New:** `<VisuallyHidden>Label</VisuallyHidden>` from `ui/primitives/VisuallyHidden`

---

### 3.2 Controls

#### Button

```tsx
// BEFORE — old Button at components/Button.tsx
import { Button } from 'components/Button';
import { cn } from 'lib/utils/cn';

// Note: old Button had a 'success' variant
<Button variant="success" onClick={handleSave}>Save</Button>
<Button variant="ghost" size="sm">Cancel</Button>
<Button variant="outline" disabled>Loading</Button>

// AFTER — new Button at ui/controls/Button.tsx
import { Button } from 'ui/controls/Button';
import { cx } from 'ui/utils/cx';

// Note: new Button has NO 'success' variant — use 'primary' + success icon
<Button variant="primary" onClick={handleSave}>Save</Button>
<Button variant="ghost" size="sm">Cancel</Button>
<Button variant="outline" disabled>Loading</Button>
```

**Gotcha:** The new `Button` does NOT have a `success` variant. For success actions, use `variant="primary"` and add a checkmark icon inside the button label. For destructive actions, use `variant="destructive"`.

#### IconButton

```tsx
// BEFORE
import { IconButton } from 'components/Button';
<IconButton icon={<TrashIcon />} onClick={handleDelete} aria-label="Delete" />

// AFTER
import { IconButton } from 'ui/controls/IconButton';
<IconButton icon={<TrashIcon />} onClick={handleDelete} label="Delete" />
```

#### Toggle

```tsx
// BEFORE
import { Toggle } from 'components/Toggle';
<Toggle checked={enabled} onChange={setEnabled} label="Enable feature" />

// AFTER
import { Toggle } from 'ui/controls/Toggle';
<Toggle checked={enabled} onChange={setEnabled} label="Enable feature" />
// API is largely the same; tokens are now wired internally
```

#### TextInput / NumberInput / SearchInput

```tsx
// BEFORE
import { TextInput } from 'components/Input';
<TextInput value={name} onChange={e => setName(e.target.value)} placeholder="Name" />

// AFTER
import { TextInput } from 'ui/controls/TextInput';
<TextInput value={name} onChange={setName} placeholder="Name" />
// Note: onChange now receives the parsed value directly, not an event
```

**Gotcha:** `onChange` signature changed from `(e: React.ChangeEvent) => void` to `(value: string) => void`. Update all handlers accordingly.

#### Select

```tsx
// BEFORE
import { Select } from 'components/Select';
<Select value={provider} onChange={setProvider} options={providerOptions} />

// AFTER
import { Select } from 'ui/controls/Select';
<Select value={provider} onChange={setProvider} options={providerOptions} />
// API is the same; styling is now token-driven
```

#### Checkbox

```tsx
// BEFORE
import { Checkbox } from 'components/Checkbox';
<Checkbox checked={checked} onChange={setChecked} label="Accept terms" />

// AFTER
import { Checkbox } from 'ui/controls/Checkbox';
<Checkbox checked={checked} onChange={setChecked} label="Accept terms" />
```

#### RadioGroup

```tsx
// BEFORE
import { RadioGroup } from 'components/RadioGroup';
<RadioGroup value={mode} onChange={setMode} options={modeOptions} />

// AFTER
import { RadioGroup } from 'ui/controls/RadioGroup';
<RadioGroup value={mode} onChange={setMode} options={modeOptions} />
```

#### Slider

```tsx
// BEFORE
import { Slider } from 'components/Slider';
<Slider value={threshold} onChange={setThreshold} min={0} max={100} step={1} />

// AFTER
import { Slider } from 'ui/controls/Slider';
<Slider value={threshold} onChange={setThreshold} min={0} max={100} step={1} />
```

#### Kbd

```tsx
// BEFORE — custom styled <kbd> element
<kbd className="px-1 py-0.5 rounded border border-slate-300 text-xs font-mono">Ctrl</kbd>

// AFTER
import { Kbd } from 'ui/controls/Kbd';
<Kbd>Ctrl</Kbd>
```

---

### 3.3 Data

#### StatTile

```tsx
// BEFORE — custom Card with numeric display
import { Card } from 'components/Card';
<Card className="p-4">
  <span className="text-sm text-slate-500">Total Requests</span>
  <span className="text-2xl font-bold font-mono">12,482</span>
</Card>

// AFTER — dedicated StatTile at ui/data/StatTile
import { StatTile } from 'ui/data/StatTile';
<StatTile label="Total Requests" value={12482} format="number" />
```

#### Sparkline

```tsx
// BEFORE — custom SVG or third-party
import { Sparkline } from 'components/Charts';

// AFTER
import { Sparkline } from 'ui/data/Sparkline';
<Sparkline data={[10, 40, 25, 60, 55, 85, 70]} width={120} height={32} />
```

#### BarChart

```tsx
// BEFORE
import { BarChart } from 'components/Charts';
<BarChart data={chartData} height={200} />

// AFTER
import { BarChart } from 'ui/data/BarChart';
<BarChart data={chartData} height={200} />
```

#### DataTable

```tsx
// BEFORE
import { DataTable } from 'components/DataTable';
<DataTable columns={columns} data={rows} onSort={handleSort} />

// AFTER
import { DataTable } from 'ui/data/DataTable';
<DataTable columns={columns} data={rows} onSort={handleSort} />
// New: numeric columns automatically use tabular-nums
```

**Gotcha:** The new `DataTable` applies `font-variant-numeric: tabular-nums` to numeric cells automatically via `globals.css`. Do not manually add `font-mono` to numeric columns — it is already handled.

#### KeyValueList

```tsx
// BEFORE — custom dl/dt/dd layout
<dl className="grid grid-cols-2 gap-2">
  {entries.map(([k, v]) => (
    <>
      <dt className="text-sm text-slate-500">{k}</dt>
      <dd className="text-sm font-mono">{v}</dd>
    </>
  ))}
</dl>

// AFTER
import { KeyValueList } from 'ui/data/KeyValueList';
<KeyValueList entries={entries} />
```

#### EmptyState / LoadingState / ErrorState

```tsx
// BEFORE
<div className="flex flex-col items-center justify-center p-8 text-slate-500">
  <Icon className="w-8 h-8 mb-2" />
  <span>No items found</span>
</div>

// AFTER
import { EmptyState } from 'ui/data/EmptyState';
import { LoadingState } from 'ui/data/LoadingState';
import { ErrorState } from 'ui/data/ErrorState';

<EmptyState icon={<Icon />} message="No items found" />
<LoadingState />
<ErrorState message={error.message} onRetry={retry} />
```

---

### 3.4 Feedback

#### Toast

```tsx
// BEFORE
import { toast } from 'react-hot-toast';
toast.success('Saved!');
toast.error('Failed to save');

// AFTER
import { useToast } from 'ui/feedback/Toast';
// Note: Toast is consumed via the ToastProvider (already in AppShell)
// Use via context: const { addToast } = useToast();
// addToast({ variant: 'success', message: 'Saved!' });
```

#### Dialog

```tsx
// BEFORE
import { Modal } from 'components/Modal';
<Modal isOpen={open} onClose={handleClose} title="Confirm">
  <p>Are you sure?</p>
  <Button onClick={handleConfirm}>Confirm</Button>
</Modal>

// AFTER
import { Dialog } from 'ui/feedback/Dialog';
import { DialogTrigger } from 'ui/feedback/DialogTrigger';
<Dialog open={open} onOpenChange={setOpen} title="Confirm">
  <p>Are you sure?</p>
  <DialogFooter>
    <Button variant="ghost" onClick={handleClose}>Cancel</Button>
    <Button variant="primary" onClick={handleConfirm}>Confirm</Button>
  </DialogFooter>
</Dialog>
```

**Gotcha:** The new `Dialog` uses controlled `open` prop. If the old `Modal` was uncontrolled, wrap it in a local `useState` to control it.

#### Tooltip

```tsx
// BEFORE
import { Tooltip } from 'components/Tooltip';
<Tooltip content="Settings">
  <button>...</button>
</Tooltip>

// AFTER
import { Tooltip } from 'ui/feedback/Tooltip';
<Tooltip content="Settings">
  <button>...</button>
</Tooltip>
```

#### Badge / StatusDot

```tsx
// BEFORE
import { Badge } from 'components/Badge';
<Badge variant="success">Active</Badge>
<Badge variant="warning">Pending</Badge>

// AFTER
import { Badge } from 'ui/feedback/Badge';
import { StatusDot } from 'ui/feedback/StatusDot';
<Badge variant="success">Active</Badge>
<StatusDot status="active" /> {/* inline indicator */}
```

#### ProgressBar

```tsx
// BEFORE — custom div with width percentage
<div className="h-2 bg-slate-200 rounded-full overflow-hidden">
  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
</div>

// AFTER
import { ProgressBar } from 'ui/feedback/ProgressBar';
<ProgressBar value={pct} size="md" />
```

---

### 3.5 Layout

#### Panel (replacement for Card)

```tsx
// BEFORE
import { Card } from 'components/Card';
<Card className="p-4">
  <h3>Title</h3>
  <p>Content</p>
</Card>

// AFTER
import { Panel } from 'ui/layout/Panel';
import { PanelHeader } from 'ui/layout/PanelHeader';
<Panel>
  <PanelHeader title="Title" />
  <p>Content</p>
</Panel>
```

**Gotcha:** `Card` and `Panel` are different components. The new `Panel` has built-in `PanelHeader` slot and uses `--surface-*` tokens instead of hardcoded slate colors. Do not import `Panel` expecting it to be a drop-in `Card` replacement — Panel has a different content model.

#### Tabs

```tsx
// BEFORE
import { Tabs } from 'components/Tabs';
<Tabs active={tab} onChange={setTab} tabs={[{ id: 'a', label: 'Tab A' }]} />

// AFTER
import { Tabs } from 'ui/layout/Tabs';
import { Tab } from 'ui/layout/Tab';
<Tabs active={tab} onChange={setTab}>
  <Tab id="a" label="Tab A">Content</Tab>
  <Tab id="b" label="Tab B">Content</Tab>
</Tabs>
```

**Gotcha:** The new `Tabs` is a controlled compound component. The old `Tabs` may have accepted an array; the new one uses `Tab` children.

#### Breadcrumbs

```tsx
// BEFORE
<nav className="flex items-center gap-1 text-sm text-slate-500">
  <a href="/" className="hover:text-slate-700">Home</a>
  <ChevronRight className="w-3 h-3" />
  <span className="text-slate-900">Current</span>
</nav>

// AFTER
import { Breadcrumbs } from 'ui/layout/Breadcrumbs';
import { BreadcrumbItem } from 'ui/layout/BreadcrumbItem';
<Breadcrumbs>
  <BreadcrumbItem href="/">Home</BreadcrumbItem>
  <BreadcrumbItem>Current</BreadcrumbItem>
</Breadcrumbs>
```

#### AppShell / Sidebar / Topbar

These are structural components that wrap the full view. When migrating `Workspace`, these will replace the custom layout divs.

```tsx
// BEFORE — custom layout divs in Workspace.tsx
<div className="flex h-screen overflow-hidden bg-white">
  <aside className="w-60 border-r border-slate-200">Sidebar</aside>
  <div className="flex flex-col flex-1">
    <header className="h-14 border-b border-slate-200">Topbar</header>
    <main className="flex-1 overflow-auto">Content</main>
  </div>
</div>

// AFTER
import { AppShell } from 'ui/layout/AppShell';
import { Sidebar } from 'ui/layout/Sidebar';
import { Topbar } from 'ui/layout/Topbar';
<AppShell
  sidebar={<Sidebar items={navItems} />}
  topbar={<Topbar title="Workspace" />}
>
  Content
</AppShell>
```

---

### 3.6 Navigation

#### NavLink

```tsx
// BEFORE
import { NavLink } from 'components/NavLink';
<NavLink to="/settings" icon={<SettingsIcon />} active={currentPath === '/settings'}>
  Settings
</NavLink>

// AFTER
import { NavLink } from 'ui/navigation/NavLink';
<NavLink href="/settings" icon={<SettingsIcon />} isActive={currentPath === '/settings'}>
  Settings
</NavLink>
```

#### NavGroup

```tsx
// BEFORE — custom collapsible nav section
<div className="px-3 py-2">
  <button className="flex items-center justify-between w-full text-sm font-medium">
    Agents <ChevronDown className="w-4 h-4" />
  </button>
  <div className="mt-1 ml-2 space-y-1">{children}</div>
</div>

// AFTER
import { NavGroup } from 'ui/navigation/NavGroup';
<NavGroup label="Agents" icon={<ChevronDownIcon />}>
  {children}
</NavGroup>
```

#### CommandPalette

```tsx
// BEFORE — custom command search modal
// (many views built custom search modals)

// AFTER
import { CommandPalette } from 'ui/navigation/CommandPalette';
// Use the provider at App level; individual views register commands via context
```

---

## 4. Token Reference

Tokens are CSS custom properties defined in `ui/styles/tokens.css` and available globally. They are the **only** permitted way to express color, spacing, and type values in migrated views.

### Colors

```css
/* Surface */
--surface-base:      /* base background */
--surface-raised:    /* cards, panels */
--surface-overlay:   /* dialogs, dropdowns */
--surface-muted:     /* disabled, secondary */

/* Text */
--text-primary:      /* primary text */
--text-secondary:    /* secondary / muted text */
--text-disabled:     /* disabled state */
--text-inverse:      /* text on dark backgrounds */

/* Border */
--border-default:    /* default border */
--border-subtle:     /* hairline, dividers */
--border-strong:     /* emphasized borders */

/* Accent */
--accent-primary:     /* primary interactive */
--accent-primary-hover:
--accent-secondary:
--accent-muted:

/* Semantic */
--semantic-success:  /* success / active */
--semantic-warning:  /* warning / pending */
--semantic-error:    /* error / danger */
--semantic-info:     /* info / neutral */

/* Chart (pre-bound to accessible palette) */
--chart-1: --accent-primary
--chart-2: --accent-secondary
--chart-3: --semantic-success
--chart-4: --semantic-warning
--chart-5: --semantic-info
```

### Spacing Scale

```css
--space-0:  0
--space-px: 1px
--space-0-5: 0.125rem   /* 2px */
--space-1:  0.25rem     /* 4px */
--space-1-5: 0.375rem   /* 6px */
--space-2:  0.5rem      /* 8px */
--space-2-5: 0.625rem   /* 10px */
--space-3:  0.75rem     /* 12px */
--space-3-5: 0.875rem   /* 14px */
--space-4:  1rem        /* 16px */
--space-5:  1.25rem     /* 20px */
--space-6:  1.5rem      /* 24px */
--space-8:  2rem        /* 32px */
--space-10: 2.5rem      /* 40px */
--space-12: 3rem        /* 48px */
--space-16: 4rem        /* 64px */
```

### Type Scale

```css
--text-xs:   0.75rem     /* 12px */
--text-sm:   0.875rem    /* 14px */
--text-base: 1rem        /* 16px */
--text-lg:   1.125rem    /* 18px */
--text-xl:   1.25rem     /* 20px */
--text-2xl:  1.5rem      /* 24px */
--text-3xl:  1.875rem    /* 30px */
--text-4xl:  2.25rem     /* 36px */
```

### Radii

```css
--radius-sm:  0.25rem    /* 4px — small chips, badges */
--radius-md:  0.375rem   /* 6px — buttons, inputs */
--radius-lg:  0.5rem     /* 8px — cards, panels */
--radius-xl:  0.75rem    /* 12px — dialogs */
--radius-full: 9999px    /* pills, avatars */
```

### Shadows

The design system uses **no shadows beyond hairline borders**. Do not add `box-shadow` to panels or cards. If you need elevation, use the `--surface-overlay` token with a subtle border instead.

```css
/* No shadow tokens exist. The system is border-based, not shadow-based. */
```

### Animation Tokens

```css
--duration-fast:   100ms
--duration-normal: 200ms
--duration-slow:   300ms
--ease-default:    cubic-bezier(0.4, 0, 0.2, 1)
--ease-in:         cubic-bezier(0.4, 0, 1, 1)
--ease-out:        cubic-bezier(0, 0, 0.2, 1)
--ease-bounce:     cubic-bezier(0.34, 1.56, 0.64, 1)
```

### Layout Dimensions

```css
--sidebar-width:       16rem    /* 256px */
--sidebar-width-narrow: 12rem   /* 192px */
--topbar-height:       3.5rem  /* 56px */
--panel-gap:            1rem    /* 16px */
--content-max-width:    1280px
```

---

## 5. Common Gotchas

1. **Don't import from `lib/utils` for className — use `ui/utils/cx`**
   The legacy `lib/utils/cn` merges Tailwind classes at runtime. The new `ui/utils/cx` is a thin wrapper that also handles token-aware conditional classes. Both exist during migration; prefer `cx` in new code.

2. **Old `Card` lives at `components/Card.tsx` — new `Panel` lives at `ui/layout/Panel.tsx`. They're different.**
   `Card` uses hardcoded slate colors and padding conventions from the old design. `Panel` uses `--surface-*` tokens and has a `PanelHeader` slot. Do not alias one as the other.

3. **Tokens are CSS custom properties — use `var(--token)` in CSS or `tokens.colorTokens.accent` in TS**
   The `useTheme()` hook from `ui/theme/` exposes `tokens` as a typed object. Always use tokens rather than raw color strings. For one-off cases in CSS, `var(--accent-primary)` is preferred over `#hex`.

4. **Use `font-variant-numeric: tabular-nums` (already on body in globals.css) for numeric columns**
   The `globals.css` already applies `font-variant-numeric: tabular-nums` to `body`. Numeric displays (DataTable cells, StatTile values, chart labels) should not add `font-mono` — they should rely on the global token. If a numeric column looks wrong, check the computed style before adding overrides.

5. **Light/dark theming: switch via `useTheme().setTheme('dark')` — no manual className flipping**
   The `useTheme()` hook returns `{ theme, setTheme, tokens }`. Do not add `dark:` className prefixes in component code. If a component behaves differently in dark mode, it should query `--text-primary` etc. via the token system.

6. **The new design system has NO gradients, NO shadows beyond hairline. If you're tempted to add one, push back.**
   The design rules at `.harness/arch-rules.json` enforce border-based elevation, not shadow-based. Adding a gradient or shadow is a design decision that belongs in the token definition, not in a view.

7. **`onChange` signature changes on form controls are common. Check each control's type signature.**
   TextInput, NumberInput, SearchInput all changed `onChange` from `(e: React.ChangeEvent) => void` to `(value: T) => void`. SearchInput may additionally debounce.

8. **Dialog is now a controlled compound component. Uncontrolled usage requires a local `useState`.**
   The old `Modal` may have auto-handled open/close state. The new `Dialog` is fully controlled via the `open`/`onOpenChange` props.

---

## 6. Testing Migration

Tests for migrated UI components live at:

```
bizar-dash/tests/components/ui/*.test.tsx
```

### Setup

Use the same RTL (react-testing-library) setup as the legacy tests in `bizar-dash/tests/`. Each test file should import from the `ui/` path aliases defined in the Vite config:

```tsx
// e.g. bizar-dash/tests/components/ui/Button.test.tsx
import { render, screen, userEvent } from 'test/setup';
import { Button } from 'ui/controls/Button';
import { ThemeProvider } from 'ui/theme/ThemeProvider';

test('Button renders with correct token-driven styles', async () => {
  render(
    <ThemeProvider>
      <Button variant="primary">Click me</Button>
    </ThemeProvider>
  );
  expect(screen.getByRole('button', { name: 'Click me' })).toBeVisible();
});
```

### What to test per migrated view

For each migrated view, existing tests should continue to pass (no behavior change). Add new tests for:

- **Token correctness:** verify a component reads from CSS tokens, not hardcoded colors
- **Theme switching:** render in `'light'` and `'dark'` mode via `useTheme().setTheme`, assert no visual breakage
- **Accessibility:** verify `aria-` attributes are correctly set on controls that use them (e.g. `Toggle`, `Checkbox`, `RadioGroup`)
- **Focus management:** for `Dialog`, verify focus trapping and escape-key closing

### Running tests

```sh
# Run ui component tests
bun test bizar-dash/tests/components/ui/

# Run all dashboard tests
bun test bizar-dash/tests/

# E2E (full plugin load)
make e2e
```

---

## 7. Checklist Per View

Use this checklist for each view migration. Copy and fill in the view name.

---

### Migrating `<ViewName>`

```markdown
## Migrating <ViewName>

- [ ] Read the current view at `bizar-dash/src/web/views/<ViewName>/index.tsx`
- [ ] List all old components used (Button, Card, Badge, etc.)
- [ ] List all hardcoded color values (hex, rgb, named colors)
- [ ] Replace `lib/utils/cn` imports with `ui/utils/cx`
- [ ] Replace old `Card` with `ui/layout/Panel` + `ui/layout/PanelHeader`
- [ ] Replace old `Button` with `ui/controls/Button` (note: 'success' → 'primary' + icon)
- [ ] Replace other old controls with new equivalents (Toggle, Select, TextInput, etc.)
- [ ] Replace data components (StatTile, DataTable, BarChart, etc.)
- [ ] Replace feedback components (Badge, StatusDot, Dialog, etc.)
- [ ] Replace layout components (Tabs, Breadcrumbs, etc.)
- [ ] Replace navigation components (NavLink, NavGroup, etc.)
- [ ] Switch all hardcoded colors to `var(--token)` or `tokens.colorTokens.*`
- [ ] Add `ThemeProvider` wrapper if not already present in view
- [ ] Test in light mode
- [ ] Test in dark mode
- [ ] Run `bun run typecheck` — must pass
- [ ] Run `bun test bizar-dash/tests/` — all tests must pass
- [ ] Run `make e2e` — plugin loads, dashboard renders
- [ ] Update CHANGELOG.md (add `dashboard-ui-migration: migrated <ViewName>` entry)
- [ ] Commit with message: "migrate(<ViewName>): use new ui/ design system"
```

---

## 8. Open Questions

The following questions should be resolved before mass migration begins:

1. **Should old `components/Button.tsx` be removed after all views migrate, or kept as a compat shim?**
   Keeping it as a shim adds maintenance burden. Removing it requires a full audit that no dangling imports exist. Recommend: remove after all 20 views are migrated and a final grep for `from 'components/Button'` returns nothing.

2. **Should the old `styles/main.css` be split into per-view CSS, or kept as one file?**
   The legacy `main.css` contains global resets and utility classes. The new `ui/styles/` is modular. A decision is needed on whether legacy utility classes (e.g. `flex`, `grid`, `text-sm`) are still needed in migrated views or if the new `Stack`/`Inline`/`Grid` primitives fully replace them.

3. **Should we add Storybook for `ui/` components?**
   The current test setup uses RTL. Storybook would enable visual regression testing and design review. The cost is maintaining `.stories.tsx` files alongside the components. Recommend adding after the first 5 views are migrated (to have enough examples).

4. **Should mobile views share the same `ui/` library or have their own?**
   The mobile dashboard at `bizar-dash/src/web/mobile/` currently uses the same component paths. The new `ui/` library does not yet have mobile-specific responsive tokens. If mobile is in scope, a responsive token audit is needed before mobile views can migrate.

5. **How should third-party chart libraries (if any) be integrated with the token system?**
   If `BarChart` or `Sparkline` wrap a third-party library, chart colors must be bound to chart tokens (`--chart-1` through `--chart-5`) rather than passed as hex strings. Confirm this is enforced in the component implementation.

6. **Should the migration include a visual regression baseline?**
   With 20 views migrating incrementally, a visual regression tool (e.g. Playwright screenshots) would catch unintended style changes. Without it, only manual review catches token drift. Recommend setting up a basic screenshot CI after view 3 is migrated.
