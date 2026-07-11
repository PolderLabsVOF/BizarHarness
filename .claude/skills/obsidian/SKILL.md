---
name: obsidian
description: Use the Bizar Memory Service for persistent project knowledge — local Obsidian-compatible Markdown + Git-shared sync. Read vault entries before non-trivial decisions; write after meaningful work. Three layers: Markdown (truth) → Git (collaboration) → LightRAG (derived index, Phase 2). Triggers when memory vaults, vault entries, or shared project knowledge are referenced.
version: 2
---

# Bizar Memory Service — Project Knowledge

**The Bizar Memory Service is the project's persistent knowledge layer.** It replaces the disabled Hindsight MCP service. Every Bizar project uses the same three-layer architecture; only the backend mode (`local-only` vs `managed`) and the vault location differ.

The user has been working on this project — their notes contain the real context, the gotchas, the failed approaches, the preferred patterns. **Read the relevant vault entries before making any non-trivial decision.**

## Quick Start for Agents

**First-time setup** (if `.bizar/memory.json` is missing):
```bash
bizar memory setup --remote git@github.com:you/bizar-memory.git
bizar memory status    # confirm vault reachable
bizar memory doctor    # schema + secrets + git state
```

Memory is accessed via the `bizar memory` CLI — agents have `Bash` access and can invoke it directly.

**Find the vault root:**
```bash
bizar memory status
```

**Search memory:**
```bash
bizar memory search "<query>"
```

**Read a specific note:**
```bash
# 1. List notes to find the path
bizar memory list 2>/dev/null || ls ~/.local/share/bizar/memory/bizar-memory/projects/<projectId>/
# 2. Read the note
cat ~/.local/share/bizar/memory/bizar-memory/projects/<projectId>/<relpath>
```

**Write a new note:**
```bash
bizar memory write <relpath> \
  --type <type> \
  --status active \
  --confidence verified \
  --tag <tag1> --tag <tag2> \
  --body "<body text>"
```

`<relpath>` is relative to the project namespace root (e.g. `decisions/0001-foo.md`). Do NOT include the `projects/<projectId>/` prefix — that double-nests.

**Commit and push (if shared vault):**
```bash
bizar memory sync
```

**Health check:**
```bash
bizar memory doctor
```

## The three layers

| Layer | Role | Backed by | Write path |
|---|---|---|---|
| **Markdown** | Canonical truth | Obsidian-flavoured `.md` files on disk | Author writes here; this is the only layer that is authoritative |
| **Git** | Collaboration / history | The vault directory is a Git repo (local-only mode keeps it as a local repo with no remote) | The `bizar memory sync` orchestrator runs `git add/commit/push` after a write |
| **LightRAG** (Phase 2) | Derived search index | A LightRAG server (disabled by default in `memory.json`) | NEVER write here directly — always rebuild from Markdown via `bizar memory reindex` |

**Rule of thumb:** if you wanted to "update the project's memory," write Markdown. Git and LightRAG follow.

## Vault location

The root of the vault is determined by `.bizar/memory.json` in the active project. Two modes:

- **`local-only` (default)** — vault is `.obsidian/` inside this project. Single-machine. Stays out of any cross-project repo. Use this when the project is solo or when the project itself is private.
- **`managed`** — vault is `~/.local/share/bizar/memory/<repoName>/` (a user-level shared repo). Multiple projects contribute to the same Git repo under per-project namespaces. Use this when you want cross-project search and a single source of truth across all your Bizar projects.

`bizar memory status` prints the active mode and resolved paths; `bizar memory doctor` validates the vault is reachable and the Git state is consistent.

## The three namespaces

Namespaces live at the vault root. Pick a namespace by deciding the SCOPE of the note, not the project.

