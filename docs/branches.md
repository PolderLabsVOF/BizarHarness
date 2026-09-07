# Branching model

Bizar uses a three-tier release branch model. Every commit lands on exactly
one of the long-lived branches below, and every published npm release comes
from exactly one of them.

| Branch    | Purpose                                           | npm dist-tag | GitHub release | Workflow                       |
| --------- | ------------------------------------------------- | ------------ | -------------- | ------------------------------ |
| `master`  | Stable releases (`vX.Y.Z`)                        | `@latest`    | release (final) | `release-stable.yml`           |
| `beta`    | Release-candidate baking (`vX.Y.Z-beta.N`)        | `@beta`      | prerelease     | `release-beta.yml`             |
| `dev`     | Nightly builds + manual dev cuts (`vX.Y.Z-dev.*`) | `@dev`       | prerelease     | `nightly-dev.yml` (cron + manual) |

The historical `master` is treated as the `main` release branch — there is no
rename planned. Promotion flows upward:

```
feature/*  →  dev  →  beta  →  master
```

- **Feature branches** (`feat/*`, `fix/*`, `chore/*`, `docs/*`, etc.) open
  PRs against `dev`. Conventional commits drive the eventual release notes.
- **`dev`** accumulates features. Every night at 02:00 UTC the
  `nightly-dev.yml` workflow builds the current `dev` HEAD and publishes a
  prerelease tarball to the `@dev` npm dist-tag (`vX.Y.Z-dev.nightly.YYYYMMDD.<short-sha>`).
  Manual runs use `workflow_dispatch` with `variant: manual` to cut a
  counter-based version (`vX.Y.Z-dev.manual.N`) without a date stamp — for
  cases when a tester needs a fresh build between nightly runs.
- **`beta`** is a snapshot for baking. PRs from `dev` are merged here when
  the team wants to bake a release-candidate. Each push to `beta` triggers
  `release-beta.yml`, which auto-increments the `beta.N` counter and
  publishes to the `@beta` dist-tag.
- **`master`** is the GA surface. A `chore(release): X.Y.Z` commit is the
  signal that triggers `release-stable.yml` to publish to `@latest`. PRs
  from `beta` are merged into `master` once the release is GA-ready.

The promotion flow is enforced by `.github/workflows/pr-branch-check.yml`,
which rejects:

- PRs into `master` from anything other than `beta`
- PRs into `beta` from anything other than `dev`

PRs into `dev` accept any `feat|fix|chore|docs|refactor|perf|test/*` branch
name. Other prefixes work but trigger a notice.

## Operational notes

- **`master` is the GitHub default branch.** `git clone` of this repository
  checks out `master`. Operators can change this in the repository settings
  (Settings → Code and automation → Default branch) — but doing so without
  updating `ci.yml`'s `on.push.branches` and `on.pull_request.branches`
  filters will break CI.
- **Branch protection is operator-side.** The repository is on GitHub Free,
  which does not support branch-protection rules. Operators who want
  `master` protected should either upgrade to Pro or set up a mirror
  webhook. The CI workflow runs on every push regardless of branch
  protection — it is not a substitute for it.
- **Tag immutability.** Tags are pushed by the release workflows, not by
  hand. If a tag needs to be moved (rare — typically a force-republish),
  delete it with `git push origin :refs/tags/vX.Y.Z` and re-run the
  workflow with `workflow_dispatch`.
- **Promotion is manual.** Nothing automatically promotes `dev → beta →
  master`. The team merges PRs at each gate based on its own cadence.
