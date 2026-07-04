---
name: glyph
description: Create and consume Bizar glyphs — visual artifacts at `artifacts/<slug>/`. Use for plans, recaps, design proposals, postmortems, handoffs. Quick reference for the block vocabulary and the 5 things that actually break a glyph.
version: 3
---

# Glyphs

A **glyph** is an MDX file the dashboard renders with a comment-pin overlay and right-click menu. Three files per glyph:

```
artifacts/<slug>/
├── meta.json          ← title, status, author, created
├── artifact.mdx       ← source of truth
└── comments.json      ← free-placed pins (mutable)
```

Two locations are scanned: `<projectRoot>/.bizar/artifacts/` (preferred) and `~/.config/opencode/artifacts/` (global).

## Frontmatter

```yaml
---
title: "Short, action-oriented title"
brief: "One sentence."
status: draft | review | shipped | archived
kind: plan | postmortem | recap | design
---
```

## The blocks at a glance

| Block | What it shows | Required `data` |
| --- | --- | --- |
| `<RichText>` | Prose, lists, code blocks | none — body is markdown |
| `<Callout tone="info\|warn\|success\|danger">` | Boxed callout | none (tone defaults to info) |
| `<Stat label value trend hint />` | Big number with trend | `label`, `value` |
| `<Checklist items={[...]} />` | Checkbox list | `items: [{id,label,checked}]` |
| `<Table columns rows />` | Tabular data | `columns: []`, `rows: [[]]` |
| `<CodeTabs tabs />` | Tabbed code blocks | `tabs: [{id,label,language,code}]` |
| `<Decision title question options />` | Multi-option choice | `options: [{id,label,detail,recommended?}]` |
| `<OpenQuestions questions />` | Unanswered questions | `questions: [{id,label,kind,options?}]` |
| `<FileTree title entries />` | File-by-file change list | `entries: [{path,change,note?}]` |
| `<Diff before after filename language mode />` | Before/after diff | `before`, `after` |
| `<Workflow steps connections />` | Node graph | `steps: [{id,label,type}]` |
| `<Mockup title x y w h html />` | Inline UI mockup | `html` |
| `<Diagram title dataHtml dataCss />` | Inline SVG | `dataHtml` |

Every block needs a unique `id`. `RichText` and `Callout` use open/close tags with markdown children; everything else is self-closing.

## Skeleton

```mdx
<RichText id="overview">
## What this covers

A one-paragraph summary.
</RichText>

<Stat id="headline" label="X" value="7" trend="flat" />

<Callout id="warning" tone="warn">
One important thing.
</Callout>

<FileTree
  id="files"
  title="Files changed"
  entries={[
    { path: "src/foo.ts", change: "modified", note: "why" },
    { path: "src/bar.ts", change: "added" },
  ]}
/>

<Workflow
  id="flow"
  steps={[
    { id: "s1", label: "Step 1", type: "task" },
    { id: "s2", label: "Step 2", type: "task" },
  ]}
  connections={[
    { from: "s1", to: "s2" },
  ]}
/>
```

## The 5 things that break a glyph

Read this BEFORE writing. Each one is a real bug we've shipped.

### 1. Backticks inside attribute strings

The parser scans for `` ` `` to delimit template literals. A literal backtick inside a string — even inside double-quotes — closes the surrounding context and breaks parsing.

```
WRONG: Run `bizar install` to bootstrap.
RIGHT: Run 'bizar install' to bootstrap.
RIGHT: Run the installer to bootstrap.
```

### 2. The parser doesn't track strings when counting braces

`{` and `}` inside string values still increment the brace depth walker. With brace-laden strings the walker terminates at the wrong closing brace and the value gets truncated.

**Rule:** keep string values brace-free. If you must use `{...}` in a note, escape or rephrase.

### 3. `FileTree` `change` field must be exact

`change` must be `added` | `modified` | `removed` | `renamed`. Anything else (empty string, `null`, typo) makes the renderer crash on `t.bg`.

```
WRONG: change: null, change: "", change: "Modified"
RIGHT: change: "modified"
```

When in doubt, use `modified` with a `note` that explains why.

### 4. Two blocks with the same id

Comment pins and error reporting are keyed by block id. Duplicates collide. Each `id` must be unique within a glyph.

### 5. MDX heading with `<N`

```
WRONG: ## Mobile <768px         ← <7 looks like a malformed tag
RIGHT: ## Mobile (under 768px)
RIGHT: ## Mobile: under 768px
```

## Validate before shipping

```bash
node -e "import('./bizar-dash/src/server/glyphs/mdx-compiler.mjs').then(m => { \
  const fs = require('node:fs'); \
  const out = m.compileGlyphMdxSync(fs.readFileSync('artifacts/<slug>/artifact.mdx','utf8')); \
  console.log('blocks:', out.blocks.length, 'errors:', out.errors.length); \
  out.errors.forEach(e => console.error('  line', e.line, ':', e.message)); \
})"
```

If errors > 0, fix the MDX before opening the glyph in the browser. When a block DOES fail in the browser, v4.4.8+ shows a red banner with block id + error message — no more blank screen.

## See also

- `bizar-dash/src/server/glyphs/mdx-compiler.mjs` — parser
- `bizar-dash/src/web/views/glyphs/GlyphRenderer.tsx` — React renderer (has the error banner)
- `bizar-dash/src/web/views/glyphs/components.tsx` — block component implementations