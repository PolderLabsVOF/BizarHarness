---
name: glyph
description: Create and consume Bizar glyphs — visual plan/recap artifacts in `artifacts/<slug>/`. Glyphs are MDX files with frontmatter and a block vocabulary. Use for design proposals, decision recaps, and postmortems.
version: 1
---

# Glyphs — Visual Plan Artifacts

A **glyph** is a visual artifact used for plans, recaps, and design proposals. It's an MDX file in `artifacts/<slug>/artifact.mdx` that the dashboard renders with comment pin overlay and right-click context menu.

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
├── meta.json          # title, slug, status, author, created
├── artifact.mdx       # ← source of truth (git-tracked, diff-friendly)
└── comments.json      # ← free-placed pins (mutable)
```

The `meta.json` is metadata, `artifact.mdx` is the content, `comments.json` is the only mutable side-channel.

## Frontmatter

```yaml
---
title: "Short, action-oriented title"
brief: "One sentence: what this glyph is about."
status: draft | review | shipped | archived
kind: plan | postmortem | recap | design
---
```

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

## Common pitfalls

### FileTree `change` field

`change` must be exactly one of: `added`, `modified`, `removed`, `renamed`. Use the `note` field for nuance ("rewritten from scratch", "kept as-is", "deprecated").

```mdx
<FileTree
  entries={[
    { path: "src/chat/Composer.tsx", change: "modified", note: "rewritten as pill composer" }
  ]}
/>
```

### MDX heading with `<N`

A heading like `## Mobile (under 768px)` is fine. But `## Mobile <768px` breaks the MDX validator because `<7` looks like a malformed JSX tag. Always escape or rephrase.

### Block IDs must be unique within a glyph

If you copy a `<RichText>` block, change its `id`. The compiler may warn but won't fail.

### Children vs self-closing

Blocks with content (RichText, Callout) use open/close tags with children. Blocks with only data (Stat, Table, FileTree, Decision, etc.) are self-closing.

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

## How to view in the dashboard

Glyphs are rendered at `/artifacts/<slug>`. The dashboard shows them with:
- Section grouping (by block id prefix: `overview`, `implementation`, `questions`)
- Comment pin overlay (right-click to add)
- Floating toolbar (Send to agent, share)
- Read-only by default; `status: shipped` locks editing

## See also

- `bizar-dash/src/web/views/glyphs/components.tsx` — block component implementations
- `bizar-dash/src/server/glyphs/mdx-compiler.mjs` — MDX parser
- `artifacts/sample-plan-login/` — a complete worked example
- The user's Obsidian vault for the project's design notes
