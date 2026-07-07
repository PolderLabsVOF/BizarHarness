# Plans Command

`bizar plan` is a developer tool for creating local visual plans. A plan is a single source-of-truth `.mdx` file with an auto-generated HTML viewer/editor that runs in your browser via a tiny local server. Comments are stored in a sidecar JSON file. Everything is local — no network, no sharing, no remote storage.

## Quick start

```bash
# Create a new plan
bizar plan new my-feature
```

This creates `plans/my-feature/` with four files, regenerates the HTML viewer, starts a local server on port 4321, and opens the viewer in your default browser. The server runs until you press Ctrl-C.

```bash
# Open an existing plan
bizar plan open my-feature

# List all plans
bizar plan list

# Delete a plan (with confirmation)
bizar plan delete my-feature

# Export the plan as MDX to stdout
bizar plan export my-feature > my-feature.mdx
```

## The 5 subcommands

| Subcommand | Purpose |
|---|---|
| `new <slug>` | Create a new plan, regenerate HTML, start server, open browser |
| `open <slug>` | Open an existing plan in the browser (regenerates HTML first) |
| `list` | List all plans in the project, sorted by last edited |
| `delete <slug>` | Delete a plan directory (with confirmation prompt) |
| `export <slug>` | Print the plan's MDX content to stdout |
| `help` | Show usage |

The `new` and `open` subcommands start a local HTTP server. The server runs in the same process as the CLI and exits on Ctrl-C.

## File structure per plan

Each plan lives in its own directory:

```
plans/<slug>/
├── plan.mdx          # source of truth — the plan content as MDX
├── plan.html         # auto-generated viewer/editor (regenerable)
├── comments.json     # comment data (regenerable from MDX)
└── meta.json         # metadata — title, status, author, timestamps
```

### What goes in git

- `plan.mdx` — the source of truth. **In git.**
- `meta.json` — title, status, author, created, lastEdited. **In git.**
- `plan.html` — auto-generated from the template. **Gitignored.**
- `comments.json` — comment data. **Gitignored.**

The first time you run `bizar plan new` in a project, the CLI suggests adding these lines to `.gitignore`:

```
plans/*/plan.html
plans/*/comments.json
```

## Slug validation

Slugs must:

- Be 1-64 characters long.
- Start with a lowercase alphanumeric character (`a-z` or `0-9`).
- Contain only lowercase alphanumerics and hyphens.
- Match the regex `^[a-z0-9][a-z0-9-]{0,63}$`.

Examples: `auth-redesign`, `v2-api`, `add-rate-limiting`. Invalid: `MyFeature` (uppercase), `-foo` (starts with hyphen), `feature_v2` (underscore not allowed).

## Browser editor features

When you open a plan in the browser, you see:

1. **Header** — plan title, status, last edited, author.
2. **Table of contents** — anchor links to all sections, auto-generated from headings.
3. **Each section** — rendered as styled HTML with:
   - A "💬 Comments" button that opens a side panel showing all comments on that section.
   - An "Add comment" textarea in the side panel.
   - An "✏️ Edit" button at the top right that toggles all sections to editable textareas.
4. **Footer** — Save / Discard buttons (only visible in edit mode).

When you click Save:

- `PUT /api/plan` with the new MDX content.
- `PUT /api/comments` with the new comments array.
- The page reloads to re-render with the saved state.

When you add a comment:

- `POST /api/comments` with `{ sectionId, text, author }`.
- The new comment appears in the side panel.
- The change persists to disk immediately (autosave).

## .gitignore conventions

The CLI writes these lines to your `.gitignore` the first time you run `plan new` in a project:

```
plans/*/plan.html
plans/*/comments.json
```

This keeps the source of truth (`plan.mdx`, `meta.json`) in version control while ignoring the regenerable viewer (`plan.html`) and the sidecar comments (`comments.json`).

If you want to commit comments to git (e.g., for shared review), remove the second line. If you want the HTML viewer in git (e.g., to publish as a static page), remove the first line.

## Local server

The local server runs in the same process as the CLI. It:

