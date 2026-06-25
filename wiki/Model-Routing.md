# Model Routing

BizarHarness routes every task to the cheapest model that can do it. The dispatch is determined by the agent definition (which model the agent uses) and the routing table in `config/AGENTS.md` (which agent handles which task type). This page describes the model tiers, the cost-aware dispatch rules, and how to override the model per task.

## The 5-tier model architecture

BizarHarness uses a five-tier model hierarchy. Every agent maps to exactly one tier, and the system always prefers the lowest tier that can do the job.

| Tier | Cost label | Model | Used by | When to use |
|---|---|---|---|---|
| **0 (free)** | Free | DeepSeek V4 Flash (OpenCode Zen) | Frigg, Vör, Quick, Mimir, Heimdall | Read-only Q&A, mechanical edits, codebase search |
| **1 (low)** | $ | MiniMax M2.7 | Hermod, Thor, Baldr | Moderate implementation, git ops, design plans |
| **2 (mid)** | $$ | MiniMax M3 | Odin, Tyr | Complex implementation, architecture, deep debugging |
| **3 (auditor)** | $$ | MiniMax M3 (edit-deny) | Forseti | Adversarial plan review |
| **4 (last)** | $$$$ | GPT-5.5 (OpenAI subscription) | Vidarr | Last-resort fallback when all else fails |

The escalation path is `Free → $ → $$ → $$$$`. The default for any non-trivial request is Tier 1 (Thor on M2.7) because it's the cheapest model with the implementation skill to handle moderate work. Tier 2 (Tyr on M3) is reserved for genuinely complex work. Tier 4 (Vidarr on GPT-5.5) is never the default; it's the escape hatch.

## Cost-aware dispatch

Odin follows three rules when routing:

1. **Default to the cheapest capable agent.** A bug fix goes to Thor, not Tyr. A rename goes to Heimdall, not Thor. A clarification goes to Vör, not Odin.
2. **Escalate only when justified.** A "plan the architecture" request goes to Tyr because the work is large. A "trace the source of the memory leak" request goes to Tyr because the debugging requires M3's reasoning depth. A "postmortem of failed attempts" goes to Vidarr because M2.7 and M3 have both failed.
3. **Always parallel for multi-stream work.** A request that splits into research + implementation runs Mimir (free) and Thor ($) in parallel, not sequentially. The wall-clock cost is the slowest stream, not the sum.

The cost escalation for a typical request:

```
"add a /healthz endpoint"
   → Heimdall (free) if it's truly trivial
   → Thor ($)  if it spans a few files
   → Tyr ($$)  if it requires design decisions
   → Vidarr ($$$$)  only if Thor and Tyr both failed
```

## Per-agent model configuration

The model for each agent is set in its Markdown frontmatter. The full list:

| Agent | Model string in frontmatter |
|---|---|
| Odin | `minimax/MiniMax-M3` |
| Frigg | `opencode/deepseek-v4-flash-free` |
| Vör | `opencode/deepseek-v4-flash-free` |
| Quick | `opencode/deepseek-v4-flash-free` |
| Mimir | `opencode/deepseek-v4-flash-free` |
| Heimdall | `opencode/deepseek-v4-flash-free` |
| Hermod | `minimax/MiniMax-M2.7` |
| Thor | `minimax/MiniMax-M2.7` |
| Baldr | `minimax/MiniMax-M2.7` |
| Tyr | `minimax/MiniMax-M3` |
| Vidarr | `openai/gpt-5.5` |
| Forseti | `minimax/MiniMax-M3` |

The format is `<provider>/<model>` (e.g., `minimax/MiniMax-M3`). This is the opencode model identifier. To change an agent's model, edit its `.md` file in `config/agents/` and re-run the installer.

## Override model per task

To run a single task with a different model, pass `--model` to the subagent dispatch (the `task` tool) when invoking it from Odin. The syntax is opencode-native:

```
@odin:task --model minimax/MiniMax-M3 research the auth module
```

In practice, most users don't override — Odin's routing is already cost-aware. The override is for the case where you know the work needs a specific model.

For direct agent invocations, the model is fixed by the agent's frontmatter. If you want a different model for a one-off task, route through Odin with the override.

## Adding custom models

To add a new model (e.g., for a different provider), three steps:

1. **Connect the provider in opencode.** Run `/connect` in the TUI and add the provider. Verify with `/models`.

2. **Add a model entry in the agent's frontmatter.** Edit the target agent's `.md` file:

   ```yaml
   ---
   name: my-agent
   model: my-provider/my-model
   ---
   ```

3. **Update `config/AGENTS.md` if the model is in a new tier.** The routing table documents which agents use which models. Keep it in sync with the agent files.

Models are matched by the `<provider>/<model>` string. If the string doesn't match a connected provider, opencode returns an error at dispatch time. Use `/models` in the TUI to confirm the model is available before assigning it.

## Disable a model tier

To disable a tier entirely, remove the agent definitions that use it. For example, to disable the GPT-5.5 tier:

1. Delete or move `config/agents/vidarr.md` out of the agents directory.
2. Re-run `./install.sh` or `bizar`.
3. Restart opencode.

Odin will skip Vidarr in its routing table. The escape hatch is gone — Tier 4 work will simply fail rather than escalate to GPT-5.5.

To temporarily disable Vidarr without removing the file, set its `model:` to a less expensive model in its frontmatter (e.g., `minimax/MiniMax-M3`).

## Next steps

Next: [Bizar Plugin](Bizar-Plugin) — the bundled opencode plugin that detects subagent loops, reports per-session activity, and injects handoff messages.
