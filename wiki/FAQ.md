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

Yes. Without `HINDSIGHT_API_KEY`, agents operate in stateless mode. They won't recall past sessions, won't retain new memories, and won't have a per-project bank. Routing still works, the plugin still works, and `.bizar/AGENTS_SELF_IMPROVEMENT.md` still records lessons. The Hindsight MCP is an additive feature, not a core dependency.

### Can I use this without Anthropic?

Yes. BizarHarness does not use Anthropic models at all. The default stack is DeepSeek V4 Flash (free) + MiniMax M2.7 + MiniMax M3. Anthropic is not in any agent's model list and the dev sandbox explicitly strips Anthropic references.

### Can I add my own agents?

Yes. Drop a new `<name>.md` file in `config/agents/` (or in `~/.config/opencode/agents/` for a per-user install) and re-run the installer. The file should have YAML frontmatter (`name`, `model`) and a Markdown   body that includes:

- A `## Role` section describing what the agent does.
- A `## When to Use` section with example invocations.
- A `## Hindsight Memory Protocol` section (copy the canonical text from another agent's file).
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

The Bizar plugin is opencode-specific (it uses opencode's plugin API and hook surface). The agent definitions and the BizarHarness CLI can be adapted to other harnesses via `bizarharness export <target>`, but the bundled plugin only works in opencode.

### Does this work with local models (Ollama, LM Studio)?

In principle, yes. The agent files accept any `<provider>/<model>` string. Configure the local model in opencode's `/connect`, then edit the target agent's `.md` file to use it. The free tier (DeepSeek V4 Flash) is just one choice — local models can fill the same slot.

## Operations

### How do I update BizarHarness?

```bash
npm update -g bizarharness
# or
npm install -g bizarharness@latest
```

After the npm package updates, re-run the installer:

```bash
bizarharness
```

The installer is idempotent — it preserves your existing config and only copies new or changed files. If a config conflict arises, it backs up the existing file to `opencode.json.bak` first.

To update from source (for contributors):

```bash
cd BizarHarness
git pull
./install.sh
```

### How do I see what the agents are doing in real time?

The Bizar plugin logs every tool call to `~/.cache/bizarharness/logs/<sessionId>.log`. Tail the file in another terminal:

```bash
tail -f ~/.cache/bizarharness/logs/<sessionId>.log
```

The log is metadata only (timestamp, session ID, tool name, fingerprint hash, outcome, duration) — no tool args or session content.

### How do I clear Hindsight memory for a project?

To wipe a project's Hindsight bank:

1. Open opencode in the project.
2. Run `@frigg` and ask it to clear the bank. (Frigg has read-only access by default; you may need to ask Odin to route this to an agent with write access.)
3. Or, use the Hindsight dashboard at https://memory-api.polderlabs.io to manage banks manually.

The default bank should **not** be cleared — it holds general system knowledge shared across projects.

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

BizarHarness 1.2.1 is stable for daily use. The agent routing, the install flow, and the Bizar plugin are tested. The experimental features (background agents, visual plans) are clearly marked as such. Use them in dev, not in production-critical paths, until v2.0 ships.

### How is BizarHarness licensed?

MIT. See the [LICENSE](https://github.com/DrB0rk/BizarHarness/blob/main/LICENSE) file in the repo.

## Next steps

Next: [Changelog](Changelog) — version history and release notes.
