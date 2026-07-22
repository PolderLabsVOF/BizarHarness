---
name: skillopt
description: Microsoft's SkillOpt trains skill files via rollouts + reflection against a frozen target model. Install with `pip install skillopt` and produce a `best_skill.md`. Always human-review.
---

# SkillOpt Workflow

## Overview

SkillOpt (microsoft/SkillOpt, MIT-licensed) is a Microsoft Research Python tool that **optimizes skill files for a specific target model**. Given a starting `SKILL.md`, a target model (frozen), a benchmark of inputs, and a reward signal, SkillOpt runs a rollout → reflect → aggregate → select → update → evaluate loop and emits a `best_skill.md` artifact that scores higher against the held-out validation gate.

It is *not* a general prompt editor and *not* a free-form rewriting tool. It is a closed-loop optimizer: it changes the skill text, runs the agent under the new skill against the benchmark, measures reward, and keeps mutations that improve the score.

**Core Principle:** SkillOpt trains a skill file the way you'd fine-tune a model — with a held-out validation gate, a frozen target, and a reward signal — not by hand-tweaking prose. Don't commit the output without human review; treat `best_skill.md` as a candidate, not a verdict.

## When to Use

- A skill's quality is measurably degrading on a benchmark (success rate dropping, regression in eval)
- You have a benchmark of representative inputs and a reward signal (task success / rubric score / pass-rate)
- You want to A/B a new skill variant against the current one against the same target model
- A skill has grown organically past ~200 lines and you suspect prose bloat is hurting recall

Decision flow:

```
Skill quality question?
  → Do you have a benchmark + reward + frozen target model? → no → DON'T RUN SKILLOPT (you can't measure without them)
  → Is the skill underperforming on the gate? → no → no work to do
  → Yes to both → see the 6-phase loop below
```

## When NOT to Use

- **No benchmark, no reward, no frozen target.** SkillOpt needs all three. If any is missing, the loop has nothing to optimize against — you'll burn compute on something you can't evaluate. Compose the benchmark first or skip SkillOpt entirely.
- **For a one-off skill polish.** SkillOpt is a multi-rollout loop with token cost on the order of dozens to hundreds of completions. For "rewrite this paragraph to be clearer," edit the skill by hand. Reach for SkillOpt when you have evidence the skill underperforms and a way to measure the fix.
- **On a non-frozen target model.** If the target model is updating daily, the rollout scores are non-reproducible and the held-out gate stops meaning anything. Pin the model version and don't retrain against a moving target.
- **Without human review of `best_skill.md`.** SkillOpt optimizes the reward signal — that is not the same as "is this skill correct, well-bounded, and aligned with what we want the agent to do." A skill that scores higher on the rubric can still be narrower, more brittle, or subtly off-vibe. Always review before committing.

## The 6-Phase Loop

```
┌─ Phase 1: Rollout        ─ run the agent under the current skill against benchmark inputs
│
├─ Phase 2: Reflect        ─ for each rollout, capture which skill instructions helped vs hurt
│
├─ Phase 3: Aggregate      ─ across all rollouts, find recurring failure modes and structural patterns
│
├─ Phase 4: Select         ─ choose one mutation hypothesis (a concrete edit) to try next
│
├─ Phase 5: Update         ─ apply the mutation to produce a candidate skill
│
└─ Phase 6: Evaluate       ─ run the candidate against the HELD-OUT validation set; keep if it improves, drop if not
                              ↑                                                              │
                              └────────────── next iteration reuses the kept variant ─────────┘
```

### Phase 1 — Rollout

Run the agent under the **frozen target model** with the current skill against the benchmark. Capture outputs + per-input scores. Don't peek at the validation set during this phase.

### Phase 2 — Reflect

For each rollout, ask: which lines of the skill contributed to the success or failure? Mark helpful / neutral / harmful spans. This is the closest you get to a teacher signal without a human labeler.

### Phase 3 — Aggregate