- Tries port 4321 first, falls back to 4322, 4323, etc. (max 10 attempts).
- Binds to `127.0.0.1` (localhost only).
- Serves the HTML viewer at `GET /<slug>/`.
- Exposes the MDX source at `GET /api/plan` (text/plain).
- Exposes comments at `GET /api/comments` (application/json).
- Accepts saves at `PUT /api/plan` and `PUT /api/comments`.
- Accepts new comments at `POST /api/comments`.
- Logs every request to stderr.
- Cleans up on SIGINT / SIGTERM.

The server has no external dependencies. It's a small Node `http` server, no framework, no CDN. Everything is local.

## Example: from a plan to a commit

A typical workflow:

```bash
# 1. Draft a plan for a new feature
bizar plan new oauth-integration

# 2. Edit the plan in the browser (textareas toggle, save persists)
#    Add sections, write the API contract, sketch the migration
#    Leave comments for the team to review

# 3. Commit the source of truth
git add plans/oauth-integration/plan.mdx plans/oauth-integration/meta.json
git commit -m "docs(plan): draft oauth-integration plan"

# 4. Open the plan during standup
bizar plan open oauth-integration

# 5. Once the plan is approved, dispatch implementation
#    (in cline, with BizarHarness routing)
@tyr execute plans/oauth-integration/plan.mdx

# 6. When done, archive or delete
bizar plan delete oauth-integration
```

The plan lives in your repo as long as the work is in flight. Once the implementation is merged, you can delete the plan directory (or keep it as a record of the design).

## v0.5+ — Plugin-driven plan canvas (in-cline)

As of v0.5.0, the Bizar plugin ships its own plan canvas that runs **inside cline**, accessible via the `/plan` slash command family. This is the recommended path for new work; the CLI tool above is still supported for power users and CI integration.

The plugin-driven plan is a single source of truth at `plans/<slug>/plan.json` with a sidecar `meta.json` for status. The plugin's `bizar_plan_action` tool handles all reads and writes. The plugin tool surface is exposed to the agent through a synthetic `ToolContext`, and the agent invokes the tool in response to `/plan new|add|comment|status` slash commands.

| Slash command | Routes to | What it does |
|---|---|---|
| `/plan new <slug>` | `bizar_plan_action(action: "create_plan")` | Creates the plan, refuses to clobber existing. |
| `/plan list` | `bizar_plan_action(action: "list_plans")` | Lists all plans in the project, sorted by last edited. |
| `/plan open <slug>` | `bizar_plan_action(action: "open_plan_url")` | Returns the local viewer URL. |
| `/plan get <slug>` | `bizar_plan_action(action: "get_canvas")` | Dumps the full plan.json. |
| `/plan add <slug> --title X --type task` | `bizar_plan_action(action: "add_element")` | Adds a new element. |
| `/plan update <slug> <id> --x 50 --y 50` | `bizar_plan_action(action: "update_element")` | Patches an element. |
| `/plan delete <slug> <id>` | `bizar_plan_action(action: "delete_element")` | Removes the element and its connections + comments. |
| `/plan comment <slug> [el_id] "text"` | `bizar_plan_action(action: "add_comment")` | Pins a comment to an element (or the canvas). |
| `/plan comments <slug> [el_id]` | `bizar_get_plan_comments` | Lists comments (optionally filtered by element). |
| `/plan status <slug> <status>` | `bizar_plan_action(action: "set_status")` | Sets status: `draft`, `approved`, `rejected`, `in-progress`, `done`. |
| `/plan wait <slug>` | `bizar_wait_for_feedback` | Defers — agent pauses for human feedback. Returns `feedback_received`, `approved`, `rejected`, or `timed_out`. |
| `/help` | (plugin) | Lists the plugin's own commands. |

The two implementations (`bizar plan` CLI vs `/plan` slash command) read and write the same `plan.json` format. You can mix and match: use the CLI for CI or batch operations, use the slash command for in-cline work. The slash command is the recommended path because it stays in the agent's context and supports comments and status.

For the full reference, see [Commands Reference → Bizar plugin commands](Commands-Reference#bizar-plugin-commands).

## Next steps

Next: [Self-Improvement](Self-Improvement) — how agents record lessons and improve over time.
