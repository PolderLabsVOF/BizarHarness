---
name: glyph
description: Create and consume Bizar glyphs — visual plan/recap artifacts in `artifacts/<slug>/`. Glyphs are MDX files with frontmatter and a block vocabulary. Use for design proposals, decision recaps, and postmortems.
version: 2
---

# Glyphs — Visual Plan Artifacts

A **glyph** is a visual artifact used for plans, recaps, design proposals, and postmortems. It's an MDX file at `artifacts/<slug>/artifact.mdx` (or `~/.config/opencode/artifacts/<slug>/` for global glyphs) that the dashboard renders with comment-pin overlay and right-click context menu.

## When to create a glyph

- **Design proposal** — you're proposing a new component, system, or workflow
- **Decision recap** — multiple options were considered; one was chosen; the reasoning matters
- **Postmortem** — something broke; here's the timeline and root cause
- **Implementation plan** — breaking down a non-trivial feature into phases
- **Handoff** — work moving from one agent to another

If it's a one-line fix, don't make a glyph. If it's a 5-minute edit, don't make a glyph. Glyphs are for work that needs visible structure.

## File structure

```
artifacts/<slug>/
├── meta.json          # title, slug, status, author, created, lastEdited
├── artifact.mdx       # ← source of truth (git-tracked, diff-friendly)
└── comments.json      # ← free-placed pins (mutable, gitignored usually)
```

Two locations are scanned:
1. **Per-project:** `<projectRoot>/.bizar/artifacts/<slug>/`
2. **Global:** `~/.config/opencode/artifacts/<slug>/`

The dashboard uses whichever exists. The project's `artifacts/<slug>/` is preferred when running inside a worktree.

## Frontmatter

```yaml
---
title: "Short, action-oriented title"
brief: "One sentence: what this glyph is about."
status: draft | review | shipped | archived
kind: plan | postmortem | recap | design
---
```

The frontmatter is parsed once and exposed to the React renderer. Unknown keys are passed through. Status controls the badge color + whether the glyph is read-only.

## Block vocabulary

```mdx
<RichText id="...">markdown content (headings, lists, code blocks, etc.)</RichText>

<Callout id="..." tone="info|warn|success|danger">markdown content</Callout>

<Stat id="..." label="..." value="..." trend="up|down|flat" hint="..." />

<Checklist
  id="..."
  items={[
    { id: "i1", label: "...", checked: true },
    { id: "i2", label: "...", checked: false }
  ]}
/>

<Table
  id="..."
  columns={["A", "B"]}
  rows={[["x", "y"], ["p", "q"]]}
/>

<CodeTabs
  id="..."
  tabs={[
    { id: "t1", label: "file.ts", language: "typescript", code: "...", caption: "..." }
  ]}
/>

<Decision
  id="..."
  title="..."
  question="..."
  options={[
    { id: "a", label: "...", detail: "...", recommended: true }
  ]}
/>

<OpenQuestions
  id="..."
  questions={[
    { id: "q1", label: "...", kind: "choice|text|multi", options: ["A", "B"] }
  ]}
/>

<FileTree
  id="..."
  title="..."
  entries={[
    { path: "src/foo.ts", change: "added|modified|removed|renamed", note: "..." }
  ]}
/>

<Workflow
  id="..."
  steps={[
    { id: "s1", label: "...", type: "task|decision|note" }
  ]}
  connections={[
    { from: "s1", to: "s2", label: "yes" }
  ]}
/>

<Mockup
  id="..."
  title="..."
  x={40} y={120} w={280} h={180}
  html="<div class='mockup-card'>...</div>"
/>

<Diagram
  id="..."
  title="..."
  dataHtml="<svg>...</svg>"
  dataCss=".diagram-node { fill: var(--bg-1); }"
/>
```

## What data shape each block expects

