---
description: Coordinate a Claude Code agent team with disjoint ownership, explicit gates, and leader verification.
allowed-tools: Read, Bash, Agent, SendMessage
---

# Team — Coordinated Claude Code Agents

`/team` is Bizar's standard substantive-work mode. Use it after bounded
orientation whenever the task is not an explicit `/quick` direct request or an
unmistakably tiny edit. Use an explicit single-agent or workflow route only
when the user asks for it or a durable workflow must be resumed.

Agent teams are experimental. They require `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, which Bizar installs by default. Current Claude Code versions create and clean up teams automatically; do not call obsolete `TeamCreate` or `TeamDelete` tools.

## Protocol

1. Read repository instructions, `PROGRESS.md`, and `feature_list.json` when present.
2. Define the target result, constraints, validation evidence, and stop condition.
3. Decompose into disjoint file/responsibility scopes. Assign shared root files to one owner only.
4. Create and claim durable `bizar task` records for editing lanes. Code-writing
   agents run with `isolation: worktree`; their claimed path scopes remain
   authoritative even though the checkouts are physically separate.
5. Launch bounded agents through Claude Code's Agent tool. Every prompt names ownership, deliverable, validation, and the rule not to revert sibling work.
6. Submit verified task commits to `bizar task integrate enqueue`. The designated
   integrator serializes application of completed work and records pass/failure.
7. The leader runs the final repository gates and owns the completion claim.
8. Use `SendMessage` for coordination; stop or reassign stalled work rather than duplicating edits.
9. Treat `TaskCreated`, `TaskCompleted`, and `TeammateIdle` hooks as advisory evidence only. They never block or force retries. A teammate that fails or idles twice is escalated to the lead, not restarted through model aliases.

## Human approval gates

Team agents may inspect, edit, build, and test locally without approval. They must not push, publish, deploy, merge, alter credentials/access, or perform destructive operations unless the user explicitly approved that exact action. A git specialist may prepare commits or PR text, but external publication remains gated.

## Checklist

- [ ] The team has a concrete research, implementation, and review/integration purpose.
- [ ] File scopes are disjoint.
- [ ] Every editing lane has a claimed task/worktree and path scope.
- [ ] Lockfiles and root configuration have one owner.
- [ ] Each agent has an explicit exit condition and proving test.
- [ ] A reviewer/verifier is separate from the main implementation owner.
- [ ] The leader will run repository-wide required gates after integration.
