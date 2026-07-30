# Sprint Contract — Pre-Feature Negotiation

> Fill this out BEFORE starting a feature that needs explicit scope.
> Skip for trivial changes (single file, single tool).

## Identification

- **Feature ID:** F-NNN
- **Title:** <one-line>
- **Sprint date:** YYYY-MM-DD
- **Owner:** <agent name or "claude">

## Scope (in)

What's IN this sprint:

- <item 1>
- <item 2>

## Scope (out)

What's DELIBERATELY excluded:

- <item 1>

## Definition of Done (DoD)

The feature is `passing` only when ALL of:

- [ ] Layer 1: `make check` green (TypeScript 0 errors)
- [ ] Layer 2: `make test` green for touched module
- [ ] Layer 3: `make e2e` green if cross-component
- [ ] Documentation updated in same commit (no stale docs)
- [ ] `feature_list.json` updated with `evidence` field
- [ ] `PROGRESS.md` reflects new current state
- [ ] Commit message explains WHY (not just what)

## Architecture constraints

- [ ] No persistent web-service dependency in `packages/sdk/`
- [ ] No local HTTP dependency in SDK operations
- [ ] No `claude` daemon subprocess spawn unless explicitly opted in via `claude --bg`
- [ ] New architectural rule added to `.harness/arch-rules.json` (if applicable)

## Risk / unknowns

- <list anything that might derail the sprint>
