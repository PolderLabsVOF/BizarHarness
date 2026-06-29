# FAQ

Common questions about BizarHarness. If you have a question that's not answered here, open a GitHub issue or discussion.

## General

### Why "Bizar"?

Bizar is short for "Bizarre" — a nod to the Norse-pantheon theme (Baldr, Odin, Thor, Tyr are all Old Norse). The "Bizar" prefix also makes the Bizar plugin (`bizar_*` tool names) and the Bizar folder (`.bizar/`) easy to grep for and easy to remove if you decide BizarHarness isn't for you.

### Why Norse mythology?

Naming agents after Norse deities gives each one a memorable identity and a single-character rune (ᛟ ᚠ ᛢ ᛗ ᚹ ᚱ ᚦ ᛒ ᛏ ᛉ ᚨ) that fits in a single column. The metaphor is loose — Tyr doesn't actually represent law and war in BizarHarness, he just represents complex implementation work. The metaphor is a mnemonic, not a model.

### Is this a fork of opencode?

No. BizarHarness is a configuration layer on top of [opencode](https://opencode.ai). It ships agent definitions, a plugin, and a CLI. opencode provides the runtime, the TUI, the permission system, the hook system, and the MCP integration. BizarHarness would not exist without opencode.

### Is the Bizar plugin required?

No. You can disable the Bizar plugin by removing the entry from `opencode.json` or by setting `BIZAR_DISABLE=1` in the environment. The agents will work without the plugin — you'll lose loop detection, status logging, and the handoff mechanism, but routing still functions.

See the [Bizar Plugin](Bizar-Plugin) page for details on disabling.

## Configuration

### Can I use this without Hindsight?

Yes — and as of v3.24.0, Hindsight is **disabled by default**. The Memory Service replaces it. Without any extra setup, every project gets a local-first vault at `.obsidian/` (default `local-only` mode) that holds conventions, ADRs, bug patterns, and command snippets. No external service, no API key. Routing, the plugin, and `.bizar/AGENTS_SELF_IMPROVEMENT.md` all work the same way.

### Can I use this without Anthropic?

Yes. BizarHarness does not use Anthropic models at all. The default stack is DeepSeek V4 Flash (free) + MiniMax M2.7 + MiniMax M3. Anthropic is not in any agent's model list and the dev sandbox explicitly strips Anthropic references.

### Can I add my own agents?

Yes. Drop a new `<name>.md` file in `config/agents/` (or in `~/.config/opencode/agents/` for a per-user install) and re-run the installer. The file should have YAML frontmatter (`name`, `model`) and a Markdown   body that includes:

- A `## Role` section describing what the agent does.
- A `## When to Use` section with example invocations.
- A `## Memory Service Protocol` section (copy the canonical text from another agent's file).
- A `## Loop Guard Handling` section (copy the canonical text from another agent's file).

Odin will pick up the new agent via the `task` tool with `subagent_type: <your-agent-name>`.

### Can I change the model per agent?

Yes. Edit the agent's `.md` file and change the `model:` field. Then re-run the installer to copy the updated file into `~/.config/opencode/agents/`. The new model takes effect on the next opencode restart.

### Can I disable the plugin?

Yes. Three options:

- **Temporarily:** Set `BIZAR_DISABLE=1` in the environment before launching opencode.
- **Permanently for a session:** Remove the plugin entry from `opencode.json`.
- **Permanently:** Delete the `plugins/bizar/` directory.

See the [Bizar Plugin](Bizar-Plugin) page for the full list of env-var toggles (`BIZAR_DISABLE_LOOP`, `BIZAR_DISABLE_LOG`, `BIZAR_LOG_LEVEL`).

## Compatibility

### Can I run this on Windows?

The CLI works on Windows with some caveats:

- Use Git Bash or WSL, not cmd.exe. The `install.sh` script is bash-only.
- Path separators in the CLI are cross-platform (uses `path.dirname`, not string slicing) after the v1.2.1 fixes.
- The dev sandbox (Docker) works on Windows with Docker Desktop installed.

The most common Windows-specific issues are documented in the [Troubleshooting](Troubleshooting) page. The BizarHarness npm package was hardened for Windows path handling in v1.2.1.

### Does this work with Claude Code / Cursor / Copilot?

The Bizar plugin is opencode-specific (it uses opencode's plugin API and hook surface). The agent definitions and the BizarHarness CLI can be adapted to other harnesses via `bizar export <target>`, but the bundled plugin only works in opencode.

### Does this work with local models (Ollama, LM Studio)?

In principle, yes. The agent files accept any `<provider>/<model>` string. Configure the local model in opencode's `/connect`, then edit the target agent's `.md` file to use it. The free tier (DeepSeek V4 Flash) is just one choice — local models can fill the same slot.

## Operations

### How do I update BizarHarness?

```bash
npm update -g @polderlabs/bizar
# or
npm install -g @polderlabs/bizar@latest
```

After the npm package updates, re-run the installer:

```bash
bizar
```

The installer is idempotent — it preserves your existing config and only copies new or changed files. If a config conflict arises, it backs up the existing file to `opencode.json.bak` first.

To update from source (for contributors):

```bash
cd BizarHarness
git pull
./install.sh
```

### How do I see what the agents are doing in real time?

The Bizar plugin logs every tool call to `~/.cache/bizar/logs/<sessionId>.log`. Tail the file in another terminal:

```bash
tail -f ~/.cache/bizar/logs/<sessionId>.log
```

The log is metadata only (timestamp, session ID, tool name, fingerprint hash, outcome, duration) — no tool args or session content.

### How do I clear Memory Service notes for a project?

Memory notes are plain files — clearing them is just file deletion:

1. **Local-only mode:** delete the vault. `rm -rf .obsidian/` then re-run `bizar memory init` to start fresh.
2. **Managed mode:** delete the project's namespace. `rm -rf ~/.local/share/bizar/memory/<repoName>/projects/<projectId>/` then run `bizar memory sync` to commit the deletion upstream.

The `global/bizar/` namespace holds shared agent patterns and should **not** be cleared casually. The `users/<userId>/` namespace is personal scratch and is safe to wipe.

For soft cleanup without deletion, `bizar memory doctor` reports stale and conflicting notes that you can resolve individually.

## Pricing

### What does it cost to run?

Most work is free. The free tier (DeepSeek V4 Flash) handles read-only Q&A, mechanical edits, codebase search, and clarification. You only pay for moderate implementation (M2.7 at $0.30/M in, $1.20/M out) and complex implementation (M3, same pricing). GPT-5.5 (Vidarr) is a subscription — only used as a last resort.

A typical session that includes a few Mimir/Frigg/Heimdall calls and a couple of Thor calls costs under $0.10. A session with a Tyr-grade architecture task might cost $0.30-$1.00 depending on the size of the response. Vidarr is reserved for genuinely hard problems.

### Is there a way to estimate cost before running?

Not directly. The closest you can get is to read the agent's prompt and estimate the input/output token count. The Bizar plugin logs the tool count per session, which is a rough proxy for cost (each tool call adds tokens to the context). For a tighter budget, set `BIZAR_BACKGROUND_TOOL_CALL_CAP=200` to cap background work and `BIZAR_MAX_CONCURRENT_INSTANCES=2` to limit parallelism.

## Project

### How do I cite BizarHarness in a paper / blog post?

```
BizarHarness: Norse-pantheon multi-agent system for opencode.
https://github.com/DrB0rk/BizarHarness
```

### Is BizarHarness production-ready?

BizarHarness 2.0+ (with the Bizar plugin at v0.5.1) is stable for daily use. Agent routing, the install flow, the Bizar plugin's loop guard and plan canvas, and the slash commands are all tested. Background agents (v0.4+) are no longer marked experimental — they are used in production validation runs. The `/tailscale-serve` command (v0.5.1) is a thin wrapper around `tailscale serve`; the upstream Tailscale feature is the long-term stable surface.

The remaining limitations are documented: plugin has no hot-reload, `install.sh` does not detect when the installed plugin is older than the source, and certain pre-existing tsc errors in plugin tests are not yet fixed. See [Troubleshooting](Troubleshooting) for the full list.

### How is BizarHarness licensed?

MIT. See the [LICENSE](https://github.com/DrB0rk/BizarHarness/blob/main/LICENSE) file in the repo.

## Bizar plugin

### What's the difference between v0.3, v0.4, v0.5?

- **v0.3.x** — loop guard, status reporting, handoff. Single tool surface (per-session, per-tool fingerprint). The original release.
- **v0.4.x** — adds background agents (`bizar_spawn_background`, `bizar_status`, `bizar_collect`, `bizar_kill`). Single `opencode serve` child. State on disk.
- **v0.5.0** — adds plan side-effects (`/plan new|add|comment|status`), `bizar_plan_action`, `bizar_get_plan_comments`, `bizar_wait_for_feedback`, stall and thinking-loop detection. Plan files at `~/.cache/bizar/state/bg/<instanceId>.json`.
- **v0.5.1** — fixes the empty-sessionId bug in `bizar_spawn_background`. The regression test in `plugins/bizar/tests/attach-handler-bug.test.ts` would have caught this. Test count: 488 → 491.

### What happens if the plugin crashes mid-session?

The plugin's `dispose()` handler runs on `SIGTERM` or `SIGINT` (or on process exit). It:

1. Marks all `running` and `pending` background instances as `failed` with `error: "shutdown"`.
2. Calls `POST /session/{id}/abort` on each.
3. Sends `SIGTERM` to the `opencode serve` child (if alive).
4. Closes the SSE stream.
5. Calls `process.exit(0)`.

State files at `~/.cache/bizar/state/bg/*.json` are **preserved** — they are the recovery surface for the next opencode launch.

### How do I add a new loop-guard threshold?

Edit the plugin options in `opencode.json`:

```jsonc
"plugin": [
  ["./plugins/bizar/index.ts", {
    "loopThresholdWarn": 4,
    "loopThresholdEscalate": 7,
    "loopThresholdBlock": 10,
    "loopWindowSize": 8
  }]
]
```

The plugin clamps and reorders the values: `warn < escalate < block`, and `block <= window + 2`. It will not throw on bad input.

**Warning:** the canonical handoff messages hardcode the default threshold numbers ("5 identical calls", "8 identical calls", "12 identical calls"). If you reconfigure the thresholds, the actions still fire at the new counts, but the message text still says the defaults. Subagents may fail to recognize the handoff. Either keep the defaults, or update the agent prompts' recognition patterns.

## Slash commands

### How do I see all available slash commands?

Type `/help` in opencode. The plugin's `/help` returns its own command list; the opencode-built-in `/help` returns the broader set including user-level and project-level commands.

The full list is on the [Commands Reference](Commands-Reference) page.

### How do I add a project-specific slash command?

Drop a markdown file in `<project>/.opencode/commands/<name>.md` with this frontmatter:

```markdown
---
description: One-line description
---

# Command Name

Body of the command — the prompt the model sees.
```

Restart opencode. The command is now scoped to that project.

### How do I add a global slash command for all my projects?

Drop a markdown file in `~/.config/opencode/commands/<name>.md` (same format). It's available in every opencode session.

### What's the difference between /plan and /visual-plan?

- `/plan new|add|comment|status` — operate on a plan canvas. Creates elements, comments, status.
- `/visual-plan on|off` — toggle the agent's behavior. When **on**, the agent will create a plan and wait for feedback on complex tasks. When **off**, the agent works without surfacing intermediate plans.

These are independent. You can use `/plan` directly without `/visual-plan` being on.

## Tailscale / MagicDNS

### What is `/tailscale-serve`?

A slash command that authenticates and configures Tailscale Serve to expose a local port on your tailnet. Surfaces the admin-enable URL when Serve is not yet enabled. See [Commands Reference → /tailscale-serve](Commands-Reference#tailscale-serve--magicdns-hosting).

### Why doesn't the command fall back to plain HTTP if Serve isn't enabled?

You asked for authentication, not a workaround. The HTTP fallback (binding to the Tailscale IP) is available in the demo project's `npm run host:start` script, but the command itself stops at the admin-enable URL so the user can make an informed choice about HTTPS vs HTTP.

### How do I enable Tailscale Serve on my tailnet?

Visit the URL the command prints, or go to https://login.tailscale.com/f/serve?node=<your-node-id> from any tailnet device. Confirm the enable once and it applies to the whole tailnet.

## Memory Service

### Where is my project memory stored?

Depends on the mode:

- **Local-only (default):** a per-project Obsidian vault at `<project>/.obsidian/`. Notes live as Markdown files; the path is relative to the project root, so the vault travels with the repo if you commit `.obsidian/`.
- **Managed:** one shared user repo at `~/.local/share/bizar/memory/<repoName>/`. Each project's notes live under `projects/<projectId>/`, cross-project patterns under `global/bizar/`, and personal scratch under `users/<userId>/`.

Run `bizar memory status` to see the current mode and link target.

### How does Memory Service compare to Hindsight?

Hindsight was an external MCP service (now disabled by default). It held notes in a hosted database, required an API key, and called out to `https://memory-api.polderlabs.io` on every read/write. The Memory Service is local-first: notes are files on disk, sync is `git`, and there is no network call between you and your memory. The trade-off is that semantic retrieval (LightRAG-derived) ships as a Phase 2 deliverable — until then, retrieval is grep and full-text search over Markdown.

### Can I share memory across projects?

Yes. Opt into managed mode at `bizar init` time, or run `bizar memory link ~/.local/share/bizar/memory/<repoName>/` on any existing project. Managed mode binds the project to a single shared Git repo with three namespaces — `projects/<id>/`, `global/bizar/`, `users/<id>/` — so cross-project patterns (e.g., "always run plan-then-forseti for Tier 4 work") can live in `global/bizar/` and be reused without copy-paste.

To switch back to local-only, run `bizar memory unlink`. The vault stays on disk; only the link is removed.

### Where do secrets get scanned?

Every note passing through `bizar memory sync` (or `commit`) is scanned against 12 secret patterns defined in `bizar-dash/src/server/memory-secrets.mjs`. HIGH-severity matches (PEM private keys, AWS access keys, GitHub PATs, Stripe live keys, bearer tokens) **block the commit** — the sync aborts and prints the offending file and line. MEDIUM-severity matches (test API keys, absolute paths, private IPv4 addresses) **warn but allow** — the commit proceeds, but the warning is printed so you can clean it up before push.

To scan a note on demand without committing, run `bizar memory scan-secrets <path>` (CLI) or `POST /api/memory/secrets/scan` with the note body (dashboard).

## Next steps

Next: [Changelog](Changelog) — version history and release notes.