The dashboard validates every block's `data` shape BEFORE rendering. If a field is missing or the wrong type, the block renders an inline error card instead of crashing the whole canvas (v4.4.8+). The same thing happens if a block throws during render — a per-block `ErrorBoundary` catches it.

| Block | Required `data` fields |
| --- | --- |
| `RichText` | none (children are markdown) |
| `Callout` | none; optional `tone: 'info' \| 'warn' \| 'success' \| 'danger'` (default: info) |
| `Stat` | `label: string`, `value: string \| number`; optional `trend`, `hint` |
| `Checklist` | `items: Array<{ id, label, checked }>` |
| `Table` | `columns: string[]`, `rows: string[][]` (each row is a cell array) |
| `CodeTabs` | `tabs: Array<{ id, label, language, code, caption? }>` |
| `Decision` | `options: Array<{ id, label, detail, recommended? }>`; optional `title`, `question` |
| `OpenQuestions` | `questions: Array<{ id, label, kind, options? }>` |
| `FileTree` | `entries: Array<{ path, change, note? }>` where `change ∈ {added, modified, removed, renamed}` |
| `Diff` | `before: string`, `after: string`; optional `filename`, `language`, `mode` |
| `Workflow` | `steps: Array<{ id, label, type }>`; optional `connections` |
| `Mockup` | `html: string`; optional `title`, `x`, `y`, `w`, `h` |
| `Diagram` | `dataHtml: string`; optional `title`, `dataCss` |

## Common pitfalls

These are the bugs we've actually hit. Read this section before writing a glyph.

### 1. Backticks inside attribute strings break the parser

The MDX parser scans for `` ` `` to delimit template literals in JSX. A literal backtick inside an attribute value — even inside a double-quoted string — will close the surrounding context and produce a parse error.

```mdx
<!-- WRONG: \` inside a string value kills the parser -->
<RichText id="x">Run \`bizar install\` to bootstrap.</RichText>

<!-- RIGHT: use straight quotes or rephrase -->
<RichText id="x">Run 'bizar install' to bootstrap.</RichText>
<RichText id="x">Run the installer to bootstrap.</RichText>
```

The parser's JSX-attribute walker does NOT track string literals when counting braces — so any `{` or `}` inside a string value also throws the parser off. Quote all strings that contain braces.

### 2. The parser counts braces naively (does NOT track strings)

The `parseJsxValue` function uses a brace-depth counter that doesn't know about string literals. If you have something like:

```mdx
<FileTree entries={[{ path: "x", change: "added", note: "this {weird} note" }]} />
```

…the inner `{` and `}` inside the string still increment the brace depth. With deeply-nested or brace-laden strings the walker terminates at the wrong closing brace, leaving a truncated value for `parseJsxValue`.

**Rule of thumb:** keep string values brace-free. If you must use `{...}` in a note, escape or rephrase.

### 3. Trailing commas in arrays used to be a phantom-element bug

Before v4.4.8, an array ending with a trailing comma — e.g. `[a, b,]` — caused the parser to call `parseValue` on the closing `]`, which fell through to the bareword-identifier fallback and returned `{__ident: ''}` as a phantom element. The FileTree then had one extra broken entry that crashed the React renderer (`t.bg` on undefined).

v4.4.8 fixed this in the parser. But: don't rely on trailing commas, even where supported — keep the array clean.

### 4. `FileTree` `change` field must be exact

`change` must be exactly one of: `added`, `modified`, `removed`, `renamed`. Anything else (including the empty string or `null`) makes `FILE_CHANGE[e.change]` return `undefined` and the renderer crashes with "can't access property 'bg' of undefined".

```mdx
<!-- WRONG -->
{ path: "src/foo.ts", change: null, note: "..." }
{ path: "src/foo.ts", change: "", note: "..." }

<!-- RIGHT -->
{ path: "src/foo.ts", change: "modified", note: "..." }
{ path: "src/foo.ts", change: "added", note: "..." }
```

