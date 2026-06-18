# SUPERSEDED

This spec is superseded by the v0.5.0 plugin implementation at `plugins/bizar/src/{commands.ts,commands-impl.ts,plan-fs.ts}`. See `wiki/Changelog.md` for the implementation timeline.

---

# Bizar Plan Command — Feature Spec (v0.1)

> **Status:** Draft for implementation. No Forseti audit needed — this is a developer tool, not a runtime plugin; risk surface is low.

## Purpose

A `bizarharness plan` subcommand that lets the developer create, view, edit, and comment on local "visual plan" files. The plan is a single source-of-truth `.mdx` file, with an auto-generated HTML viewer/editor that runs in the browser via a tiny local server. Comments are stored as JSON in a sidecar file. All local, no network, no sharing.

This is Bizar's answer to the BuilderIO `/visual-plan` skill — embedded into the CLI instead of an external tool.

## User experience

```bash
# Create a new plan
bizarharness plan new my-feature
# → creates plans/my-feature/{plan.mdx, comments.json, meta.json}
# → regenerates plan.html and opens it in the browser

# Open an existing plan
bizarharness plan open my-feature
# → starts a local server on a free port
# → regenerates plan.html (bakes in current state + comments)
# → opens http://localhost:4321/ in the default browser

# List all plans
bizarharness plan list
# → table of slug | title | last edited | status

# Delete a plan
bizarharness plan delete my-feature
# → confirms then removes plans/my-feature/

# Export to standalone MDX (no editing, no comments)
bizarharness plan export my-feature > my-feature.mdx
# → just dumps the plan.mdx content
```

When the user opens `http://localhost:4321/` in their browser, they see:

1. **Header** — plan title, status, last edited, author
2. **Table of contents** — anchor links to all sections
3. **Each section** — rendered as styled HTML
   - A "💬 Comments" button that opens a side panel showing all comments on that section
   - An "Add comment" textarea in the side panel
   - A "✏️ Edit" button at the top right that toggles all sections to editable textareas
4. **Footer** — Save / Discard buttons (only visible in edit mode)

When the user clicks Save:
- PUT `/api/plan` with the new MDX content
- PUT `/api/comments` with the new comments array
- Reload the page to re-render

When the user adds a comment:
- POST `/api/comments` with `{ sectionId, text }`
- The new comment appears in the side panel
- Persists to disk on every change (autosave)

## File structure per plan

```
plans/<slug>/
├── plan.mdx          # source of truth — the plan content as MDX
├── plan.html         # auto-generated viewer/editor — regenerable, can be gitignored
├── comments.json     # comment data — regenerable from MDX, can be gitignored
└── meta.json         # metadata — title, status, author, created, lastEdited
```

