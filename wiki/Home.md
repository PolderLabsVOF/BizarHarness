# BizarHarness

**Norse-pantheon multi-agent system for [opencode](https://opencode.ai).**

BizarHarness gives opencode a router, an agent hierarchy, and a cost-aware dispatch layer. Twelve named agents — Odin, Frigg, Vör, Quick, Mimir, Heimdall, Hermod, Thor, Baldr, Tyr, Vidarr, Forseti — work in parallel across four model tiers, with a free DeepSeek tier for cheap work and a GPT-5.5 escape hatch for the hardest problems. The whole system runs locally; nothing is sent to a BizarHarness server.

## What it is, who it's for

BizarHarness is for developers who already use opencode and want to stop hand-picking models for every prompt. Instead of staring at the model selector before each turn, you describe what you want, and Odin (the router agent) decomposes the request, picks the right agents, runs them in parallel, and synthesizes the result. Implementation work is always split across a moderate-cost agent (Thor on M2.7) and a high-cost agent (Tyr on M3) so you don't pay for a flagship model when a mid-tier one would do.

It's especially useful if you:

- Juggle multiple projects and want each one to have its own memory bank.
- Want the cheapest capable agent for the job without thinking about cost.
- Use opencode's plugin/hook system and need a guard against subagent loops.
- Like the idea of agents that learn from their mistakes over time.

## Key features

- **Twelve agents, four cost tiers** — Free DeepSeek Flash for read-only Q&A and mechanical work, M2.7 for moderate implementation, M3 for complex architecture, GPT-5.5 as a last-resort escape hatch.
- **Odin router** — never executes work itself. Always decomposes a request into parallel subagent calls (2+ in a single message) and synthesizes the results.
- **Cost-aware dispatch** — the default path is always the cheapest capable agent. You only pay for high-tier models when the task actually requires them.
- **Bizar plugin** — bundled opencode plugin that detects subagent loops, reports per-session activity, and injects handoff messages so a stuck subagent can be reassigned. Logs are metadata-only; the plugin never calls external APIs.
- **Per-project Hindsight memory** — every project gets its own memory bank. The default bank is reserved for general system knowledge only.
- **Semble code search** — Mimir uses Semble for codebase exploration before falling back to grep, so research agents get semantically-ranked results.
- **Skill discovery** — agents proactively install Skills CLI packs by domain (e.g., `skills add supabase/agent-skills --all -y` for database work) at task time. No manual configuration.
- **Visual plan tool** — `bizarharness plan new` creates a local MDX plan with a browser-based viewer/editor. Comments persist in a sidecar JSON file. All local, no network.
- **Self-improvement log** — every task appends a lesson to `.bizar/AGENTS_SELF_IMPROVEMENT.md`. The next session reads it before routing.
- **Dev sandbox** — a Docker-based sibling repo lets you test changes to the harness and its plugin without touching your real `~/.config/opencode/`.

## Quick install

```bash
# Try it without installing
npx bizarharness

# Or install globally
npm install -g @polderlabs/bizarharness
bizarharness
```

The interactive installer walks you through component selection, agent choice, install mode, optional skill packs, and API key setup. On exit it offers to restart opencode.

## Next steps

Next: [Getting Started](Getting-Started) — prerequisites, full install flow, and your first project.

> The wiki is the long-form reference. The repository's `README.md` is the canonical entry point and is updated on every release. If something here disagrees with the README, trust the README.
