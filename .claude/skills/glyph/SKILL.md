---
name: glyph
description: Create visual glyphs at `artifacts/<slug>/` for plans, recaps, design proposals, postmortems, handoffs. Glyphs should be compact and visual — one screen, dense info, no walls of text. This skill enforces that. Use when the user asks for a plan preview, design review surface, or decisions document that needs visual blocks (Stat, Callout, Table, Decision, etc.).
version: 4
---

# Glyphs

A **glyph** is an MDX file the dashboard renders with a comment-pin overlay and right-click menu. Three files per glyph:

```
artifacts/<slug>/
├── meta.json          ← title, status, author, created
├── artifact.mdx       ← source of truth
└── comments.json      ← free-placed pins (mutable)
```

Two locations: `<projectRoot>/.bizar/artifacts/` (preferred) and `~/.bizar_home/artifacts/` (global).

## Frontmatter

```yaml
---
title: "Short, action-oriented title"
brief: "One sentence."
status: draft | review | shipped | archived
kind: plan | postmortem | recap | design
---
```

## The 6 rules — read this first, every time

These are non-negotiable. The existing 357-line v3-to-v4-consolidation glyph is a cautionary tale — don't write that one.

### Rule 1 — One screen

A glyph MUST fit on one screen of the dashboard (≈ 1000px tall at desktop width). Long glyphs are skimmed and abandoned. If you can't fit the work in 5-10 blocks, you're covering too much. Break the work into multiple glyphs, one per phase.

### Rule 2 — One idea per block

If a block covers two ideas, split it. Each block is a single visual unit. The dashboard groups blocks into sections by id prefix — use that.

### Rule 3 — RichText is glue, not body

RichText is for 1-3 sentence transitions between visual blocks. NEVER use RichText for the actual content. If you find yourself writing 4+ sentences in a RichText, switch to:

- **A table** if you're listing things with attributes
- **A decision** if you're explaining why one option won
- **A file tree** if you're listing changes
- **A stat** if you're highlighting a number
- **A workflow** if you're describing a sequence

### Rule 4 — Lead with visuals

The first block after the title/headline should be a visual: a Stat, a Callout, or a Table. Never open with a long RichText. The user decides in 5 seconds whether to keep scrolling based on the visual.

### Rule 5 — One headline callout

Use `<Callout tone="success|danger">` once, near the top, as the TL;DR. Everything else supports it.

### Rule 6 — Truncate hints, not bodies

Stat `hint` props should be 1 short clause. Long hints mean the value needs to be a different block.

## The block vocabulary — minimal reference

| Block | What it shows | Required `data` |
| --- | --- | --- |
| `<RichText>` | 1-3 sentences of glue | none |
| `<Callout tone>` | Boxed TL;DR | none (tone defaults to info) |
| `<Stat label value trend hint />` | Big number + label | `label`, `value` |
| `<Checklist items />` | Checkbox list | `items: [{id,label,checked}]` |
| `<Table columns rows />` | Tabular data | `columns: []`, `rows: [[]]` |
| `<CodeTabs tabs />` | Tabbed code | `tabs: [{id,label,language,code}]` |
| `<Decision title question options />` | Multi-option choice | `options: [{id,label,detail,recommended?}]` |
| `<OpenQuestions questions />` | Unanswered questions | `questions: [{id,label,kind,options?}]` |
| `<FileTree title entries />` | File-by-file changes | `entries: [{path,change,note?}]` |
| `<Diff before after filename language mode />` | Before/after | `before`, `after` |
| `<Workflow steps connections />` | Node graph | `steps: [{id,label,type}]` |
| `<Mockup title x y w h html />` | Inline UI mockup | `html` |
| `<Diagram title dataHtml dataCss />` | Inline SVG | `dataHtml` |

Every block needs a unique `id`. RichText + Callout use open/close tags (markdown body); everything else is self-closing.

## Skeleton

```mdx
<RichText id="overview">
## What this is

One sentence the reader can't miss.
</RichText>

<Stat id="headline" label="X shipped" value="7" trend="flat" hint="across v3.22 → v4.4.7" />

<Callout id="tldr" tone="success">
One-sentence TL;DR.
</Callout>

<Table
  id="releases"
  columns={["v", "what", "fix"]}
  rows={[
    ["3.22", "unified", "—"],
    ["4.4.1", "bg fix", "process exit crash"],
  ]}
/>

<FileTree
  id="files"
  title="Files changed"
  entries={[
    { path: "cli/provision.mjs", change: "added", note: "unified provisioner" },
  ]}
/>
```

## The 5 things that break a glyph

These shipped as bugs. Read before writing.

### 1. Backticks inside attribute strings

The parser scans for `` ` `` and breaks. Use straight quotes or rephrase:

```
WRONG: Run `bizar install` to bootstrap.
RIGHT: Run 'bizar install' to bootstrap.
```

### 2. Braces inside string values

The brace counter doesn't know about strings. `{` / `}` in notes still bump depth. Keep note strings brace-free.

### 3. `FileTree` `change` must be exact

`added | modified | removed | renamed`. Empty string or `null` crashes on `t.bg`. Default to `modified` with a `note` when unclear.

### 4. Duplicate block ids

Comment pins and error reporting key off ids. Two blocks with the same id collide.

### 5. `## Heading <768px`

The parser sees `<7` as a malformed JSX tag. Use parentheses or colons.

## Validate before shipping

```bash
node -e "import('./bizar-dash/src/server/glyphs/mdx-compiler.mjs').then(m => { \
  const fs = require('node:fs'); \
  const out = m.compileGlyphMdxSync(fs.readFileSync('artifacts/<slug>/artifact.mdx','utf8')); \
  console.log('blocks:', out.blocks.length, 'errors:', out.errors.length); \
})"
```

Also check yourself: does it fit on one screen? Are there any 4-sentence RichText blocks? Are the stats/tables/file trees doing the heavy lifting? If not, rewrite.

## See also

- `bizar-dash/src/server/glyphs/mdx-compiler.mjs` — parser
- `bizar-dash/src/web/views/glyphs/GlyphRenderer.tsx` — React renderer (has error banner)
- `bizar-dash/src/web/views/glyphs/components.tsx` — block implementations