Across all rollouts this iteration, find the recurring failure modes. If 4 of 5 failures on a particular input pattern come from the same missing instruction in the skill, that's the highest-leverage next mutation.

### Phase 4 — Select

Pick **one** mutation to try. SkillOpt is not a search-and-replace shotgun; it's one edit per round. Co-edits entangle effects and make the held-out gate stop carrying signal.

### Phase 5 — Update

Apply the mutation. Save the candidate as a sibling file (e.g. `candidate-3.md`); never overwrite `SKILL.md` mid-loop.

### Phase 6 — Evaluate

Run the candidate against the **held-out validation set** (never been seen during Phases 1–5). If it improves the held-out gate, promote it to the next iteration's starting point. If it regresses, drop it and try a different mutation. Do not cherry-pick from a known input; the held-out gate is what makes the loop trustworthy.

## How Bizar Agents Use It

```bash
# 1. Install (do this once per machine)
pip install skillopt

# 2. Set up a benchmark directory (you write this — SkillOpt doesn't generate it)
#    benchmark/
#    ├── inputs.jsonl       # one prompt per line, hold-out set included
#    ├── reward.py          # your scoring fn: takes (prompt, completion) → float
#    └── target_model.json  # the frozen target model spec (id + version pin)

# 3. Run the loop against a draft skill
python -m skillopt.cli optimize \
  --skill config/skills/thinking-some-skill/SKILL.md \
  --benchmark ./benchmark \
  --out ./skillopt-out

# 4. Inspect the output before committing anything
ls skillopt-out/
cat skillopt-out/best_skill.md
diff config/skills/thinking-some-skill/SKILL.md skillopt-out/best_skill.md

# 5. If the diff is genuinely better (held-out improvement + human review passes),
#    replace the source. Otherwise discard and tune the benchmark.
cp skillopt-out/best_skill.md config/skills/thinking-some-skill/SKILL.md
```

We do **not** vendor SkillOpt into the Bizar JS harness — the tool lives in Python (`pip install skillopt`), runs offline, and writes a markdown artifact. The Bizar loop is: write draft → run SkillOpt → human review `best_skill.md` → commit if better.

## Pitfalls

- **Don't retrain daily.** The target model is frozen for a reason; if your benchmark doesn't drift, the skill shouldn't either. Bumping SkillOpt runs on every PR turns the skill into a moving target the agent can't build a stable intuition against.
- **Don't bypass the held-out gate.** It's tempting to "peek" at validation items to bias the mutation — that converts the loop into a curve-fit on a small set and the held-out number stops meaning anything. Hold-out integrity is the whole point.
- **Never auto-commit `best_skill.md`.** It is a *candidate*. The reward signal optimizes task success; it does not optimize for tone, scope, or alignment with sibling skills in the same family. A/B test in shadow, then promote deliberately.
- **Don't use SkillOpt on skills you don't have a benchmark for.** If the input space and reward are unknown, you're optimizing prose against nothing and will learn something — just not something useful.
- **Don't optimize `thinking-*` skills together as one bundle.** They share front-matter shape but address different problem types; co-optimizing entangles their effects and makes individual improvements hard to attribute.

## Relationship to Bizar's Existing Skill Pipeline

| Concern | Owner |
|---|---|
| What skills ship | `config/skills/<name>/SKILL.md` (canonical, provisioned) |
| Provision to user | `cli/provision.mjs:syncConfigExtras` + `writeBizarSkillLock` |
| Skill discovery at runtime | `~/.claude/skills/<name>/SKILL.md` (provisioned mirror) |
| Offline quality loop | SkillOpt (this skill) — run on a draft, produce `best_skill.md`, human-promote |
| Editing prose by hand | You + your editor — fine for one-off tweaks, don't loop it |

SkillOpt is a **research-quality tool** for the rare case where you have the benchmark, the reward, and the time. For 90% of skill edits, just write it well.
