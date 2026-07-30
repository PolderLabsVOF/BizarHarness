# DEC-014: Mandatory Bizar routing and documentation grounding

**Status:** Accepted  
**Date:** 2026-07-30

## Context

The prompt hook previously emitted optional worker suggestions only when a
pattern matched. A primary Claude Code session could therefore complete work
without using any Bizar agent. The shared agent baseline preferred official
documentation, but not every agent could call `WebSearch`, and no lifecycle hook
reasserted the rule when a subagent started.

This left two avoidable failure modes: bypassing the role pipeline and guessing
third-party behavior before consulting current documentation.

## Decision

1. Every non-empty `UserPromptSubmit` injects mandatory routing through the
   custom `mike` agent. Specialized worker suggestions are additive.
2. Mike routes trivial work to `brenda`; non-trivial work uses the configured
   phased agent pipeline.
3. Every `SubagentStart` injects the external-documentation contract before the
   agent's first prompt.
4. Every shipped agent includes `WebSearch` in its tool allowlist and references
   `AGENT_BASELINE.md`.
5. External APIs, libraries, frameworks, CLIs, configuration formats, and
   version-sensitive behavior require current official documentation before a
   proposal or implementation attempt. Trial-and-error is not a substitute.
6. Repository-local facts remain grounded in files, tests, Git history, and
   tool output; agents do not manufacture web citations for local evidence.
7. Architecture and E2E checks fail when routing, hook registration, baseline
   references, or WebSearch access drift.

## Consequences

- Every primary request pays one delegation hop, including trivial requests.
- External integration work spends additional time on authoritative retrieval
  but avoids repeated speculative attempts and stale API assumptions.
- Documentation grounding remains a prompt/tool contract, not proof that a
  remote page was reachable. Agents must report retrieval gaps explicitly.
- Directly selected Bizar agents follow their role without recursively
  dispatching themselves.
