# Versioning rules

Bizar follows [Semantic Versioning](https://semver.org/) with the additions
that npm and GitHub prereleases require. The single source of truth for the
current version lives at `packages/sdk/src/version.ts` as the `SDK_VERSION`
constant; `package.json` and `packages/sdk/package.json` mirror it.

The helper `scripts/bump-version.mjs` computes the next version and
(optionally) writes it to all three files. The release workflows in
`.github/workflows/` call this helper.

## Per-branch rules

### `master` — stable

- Format: `MAJOR.MINOR.PATCH`
- Computed from [Conventional Commits](https://www.conventionalcommits.org/)
  between the last `chore(release):` tag and `HEAD`:
  - `BREAKING CHANGE:` footer or `<type>!:` → **major** bump
  - `feat:` → **minor** bump
  - any other type → **patch** bump
- The release commit itself (`chore(release): X.Y.Z — ...`) is the only
  commit that ever touches `package.json`/`packages/sdk/package.json`/
  `packages/sdk/src/version.ts` on `master`. CI publishes the version that
  the merged commit already wrote — the workflow never re-bumps on master.
- `workflow_dispatch` with an explicit `version` input lets operators
  re-publish an existing version without mutating the tree.

### `beta` — release candidate

- Format: `MAJOR.MINOR.PATCH-beta.N`
- Base version (`MAJOR.MINOR.PATCH`) is computed as either:
  - the explicit `--base X.Y.Z` argument (operator override), or
  - the next minor of the current stable release (default).
- Counter (`N`) is `max(existing -beta.N tags for that base) + 1` per push.
  The first beta after a stable release is `X.Y.Z-beta.1`, then `.2`, etc.
- Workflow auto-commits the bumped versions back to the branch so the next
  push computes a clean delta. The commit message is
  `chore(release): X.Y.Z-beta.N — beta prerelease`.

### `dev` — nightly / manual

- Format depends on the trigger:
  - **Scheduled (cron) + manual `variant: auto`**:
    `MAJOR.MINOR.PATCH-dev.nightly.YYYYMMDD.<short-sha>`
  - **Manual `variant: manual`**:
    `MAJOR.MINOR.PATCH-dev.manual.N`
- Base version follows the same rule as beta.
- **Auto/nightly runs do NOT commit a version bump.** Every nightly would
  otherwise pollute `dev`'s history with one-line commits. The published
  tarball carries the computed version via `npm publish` (which takes the
  version from `package.json` at publish time — the workflow overrides the
  version field inline if needed; this is currently implemented at the
  workflow level via `--tag dev` only, with version baked into the
  tarball name through the standard `npm pack` flow).
- **Manual runs DO commit a version bump**, since the operator may want a
  reproducible version reference checked in.

## Conventional commits

The release workflow uses conventional commits for `master`. Operators
should follow the convention when merging into `dev`:

| Prefix      | Bump   | When                                                       |
| ----------- | ------ | ---------------------------------------------------------- |
| `feat:`     | minor  | New user-facing feature                                    |
| `fix:`      | patch  | Bug fix                                                    |
| `perf:`     | patch  | Performance improvement                                    |
| `refactor:` | patch  | Internal refactor with no user-visible change              |
| `docs:`     | none   | Docs only — does not trigger a release                     |
| `test:`     | none   | Tests only — does not trigger a release                    |
| `chore:`    | none   | Tooling, deps, infra                                       |
| `feat!:`    | major  | Breaking change                                            |
| `BREAKING CHANGE:` (footer) | major | Breaking change in any commit                |

`feat`/`fix`/`perf`/`refactor` on `master` between the last release and the
next `chore(release):` commit drive the version bump.

## Local release runs (operator-only)

```sh
# Show what the next stable would be (no write):
npm run release:bump -- --mode stable

# Write the computed version in place:
npm run release:bump -- --mode beta --write
npm run release:bump -- --mode dev --variant manual --write

# Override the base for an out-of-cycle beta:
npm run release:bump -- --mode beta --base 10.28.0 --write
```

`npm run release:bump` is wired in `package.json` scripts:

```json
"release:bump": "node scripts/bump-version.mjs"
```

The CI release workflows always invoke the same script via Node — there is
no separate "CI version logic".