| Namespace | Path (under vault root) | When to write here |
|---|---|---|
| **project** | `projects/<projectId>/` | Anything specific to THIS project — design decisions, postmortems, agent-tuning notes, project-local gotchas, daily logs of what happened in this repo |
| **global** | `global/bizar/` | Anything that applies to Bizar AS A SYSTEM, regardless of project — agent patterns, model-routing rules, CLI conventions, cross-project gotchas that should reach every project you work on |
| **user** | `users/<userId>/` | Anything that is purely personal — your preferences, your scratch notes, your "things I keep forgetting" |

Resolution rule: **memory root = `~/.local/share/bizar/memory/<repoName>/` (or `.obsidian/`) + the namespace you picked**. The `projectId` is the basename of the project root (e.g. `bizar` for `/path/to/bizar`); the `userId` is the OS username.

When in doubt, write to **project**. Promote to **global** only when the pattern repeats across another project; demote to **user** only when it's purely personal preference.

## How to read vault entries

### Via the dashboard REST API (canonical)

```bash
# List notes under a namespace
curl -s http://127.0.0.1:4321/api/memory/notes?namespace=projects/bizar | jq

# Read a specific note (returns parsed frontmatter + body)
curl -s http://127.0.0.1:4321/api/memory/notes/projects/bizar/Architecture.md | jq

# Full-text search (Markdown content + frontmatter)
curl -s -X POST http://127.0.0.1:4321/api/memory/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"router ordering","namespace":"projects/bizar"}' | jq
```

### Via the CLI

```bash
bizar memory search "router ordering"           # full-text search
bizar memory status                             # show mode + paths + git status
bizar memory doctor                             # health check
bizar memory log --tail 20                      # recent operations log
bizar memory conflicts                          # list notes with status=conflict
```

## Operations

- **Open in Obsidian**: `/kb` — opens the project vault in Obsidian (resolves
  from .bizar/memory.json; falls back to printing the path if Obsidian isn't
  installed)

### Via direct file read (acceptable for one-off reads)

```bash
# local-only
cat .obsidian/projects/<projectId>/Architecture.md

# managed
cat ~/.local/share/bizar/memory/bizar-memory/projects/<projectId>/Architecture.md
```

Direct reads bypass the dashboard, which is fine for diagnostics. Bypass the dashboard for writes too ONLY in an emergency (CI recovery, hook-driven bots) — always prefer the API for agent-driven writes so the schema, secret scan, and Git sync run.

## How to write vault entries

### Via the dashboard REST API (canonical)

```bash
# Write or update a note — the API validates schema, scans for secrets, and
# runs the sync orchestrator (git commit) if memory.json.git.autoCommit is on.
curl -s -X POST http://127.0.0.1:4321/api/memory/notes \
  -H 'Content-Type: application/json' \
  -d '{
    "path": "projects/bizar/adr/0001-router-ordering.md",
    "namespace": "projects/bizar",
    "frontmatter": {
      "title": "Router ordering: Forseti before Tier 4/5",
      "type": "architecture_decision",
      "status": "active",
      "confidence": "verified",
      "date": "2026-06-29",
      "tags": ["router", "agents"]
    },
    "body": "## Context\n...\n## Decision\n...\n## Consequences\n..."
  }'

# LightRAG reindex — NEVER run during a write. Schedule from the
# orchestrator or run manually after a batch of writes.
curl -s -X POST http://127.0.0.1:4321/api/memory/reindex \
  -H 'Content-Type: application/json' \
  -d '{"namespace":"projects/bizar"}'
```

The rich shape (path, namespace, frontmatter, body) is the canonical write. The legacy `/api/obsidian/notes` endpoint accepts the same body wrapped as `{ content: "<frontmatter + body>", path, namespace }` for back-compat.

### Via the CLI

```bash
bizar memory write "<path>"                       # opens $EDITOR for the body
bizar memory sync                                 # git add/commit/push the staged notes
bizar memory commit -m "adr: 0001 router ordering"
bizar memory pull                                 # fetch + rebase from configured remote
bizar memory push                                 # push committed notes to remote
bizar memory reindex                              # rebuild LightRAG from Markdown (Phase 2)
bizar memory conflicts                            # human review surface for status=conflict
```