`.gitignore` recommendation (added to the project's `.gitignore` by the CLI when the command is first run):
```
plans/*/plan.html
plans/*/comments.json
```

Keep `plan.mdx` and `meta.json` in source control.

## CLI implementation

### New file: `cli/plan.mjs`

```js
// Subcommands:
//   new <slug>     — create plan, open in browser
//   open <slug>    — open existing plan in browser
//   list           — list all plans
//   delete <slug>  — delete a plan (with confirmation)
//   export <slug>  — print plan.mdx to stdout
//   help           — usage info
```

### `new <slug>` flow

1. Validate slug (lowercase, hyphens, no spaces, ≤ 64 chars)
2. If `plans/<slug>/` already exists, error
3. Create `plans/<slug>/` directory
4. Write starter `plan.mdx` from template
5. Write empty `comments.json` `[]`
6. Write `meta.json` with `{ title, slug, status: "draft", author: $USER, created: $ISO_DATE, lastEdited: $ISO_DATE }`
7. Regenerate `plan.html` (bakes in current state)
8. Start local server in background
9. Open `http://localhost:4321/<slug>/` in default browser
10. Keep the server running until user Ctrl-C's

### `open <slug>` flow

Same as `new` steps 4-10, but skip creating the directory if it already exists.

### Local server

A small Node `http` server (no framework) that:
- Serves `plans/<slug>/plan.html` at `GET /`
- Serves `plans/<slug>/plan.mdx` at `GET /api/plan` (text/plain)
- Serves `plans/<slug>/comments.json` at `GET /api/comments` (application/json)
- Saves `plan.mdx` at `PUT /api/plan` (text/plain body)
- Saves `comments.json` at `PUT /api/comments` (JSON body)
- Adds a new comment at `POST /api/comments` (JSON body `{ sectionId, text, author }`)
- Server runs on port 4321 by default, falls back to 4322, 4323, etc. if busy
- Server is killed when the user Ctrl-C's the CLI

The server logs each request to stderr so the user can see what's happening.

## HTML viewer/editor template

A single self-contained HTML file (no external dependencies) that:
- Uses system fonts
- Supports dark mode via `prefers-color-scheme`
- Has clean typography (good line height, margins)
- Sections have a left-border accent color
- Comments are shown in a side panel (or below each section on small screens)
- Edit mode swaps `<div>` content for `<textarea>`s
- Save button calls the local server's PUT endpoints

The template is generated from a template file: `templates/plan.html.template`. The CLI does a string replacement on the template to bake in the current plan state + comments + meta.

### Template structure (pseudocode)

```html
<!doctype html>
<html>
<head>
  <title>{{title}} — Bizar Plan</title>
  <style>/* all CSS embedded */</style>
</head>
<body>
  <header>
    <h1>{{title}}</h1>
    <div class="meta">Slug: {{slug}} · Status: {{status}} · Last edited: {{lastEdited}} · Author: {{author}}</div>
    <div class="actions">
      <button id="edit-toggle">✏️ Edit</button>
      <button id="save-btn" hidden>💾 Save</button>
      <button id="discard-btn" hidden>↩️ Discard</button>
    </div>
  </header>
  <nav class="toc">
    <ol>{{#sections}}<li><a href="#{{id}}">{{title}}</a></li>{{/sections}}</ol>
  </nav>
  <main>
    {{#sections}}
    <section id="{{id}}">
      <h2>{{title}}</h2>
      <div class="content" data-section-id="{{id}}">{{{renderedHtml}}}</div>
      <button class="comment-btn" data-section-id="{{id}}">💬 {{commentCount}}</button>
    </section>
    {{/sections}}
  </main>
  <aside id="comment-panel" hidden>
    <h3>Comments on <span id="comment-section-title"></span></h3>
    <div id="comment-list"></div>
    <textarea id="new-comment" placeholder="Add a comment..."></textarea>
    <button id="add-comment-btn">Add</button>
    <button id="close-comment-panel">Close</button>
  </aside>
  <script>
    // Embedded state
    const INITIAL_STATE = {
      plan: {{planJson}},
      comments: {{commentsJson}},
      meta: {{metaJson}}
    };
    // Editor logic
    // ...
  </script>
</body>
</html>
```

### Editor logic (embedded JS)

- On load, hydrate the state from `INITIAL_STATE`
- Edit toggle: swap each `.content` div for a textarea pre-filled with the section's markdown
- Save: collect all textarea values, build new plan content, PUT to `/api/plan` and `/api/comments`, then reload
- Discard: revert to original state, exit edit mode
- Comment button: open side panel, show comments for that section, allow adding new
- Add comment: POST to `/api/comments`, refresh panel
- Section IDs are generated from section titles (kebab-case, unique)

## Server-side rendering of MDX-ish content

The plan is written in a Markdown-like syntax with some extra Bizar-specific elements (status grids, tradeoff matrices, callouts). For v0.1, we'll just use plain Markdown and render it with a tiny client-side Markdown renderer (e.g., `marked` via CDN, or a minimal hand-rolled one).

For v0.1, the markdown is rendered client-side. The server doesn't parse or render — it just serves the raw text.

This is simpler than full MDX and still gives 90% of the value. The BuilderIO visual-plan uses MDX with React components, but we can achieve a similar look with plain Markdown + CSS.

## Test plan

### Unit tests

- `cli/plan.mjs` exports the right subcommands
- `new` creates the expected files
- `list` correctly reads `plans/` and reports metadata
- `delete` removes the directory
- `export` prints the right content

### Integration test in dev sandbox

1. Run `bizarharness plan new test-plan` in a temp directory
2. Verify `plans/test-plan/{plan.mdx, comments.json, meta.json, plan.html}` exist
3. Start the local server in the background
4. `curl http://localhost:4321/` — should return the HTML
5. `curl http://localhost:4321/api/plan` — should return the MDX
6. `curl http://localhost:4321/api/comments` — should return `[]`
7. `curl -X PUT http://localhost:4321/api/plan -d 'NEW CONTENT'` — should save
8. `curl -X POST http://localhost:4321/api/comments -d '{"sectionId":"x","text":"hi","author":"test"}'` — should add
9. `curl http://localhost:4321/api/comments` — should now have one comment
10. Kill the server

### Manual test

Open the HTML in a browser, verify:
- Plan renders with good typography
- Edit mode swaps content for textareas
- Save persists changes
- Comments work (add, view, delete)

## File changes

### New files

```
BizarHarness/
├── cli/
│   └── plan.mjs                 # the plan command
├── templates/
│   └── plan/
│       ├── plan.html.template   # the viewer/editor template
│       ├── plan.mdx.template    # starter plan content
│       └── meta.json.template   # starter meta.json
```

### Modified files

- `BizarHarness/cli/bin.mjs` — add `plan` to the subcommand router
- `BizarHarness/cli/prompts.mjs` — add `plan` to the install prompt? (or skip — plan is a runtime command, not an installable component)
- `BizarHarness/.gitignore` — add `plans/*/plan.html` and `plans/*/comments.json`
- `BizarHarness/README.md` — add a "Plans" section documenting the command
- `BizarHarness/.bizar/AGENTS_SELF_IMPROVEMENT.md` — append a self-improvement entry

## Out of scope (v0.1)

- Real-time collaboration (multiple users editing same plan)
- Diff/merge between plan versions
- Plan templates (just one default for v0.1)
- Export to PDF
- Linking plans to git commits / branches
- WebSocket-based live updates
- Authentication (it's localhost, single-user)
- Hosting (we're local files only — explicit user choice)

These could be v0.2+ if there's demand.

## Estimated effort

- `cli/plan.mjs` — 2-3 hours
- `templates/plan.html.template` — 3-4 hours (CSS + JS for the editor)
- `templates/plan.mdx.template` — 30 min
- Tests — 1-2 hours
- Docs + gitignore + bin.mjs wiring — 30 min
- **Total: 7-10 hours of work, split Tyr (template) + Thor (CLI + tests)**