If a file's status is genuinely unclear, use `modified` with a `note` that explains why.

### 5. MDX heading with `<N`

A heading like `## Mobile (under 768px)` is fine. But `## Mobile <768px` breaks the MDX validator because `<7` looks like a malformed JSX tag. Always escape or rephrase:

```mdx
## Mobile (under 768px)        <!-- fine -->
## Mobile: under 768px          <!-- fine -->
## Mobile &lt; 768px             <!-- fine but ugly -->
```

### 6. Block IDs must be unique within a glyph

If you copy a `<RichText>` block, change its `id`. The compiler may warn but won't fail. Two blocks with the same id will collide on the comment-pin overlay.

### 7. Children vs self-closing

Blocks with content (`RichText`, `Callout`) use open/close tags with children. Blocks with only data (`Stat`, `Table`, `FileTree`, `Decision`, etc.) are self-closing — no children, no closing tag.

```mdx
<!-- self-closing -->
<Stat id="x" label="..." value="..." />

<!-- with children -->
<RichText id="x">markdown content here</RichText>
<Callout id="x" tone="warn">important message</Callout>
```

### 8. Em-dashes and special characters

The parser's JSON-like value reader handles `\\`, `\"`, `\'`, `\n`, `\t`, `\r` inside string literals. Em-dashes (`—`), curly quotes (`""`), and other Unicode characters are fine. Just avoid `\``.

## meta.json example

```json
{
  "title": "Chat UI — Complete Rewrite (Gemini-Inspired)",
  "slug": "chat-ui-rewrite",
  "status": "draft",
  "author": "drb0rk",
  "created": "2026-06-26T20:30:00.000Z",
  "lastEdited": "2026-06-26T20:30:00.000Z"
}
```

`lastEdited` is updated whenever the dashboard re-saves the glyph via the toolbar.

## Validation workflow

Before committing a glyph:

1. Run the compiler against your MDX:
   ```bash
   node -e "import('./bizar-dash/src/server/glyphs/mdx-compiler.mjs').then(m => { const fs = require('node:fs'); const src = fs.readFileSync('artifacts/<slug>/artifact.mdx', 'utf8'); const out = m.compileGlyphMdxSync(src); console.log('blocks:', out.blocks.length, 'errors:', out.errors); out.errors.forEach(e => console.error('  line', e.line, ':', e.message)); })"
   ```
   This catches parser bugs (missing tags, malformed attrs, etc.) before they hit the dashboard.

2. Visually inspect the rendered output by hitting `GET /api/artifacts/<slug>/render`. The response is the compiled JSON the React renderer consumes. Look for blocks with missing data fields — those will show up as `data: {}` or `data: []`.

3. Open the glyph in the dashboard. v4.4.8+ shows a red error banner at the top of the canvas if any block failed to render. The banner lists every block error AND every compiler warning.

## How to view in the dashboard

Glyphs are rendered at `/artifacts/<slug>`. The dashboard shows them with:
- **Section grouping** — by block id prefix (e.g. all blocks with ids starting `overview_` go into the "Overview" section)
- **Comment pin overlay** — right-click anywhere to add a comment
- **Floating toolbar** — Send to agent, share, fullscreen
- **Error banner** — v4.4.8+: red banner at the top with block render errors and compiler warnings. The page is no longer blank when something fails — you'll see exactly which block crashed and why.
- **Status badge** — `draft | review | shipped | archived`. `shipped` locks editing.

## See also

- `bizar-dash/src/web/views/glyphs/components.tsx` — block component implementations
- `bizar-dash/src/server/glyphs/mdx-compiler.mjs` — MDX parser (custom, no @mdx-js dependency at runtime)
- `bizar-dash/src/web/views/glyphs/GlyphRenderer.tsx` — React renderer (v4.4.8+ has the error banner + ErrorBoundary)
- `artifacts/sample-plan-login/` — a complete worked example