## When to read

- **At the start of every session** — skim the project namespace's index entries (`index/`, `_index.md`, anything tagged `type: project_index`).
- **Before any non-trivial implementation decision** — search the relevant namespace for prior art.
- **When you're about to suggest something the user has already tried** — search before recommending.
- **When the codebase feels like it's working around something you don't understand** — there's probably a vault entry explaining the why.
- **When you encounter a `// FIXME` or `// HACK` comment** — there's probably a vault entry explaining it.
- **Before claiming a pattern is "the Bizar way"** — global namespace might say otherwise.

## When to write

- **After completing a meaningful piece of work** — what was decided, what was learned, what the consequences were.
- **On discovering a bug or postmortem** — `type: bug_postmortem` with the root cause, evidence links, and the fix.
- **When you find a pattern that should be reused** — `type: pattern`, with the rationale and a code snippet.
- **When the user corrects you** — `type: lesson_learned` with what was wrong, why, and the new rule.
- **When you make a design decision that should be remembered** — `type: architecture_decision` (the classic ADR format).
- **When you encode an active rule** that future sessions should follow — `type: active_rule`, and (importantly) also add it to `.bizar/AGENTS_SELF_IMPROVEMENT.md` under "Active Rules" so the orchestrator picks it up before vault lookups.

## Write categories (matches the 11 schema `type` values)

| type | Use when |
|---|---|
| `architecture_decision` | ADR — context, decision, consequences |
| `pattern` | Reusable approach with code example |
| `lesson_learned` | A mistake or surprise the next agent should not repeat |
| `bug_postmortem` | Root-cause analysis of an actual bug, with evidence |
| `active_rule` | A standing rule for this project (mirror in `.bizar/AGENTS_SELF_IMPROVEMENT.md`) |
| `agent_memory` | Per-agent history — what THIS agent learned across sessions |
| `project_index` | Top-level entry points (`Architecture`, `Conventions`, `Entry-Points`) |
| `reference` | External API docs, tool notes, library gotchas |
| `workflow` | Multi-step procedure with prerequisites + steps + verification |
| `note` | Free-form scratch that doesn't fit another category |
| `adr` | Alias for `architecture_decision` (kept for legacy writers) |

## Status values (frontmatter `status`)

| status | Meaning | When to use |
|---|---|---|
| `active` | Current truth | The note still reflects reality |
| `draft` | Work in progress | Agent is still thinking; do not auto-commit |
| `superseded` | Replaced by a newer note | **Always link `superseded_by` to the replacement** |
| `stale` | Probably outdated | Needs human review — the orchestrator tags these after a `--reindex` heuristic |
| `conflict` | Two versions disagree | **Requires human resolution** — never auto-resolve |
| `archived` | Kept for history, not searched | Visible only with explicit namespace filter |

## Confidence values (frontmatter `confidence`)

| confidence | Meaning | Rule |
|---|---|---|
| `verified` | Proven with evidence | Always link the evidence file in the note body (`path:line` citation) |
| `inferred` | Likely true but unproven | Phrase the body as "appears to be" / "based on X, looks like" |
| `speculative` | Hypothesis to test | Mark with `type: pattern` and a clear "to verify" section |

**Prefer `verified`.** A note with no evidence is a hypothesis at best. The schema rejects writes missing required fields for `architecture_decision` and `lesson_learned`.

## Conflict handling

