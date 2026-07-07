# Evaluator Rubric — Sprint Scoring

> Score every completed sprint against this rubric. Every dimension
> must reach **B or above** before the feature is marked `passing`.
> If any dimension is C or D, fill out the `evidence` field with
> what's missing and do NOT mark `passing`.

## Scoring matrix

| Dimension         | A (excellent)               | B (good)                   | C (needs work)             | D (fail)              |
| ----------------- | --------------------------- | -------------------------- | -------------------------- | --------------------- |
| **Correctness**   | All 3 layers green + edge cases | All 3 layers green       | Layers 1-2 green, L3 red   | Any layer red         |
| **Arch compliance** | Follows all arch-rules     | Follows non-trivial rules  | 1 trivial violation        | Multiple violations   |
| **Test coverage** | E2E + unit + integration    | E2E + unit                 | Unit only                   | No tests              |
| **Verification evidence** | Test output + commit hash + screenshot | Test output + commit hash | Test output only | Nothing |

## Scoring template

```markdown
## Sprint scoring — <feature ID>

| Dimension             | Score | Evidence                              |
| --------------------- | ----- | ------------------------------------- |
| Correctness           | A/B/C/D | <link to test output>                |
| Arch compliance       | A/B/C/D | <make check-arch output>             |
| Test coverage         | A/B/C/D | <make test output>                   |
| Verification evidence | A/B/C/D | <commit hash + test output>          |
```

## Threshold rules

- **All A:** Mark feature `passing` with full evidence. Excellent.
- **All B:** Mark feature `passing` with evidence. Good. Move to next.
- **Any C:** Mark feature `active` (not passing). Add C-dimension
  repair items to the sprint contract and address next sprint.
- **Any D:** Mark feature `active` AND file a bug. Do NOT proceed to
  next sprint until D is resolved.

## Examples

```markdown
## Sprint scoring — F-007

| Dimension             | Score | Evidence                                                  |
| --------------------- | ----- | --------------------------------------------------------- |
| Correctness           | A     | make check green, make e2e green, edge case (path="") ok   |
| Arch compliance       | A     | make check-arch: 0 violations                             |
| Test coverage         | A     | make test: 626/629 pass (3 pre-existing unrelated)        |
| Verification evidence | A     | commit 3511390 + /tmp/bh-full-e2e.mjs output              |
```
