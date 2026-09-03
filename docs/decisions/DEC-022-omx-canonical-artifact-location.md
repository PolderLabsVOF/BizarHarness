# Decision — DEC-022 — OMX canonical artifact location

- **Date:** 2026-09-03
- **Status:** Accepted
- **Resolves:** Plan §8 Open Q2 (`docs/plans/2026-09-03-omx-features.md` sections 8)
- **Author:** `@mike` (coordinator confirmation in primary session)

## Decision

All durable OMX-derived artifacts land under `docs/specs/` with one canonical
file pattern per feature:

| Feature | Path pattern |
|---|---|
| Deep-interview | `docs/specs/deep-interview-<slug>.md` |
| Ambiguity score | embedded inside the deep-interview spec as `## Ambiguity breakdown`; standalone CLI table via `bizar ambiguity` does not write to `docs/specs/` |
| Ultragoal | `docs/specs/ultragoal-<id>.md` plus `<id>.jsonl` ledger at `docs/specs/ultragoal/<id>.jsonl` |
| Ralplan | `docs/specs/ralplan-<slug>.md` with the typed handoff at `docs/specs/ralplan/<slug>.handoff.json` |

## Rationale

1. **Single canonical location.** `docs/specs/` is the single sink for any
   machine-emitted spec / plan / handoff. `docs/plans/` stays a human-authored
   long-form plan repository (per existing `docs/plans/<date>-<title>.md`
   convention); `docs/specs/` is the structured / machine-readable output.
2. **Existing precedent.** `docs/specs/` is referenced from `make check-arch`
   invariants (see plan §7: "grep invariants in `make check-arch` enforce
   'no new spec writes outside `docs/specs/`'"). The naming already exists in
   the repo and is checked.
3. **Distinct from `.harness/specs/` and `.omc/specs/`.** Both legacy paths
   remain visible for cross-reference but no new writes are accepted there.
   `make check-arch` is the gate.
4. **Mirror-able.** A future OpenKan-side consumer can read `docs/specs/`
   without learning three different naming conventions.

## Concretely

- `make check-arch` adds a `scripts/check-arch.sh` rule that fails CI on any
  write outside `docs/specs/` for the four feature paths above.
- Plan §0.7's surface inventory is updated to reflect this decision in the
  Phase-1 commit and a follow-up inventory row in `docs/INDEX.md`.

## Reversibility

If a future operator finds `docs/specs/` unsuitable, the change is
file-move only (no schema migration) and is captured in a fresh
`docs/decisions/DEC-0NN-*.md` row.