The service NEVER auto-resolves a conflict. When the same path is written from two sources (e.g. local edit + remote pull that doesn't fast-forward), the orchestrator:

1. Renames the incoming version to `<path>.conflict-<timestamp>.md`.
2. Sets BOTH versions' `status: conflict`.
3. Exits non-zero so the user can review.
4. Lists both in `bizar memory conflicts`.

Human resolution:

1. Read both versions.
2. Decide which is canonical (usually the more recent or more evidence-backed).
3. Edit the losing version: `status: superseded`, set `superseded_by: <winning-path>`, add a `## Why this was superseded` section.
4. `bizar memory sync` to commit the resolution.

Never delete a superseded note — history matters.

## Secret scanning (commit gate)

`bizar memory commit` (and the auto-commit path during a write) runs the secret scanner over the staged Markdown. Severities:

- **HIGH** — real API keys, bearer tokens, PEM blocks, password= assignments → **BLOCKS the commit**. Fix the leak first, then commit. Use `.template` files and `.gitignore` for live secrets (see `.bizar/AGENTS_SELF_IMPROVEMENT.md` rule #4 for the token-leak history).
- **MEDIUM** — credential-like patterns (e.g. `ghp_*` with weak validation), obvious test fixtures that could be mistaken for real keys → warns. Commit proceeds unless `--strict`.
- **LOW** — possible PII, dev URLs on non-public hosts → informational.

Override flags: `--allow-secrets` (HIGH-bypass), `--strict` (LOW-becomes-warning). Never use `--allow-secrets` to ship a real credential — fix the secret in the source, not the gate.

## Markdown conventions (Obsidian-flavoured)

- **Frontmatter is YAML** between the leading and trailing `---` lines. Required keys depend on `type`; the validator in `memory-schema.mjs` enforces this.
- **`[[wikilinks]]`** point at note paths relative to the vault root (e.g. `[[projects/bizar/Architecture]]`, not `[[Architecture]]`).
- **Tag lists** (`tags: [a, b]`) drive search; keep them short and concrete.
- **Code blocks** with language tags survive parsing — use them for snippets longer than 2 lines.
- **Callouts** (`> [!note]`, `> [!warning]`) are preserved; use `> [!danger]` for HIGH-severity warnings.
- **Status emojis** are noise — keep notes emoji-free unless the user has put one in the frontmatter.

## Sync model

The vault directory is a Git repo. `bizar memory sync` does, in order:

1. **Pull** — `git fetch` and `git rebase` from the configured remote (no-op for local-only).
2. **Schema check** — every staged file is validated by the schema in `memory-schema.mjs`. Bad files become `untracked` until fixed.
3. **Secret scan** — staged content is scanned; HIGH blocks, MEDIUM warns.
4. **Stage** — `git add` of all Markdown under the vault root.
5. **Commit** — `git commit` with `commitMessageTemplate` (default `memory({projectId}): {summary}`).
6. **Push** — only if `memory.json.git.autoPushOnSessionEnd` is true.

`autoCommitOnMemoryWrite` defaults to `false` — writes return success without committing. The user reviews and runs `bizar memory sync` themselves. This is the default for production deployments.

## What NOT to write

- **Secrets, API keys, tokens** — the secret scanner blocks them, but defense in depth: never produce them in the first place.
- **Temporary scratch that won't be useful in 7 days** — keep that in a TODO comment in code, not the vault.
- **Long code dumps** — link with `path:line` so the note stays a living doc. Two-line snippets are fine.
- **Anything already obvious from reading the code** — the vault is for things code CAN'T say.
- **Notes that are already in another namespace** — search before writing to avoid duplicates; if you must mirror, link with `mirror_of: <other-path>`.

## See also

- `.bizar/AGENTS_SELF_IMPROVEMENT.md` — project-specific active rules (read before vault lookups).
- `.bizar/PROJECT.md` — stack, conventions, entry points (Vör reads this first).
- `wiki/Architecture.md` — system-level architecture, including the Memory section.
- `wiki/Self-Improvement.md` — self-improvement log conventions.
- `config/skills/glyph/SKILL.md` — graphify knowledge graph (separate from the memory vault).
- `config/skills/obsidian-skills/SKILL.md` — Obsidian Markdown / Bases / Canvas / CLI (auto-installed by `install.sh` via `skills add kepano/obsidian-skills`).
