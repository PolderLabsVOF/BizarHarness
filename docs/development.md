# Development workflow

This document covers how to make a change to Bizar — from local checkout
to a published npm release. The branching model is described in
[`docs/branches.md`](branches.md); the version rules are in
[`docs/versioning.md`](versioning.md). This document focuses on the local
+ GitHub actions a single change goes through.

## Local setup

```sh
git clone git@github.com:PolderLabsVOF/BizarHarness.git
cd BizarHarness
make setup          # installs Claude Code CLI + npm deps
```

The installer provisions the Bizar harness into `~/.claude/`. Subsequent
work happens on the local checkout, not on the provisioned copy.

## Day-to-day

```sh
# Run the SDK test watcher (fast feedback on packages/sdk changes)
make dev

# Run all gates (CI equivalent, no publish)
make verify-removed-surfaces verify-repo-structure check-arch \
     clean-check check test

# Run e2e (slower — touches real Claude Code / SDK)
make e2e
```

The Makefile is the single source of truth for command entry points. Each
target is idempotent and exits 0 on success.

## Branching off `dev` for a feature

```sh
git checkout dev
git pull origin dev
git checkout -b feat/short-description

# ...work, with conventional commits ...
git commit -m "feat(skills): add new bizplan tier handling"
git push origin feat/short-description
gh pr create --base dev --head feat/short-description
```

PRs are validated by `.github/workflows/pr-branch-check.yml` (target branch
flow), `.github/workflows/ci.yml` (full gate), and code review. Once merged
to `dev`, the next nightly at 02:00 UTC will publish your change to the
`@dev` dist-tag.

## Promotion

Promotion is manual and happens via PR:

```
feat/*  →  dev  →  beta  →  master
```

- **`dev → beta`**: open a PR from `dev` into `beta`. Each merged commit on
  `beta` triggers `release-beta.yml`, which auto-increments the `beta.N`
  counter. The first beta for a given base is `X.Y.Z-beta.1`.
- **`beta → master`**: open a PR from `beta` into `master`. The merged
  commit is expected to be `chore(release): X.Y.Z` (this is the
  operator's signal that the version has been locked). If the most recent
  commit on `beta` is already a release commit, the workflow uses that
  version directly.

## Cutting a manual dev build

Manual builds are useful for testers who need a fresh build between nightly
runs. Use `workflow_dispatch` on `nightly-dev.yml`:

1. Open the Actions tab on GitHub.
2. Select "Release — dev / nightly" → "Run workflow".
3. Set:
   - `variant`: `manual` (counter-based, e.g. `10.28.0-dev.manual.3`) —
     or `auto` (date-stamped, same as nightly).
   - `base`: optional override (e.g. `10.28.0`); leave empty to use the
     default base from the current `dev` HEAD.
   - `dry_run`: `true` to build without publishing (sanity check).
4. Run. The workflow commits the version bump to `dev` (manual variant
   only), publishes to the `@dev` dist-tag, and creates a GitHub prerelease.

## Cutting a manual stable release

Stable releases are typically driven by a `chore(release):` commit merged
into `master`. To cut one without waiting for the next push:

1. Bump the version locally:
   ```sh
   git checkout master
   git pull origin master
   npm run release:bump -- --mode stable --write
   git add package.json packages/sdk/package.json packages/sdk/src/version.ts
   git commit -m "chore(release): 10.28.0 — <release notes summary>"
   git push origin master
   ```
2. The push triggers `release-stable.yml`, which publishes to `@latest`.

If you need to re-publish an existing tag (e.g. CI failed and you want to
retry without bumping the version), use `release-stable.yml` →
`workflow_dispatch` with the explicit `version` input.

## Trusted publishing setup (one-time, operator-side)

See [`docs/trusted-publishing.md`](trusted-publishing.md) for the npm-side
configuration that the release workflows depend on.

## Local CI reproduction

```sh
# Run the same gate sequence that .github/workflows/ci.yml runs
make verify-removed-surfaces verify-repo-structure check-arch \
     clean-check check test
```

This is the local equivalent of CI — same exit codes, same Makefile
targets. If it passes locally it should pass in CI (modulo platform
differences like `ubuntu-latest` vs your local OS).

## Common pitfalls

- **Drift between `version.ts` and `package.json` files.** The bump script
  warns when it detects drift. Always run `npm run release:bump -- --mode
  <x> --write` to keep them in sync; never edit one without the others.
- **Publishing to the wrong dist-tag.** The release workflows take their
  `--tag` from the branch: `master` → `latest`, `beta` → `beta`, `dev` →
  `dev`. If you need to publish a stable version as a prerelease (rare,
  for hotfix-betas), use the workflow's `version` input to override.
- **Force-pushing tags.** Don't. The release workflows are idempotent on
  tag creation (they `git push` the tag once; a subsequent run is a no-op
  for that version). If you must move a tag, delete the old one first with
  `git push origin :refs/tags/vX.Y.Z` — and tell the team.
