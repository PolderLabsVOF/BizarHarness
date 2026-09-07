---
name: deep-interview
description: Multi-round Socratic pre-build clarification that crystallizes a broad / ambiguous request into a durable spec artifact at docs/specs/deep-interview-<slug>.md. Use when a request is missing acceptance criteria, hides assumptions, or jumps to a solution before the problem is defined. Adopted from OMX (`$deep-interview`) per docs/plans/2026-09-03-omx-features.md §1.
argument-hint: "[--quick|--standard|--deep] <broad or ambiguous request>"
---

> **Bizar compatibility:** This procedure is fully integrated into Bizar. Bizar system, repository, model-routing, autonomy, and approval policy control whenever they differ. Do not add a separate mandatory approval gate, recurse into dispatch, or override the active Bizar plan. Deep-interview is **not** a workflow run (no `bizar workflow`/`bizar goal` ledger — those CLIs are retired), it does **not** auto-commit, push, publish, release, deploy, change credentials, or destroy state, and it does **not** launch a daemon, tmux controller, or general memory / note-vault subsystem. The skill follows `using-superpowers` precedent: every cross-reference below is an instruction to consult the named skill, not to recurse into it.


# Deep Interview

Deep-interview is the pre-build clarification skill. It replaces vague improvisation with a bounded Socratic loop that drives the operator's request from **intent** to **crystallized spec**, then exits. It is the structured generalization of `@janet`'s single-question policy: when Stage 1–3 coverage is genuinely needed, deep-interview is the right surface; for a single targeted unblock, route to `@janet` instead.

## When to use

Use this skill when ANY of the following are true and the operator has not already supplied a crisp brief:

- The request is broad or vague ("make it fast", "add a dashboard", "fix the bug").
- Acceptance criteria are missing or implicit.
- The request rests on an unstated assumption that might be the actual problem.
- Multiple valid interpretations would change the design.
- The proposed solution appeared before the problem was defined.

Do **not** use this skill when:

- The request is already crisp — proceed to `/bizplan` or `/autopilot` directly.
- A single targeted unblock suffices — `/janet` (one-question policy) is faster.
- The work is greenfield design ideation with no brief to crystallize — `brainstorming` is the right surface.

## Operator-facing split

| Surface | When to use | Output | State |
|---|---|---|---|
| `/deep-interview` | Request is broad / ambiguous / missing acceptance criteria. Operator wants to crispen the brief before planning. | `docs/specs/deep-interview-<slug>.md` (spec artifact + ambiguity history) | Socratic loop with stage priority + depth profile cap |
| `/bizplan` (Phase 5) | Multiple reviewers need to converge (architect + critic). Plan is consumed by `/autopilot` or `/team`. | PRD + test-spec + handoff JSON (`bizplan_consensus_gate.complete` gated) | Planner → Architect → Critic with 5-iteration cap |
| `/autopilot` | End-to-end execution when intent is settled and consensus is not required. | Implementation + verification + completion evidence | Durable phased run |
| `/janet` | One targeted clarifying question to unblock ambiguous work. | Single recommendation or 2–4 option question | Stateless |

A natural operator ladder is `/deep-interview` → `/bizplan` → `/autopilot`; when intent is already crisp, skip straight to `/bizplan` (or `/bizplan-light` for a single-reviewer lane) or `/autopilot`.

## Stage 1–3 coverage

A crystallized brief must cover three stages in order; never skip a stage:

### Stage 1 — Intent and outcome (must resolve first)

- **Intent** — what the operator is actually trying to accomplish (the verb and the object).
- **Outcome** — the observable, user-visible result that proves the work is done.
- **Scope** — what is in and what is out (explicit non-goals).
- **Decision boundaries** — which decisions are operator-bound vs. agent-bound; surface the seven HITL categories from `AGENTS.md` when they apply.

Reject early closure if Stage 1 is missing or asserted without evidence.

### Stage 2 — Constraints and tradeoffs (must resolve before paths)

- Constraints: time, budget, tech-stack, compatibility, security, compliance, public exposure.
- Tradeoffs: pick the binding one explicitly (latency vs. cost, simplicity vs. extensibility, build vs. buy).
- For external APIs, frameworks, CLI behaviour, configuration formats, or version-sensitive dependencies: WebSearch current official documentation and WebFetch the exact relevant page before locking the constraint.

### Stage 3 — Spec crystallization (final synthesis)

- Re-statement of intent in one sentence.
- Ordered acceptance criteria (testable; each criterion independently verifiable).
- Non-goals list.
- Decision boundaries (operator-bound vs. agent-bound).
- Open questions deferred to the next surface (bizplan / autopilot).

Stages execute in priority order. Stage 2 does not begin until Stage 1 is closed; Stage 3 does not begin until Stage 2 is closed.

## Pressure ladder

Each round selects one category and applies it to the operator's last answer. Categories map from `thinking-socratic` vocabulary but are embedded inline here so the skill never silently recurses:

1. **Concrete example** — ask for the smallest concrete instance ("What does success look like on day one? Can you walk through what the user does?").
2. **Hidden assumption** — surface the unstated premise ("What does this assume about the operator's environment / workflow / data?").
3. **Boundary / tradeoff** — name the binding constraint and force the pick ("Latency or cost — which one is the hard requirement here?").
4. **Fuzzy-term challenge** — make the operator define any ambiguous noun precisely ("When you say 'fast', what does the SLO look like? P50 / P99 / deadline?").
5. **Edge-case scenario** — push on the corner case ("What happens when the network drops mid-write? When the user pastes 10MB? When the input is malformed UTF-8?").
6. **Symptom reframing** — restate the symptom and ask if the requested solution is actually the diagnosis ("You've described the solution. What is the underlying symptom, and would a different solution address it better?").

Rotate categories across rounds rather than repeating the same one; record which category each round used.

## Depth profiles

The operator selects one profile via flag; the default is `--standard`:

| Profile | Max rounds | Closure | When |
|---|---|---|---|
| `--quick` | 5 | `AmbiguityScore ≤ 0.10` AND operator confirms closure | Small request or quick sanity pass |
| `--standard` (default) | 12 | `AmbiguityScore ≤ 0.10` AND operator confirms closure | Typical pre-build brief crystallization |
| `--deep` | 20 | `AmbiguityScore ≤ 0.10` AND operator confirms closure | Cross-team / public-API / compliance work |

The round cap is a hard ceiling, not a target. Stop as soon as closure is reached.

### Closure

Closure requires both gates:

1. **Mathematical** — the most recent `ClarityBreakdown` plus per-dimension weights yields `AmbiguityScore ≤ 0.10`.
2. **Operator confirmation** — the operator answers "yes, crystallize" to the closure prompt.

Closure at score > 0.10 is forbidden. The brief is not crystallized.

### Dialectic rhythm guard

The skill MUST NOT run two Socratic pressure rounds back-to-back without an operator confirmation between them. After any pressure round (categories 2–6), the next operator-supplied answer must include explicit acknowledgment ("yes", "correct", "lock that") before the skill may issue the next pressure round. Between rounds the skill may request concrete examples (category 1) or surface an `AmbiguityScore` update.

The guard prevents the skill from bullying the operator into premature closure; it also makes the artifact auditable.

## Terminology ledger

Maintain a `TerminologyLedger` inside the spec artifact. For every term the operator introduces or redefines:

- The term as the operator used it (verbatim).
- The canonical name the skill adopts after re-statement.
- The round number and category where it was adopted.
- A one-sentence definition in the operator's own phrasing.

The ledger is bidirectional: later rounds must use the canonical name; if the operator reverts, the ledger records the divergence. The ledger is what `bizar spec show <slug>` exposes for downstream surfaces.

## Output

The skill writes a durable spec artifact per `docs/decisions/DEC-022-omx-canonical-artifact-location.md`:

```
docs/specs/deep-interview-<slug>.md
```

The artifact MUST contain (in this order):

1. **Header** — slug, target surface, depth profile, closure timestamp.
2. **Intent** — one-sentence re-statement.
3. **Outcome** — observable user-visible result.
4. **Scope** — in-scope bullets.
5. **Non-goals** — explicit exclusions.
6. **Decision boundaries** — operator-bound vs. agent-bound.
7. **Acceptance criteria** — ordered, testable, each independently verifiable.
8. **Constraints** — time, budget, tech-stack, compatibility, security.
9. **Open questions** — deferred to next surface.
10. **Pressure ladder transcript** — round number × category × question × operator answer × ledger deltas.
11. **Ambiguity breakdown** — final `ClarityBreakdown` per `packages/sdk/src/ambiguity/score.ts`.
12. **Terminology ledger** — term × canonical × round × category × definition.

The artifact is written atomically (precedent: `cli/commands/spec-list.mjs` and OpenKan's own atomic-write helpers); partial writes MUST never appear on disk. A second invocation with the same slug MUST read existing state and continue the transcript without destructive overwrite.

## Cross-references

- `bizar` — top-level harness contract (autonomy, approval boundaries, change policy) governs this skill.
- `brainstorming` — greenfield design conversation. Use before `/deep-interview` when the operator has no brief at all; use `/deep-interview` once any concrete brief exists.
- `bizplan` (Phase 5, strengthened) — consensus-planning surface. `/deep-interview` output is the input to `/bizplan`, not its replacement.
- `autopilot` — end-to-end execution. Consumes the crystallized spec; never starts from a vague brief.
- `thinking-socratic` — vocabulary source for the pressure-ladder categories. Embedded inline here so the skill never recurses.

Never call `bizar workflow start` (the CLI is retired) from inside this skill; deep-interview is not a workflow run and does not own a `~/.config/bizar/workflow/<session>/` ledger entry. If a durable plan must be created, route through OpenKan: `ok plan add <title>` plus `ok task add` per interview gate.

## Hard constraints

- MUST NOT auto-commit, push, publish, release, deploy, change credentials, or perform destructive cleanup.
- MUST NOT launch a daemon, tmux controller, or persistent background process.
- MUST NOT write outside `docs/specs/<slug>.md` for the brief itself (supporting notes may live next to it under `docs/specs/`).
- MUST NOT crystallize at `AmbiguityScore > 0.10`.
- MUST NOT run two pressure rounds without operator confirmation (Dialectic Rhythm Guard).
- MUST NOT exceed the depth profile round cap.
- MUST use atomic temp-file rename for the spec artifact (no partial writes).
- For external APIs, frameworks, CLI behaviour, configuration formats, or version-sensitive dependencies, MUST WebSearch current official documentation and WebFetch the exact relevant page before asking about them.
