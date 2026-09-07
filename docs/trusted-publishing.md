# npm Trusted Publishing setup (one-time, operator)

Bizar's release workflows use [npm Trusted
Publishing](https://docs.npmjs.com/generating-provenance-statements) (OIDC)
to publish without long-lived API tokens. This document walks through the
operator-side configuration on npmjs.com that the CI workflows depend on.

Trusted publishing has two halves:

1. **GitHub Actions side** — already configured by the workflow files in
   `.github/workflows/`. Each release workflow requests
   `permissions: id-token: write`, runs `actions/setup-node@v4` with
   `registry-url: https://registry.npmjs.org/`, and passes `--provenance`
   to `npm publish`. No further action needed here.
2. **npmjs.com side** — must be configured by the package owner. Steps
   below.

## Packages to configure

- `@polderlabs/bizar` (the root CLI package)
- `@polderlabs/bizar-sdk` (the SDK package)

Both are owned by the `@polderlabs` npm organization.

## Steps (per package)

For each of the two packages:

1. Sign in to https://npmjs.com/ as a member of the `@polderlabs` org.
2. Navigate to the package page (e.g. https://www.npmjs.com/package/@polderlabs/bizar).
3. Click **Settings** (you need maintainer or owner role).
4. Under **Publishing access**, find **Trusted publishers**.
5. Click **Add a trusted publisher** and choose **GitHub Actions**.
6. Fill in:
   - **Repository**: `PolderLabsVOF/BizarHarness`
   - **Workflow filename**: select one of:
     - `.github/workflows/release-stable.yml` (for `@latest`)
     - `.github/workflows/release-beta.yml`   (for `@beta`)
     - `.github/workflows/nightly-dev.yml`   (for `@dev`)
   - **Environment name** (optional but recommended): match the
     `environment:` block in the workflow:
     - `release-stable.yml` → `npm-latest`
     - `release-beta.yml`   → `npm-beta`
     - `nightly-dev.yml`    → `npm-dev`
     Leaving this empty means any push that triggers the named workflow can
     publish. Pinning to the environment adds an approval gate (configured
     under the repo's GitHub Environments).
7. Save.

Repeat for each of the three workflows × two packages = six entries.

## Verifying the setup

After configuring, trigger a `workflow_dispatch` run with `dry_run: true`
first:

```sh
gh workflow run release-stable.yml -f dry_run=true
gh workflow run release-beta.yml -f dry_run=true
gh workflow run nightly-dev.yml -f variant=manual -f dry_run=true
```

Then:

```sh
gh run watch   # watch the latest run
```

If trusted publishing is misconfigured, `npm publish` will fail with
`npm error code ENEEDAUTH` or `npm error 404 Not found` — both indicate
that the OIDC token exchange did not find a matching trusted publisher on
the package. Re-check the workflow filename field — it must match exactly
including the leading `.`.

Once `dry_run: true` works, run for real:

```sh
gh workflow run release-stable.yml -f version=10.27.1
```

## Provenance

The release workflows run `npm publish --provenance`. This requires npm 9+
on the publishing side (GitHub Actions Ubuntu runner has npm 10.x as of
writing). The resulting tarball carries an in-toto attestation linking it
to the GitHub Actions run that built it. View the attestation at
https://provenance.npmjs.com/ — paste the SHA from the npm registry page.

## Fallback (if trusted publishing can't be configured yet)

If the npm-side configuration is delayed, the workflows fall back to a
`NODE_AUTH_TOKEN` env var (supplied by `actions/setup-node`'s OIDC
exchange). This requires a maintainer to:

1. Generate a [Granular Access Token](https://docs.npmjs.com/access-tokens)
   on npmjs.com with publish scope for `@polderlabs/bizar` and
   `@polderlabs/bizar-sdk`.
2. Add it as a repository secret named `NPM_TOKEN` in GitHub
   (Settings → Secrets and variables → Actions).
3. Remove the `--provenance` flag from the publish commands temporarily
   (or accept that provenance will be missing until trusted publishing is
   configured).

This fallback is documented for completeness but is **not** the intended
long-term flow — trusted publishing removes the secret from the trust
boundary entirely.

## Auditing

After publishing, verify the provenance on the npm registry:

```sh
npm view @polderlabs/bizar@latest --json | jq '.dist'
# Look for the "attestations" object — its presence means provenance was generated.
```

Or visit the package page on npmjs.com; a green checkmark next to the
version indicates a valid attestation.
