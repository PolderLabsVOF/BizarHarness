/**
 * cli/__tests__/models-mirror-shipped.test.mjs
 *
 * Regression test for the v10.17.0 install-time bug:
 *   `bizar models` after `bizar install --force --yes` failed with
 *   `ERR_MODULE_NOT_FOUND` because `cli/commands/models.mjs` imported
 *   the failover mirror from `packages/sdk/src/`, which is not part of
 *   the published tarball.
 *
 * The fix:
 *   - `scripts/build-sdk.mjs` copies
 *     `packages/sdk/src/router/failover-mirror.mjs` into
 *     `packages/sdk/dist/router/failover-mirror.mjs` before tsc runs.
 *   - `cli/commands/models.mjs` imports from the `dist/` path so the
 *     import resolves in both the repo and the installed tarball.
 *
 * This test pins the three pieces that broke together so they cannot
 * drift apart again:
 *   1. The mirror file exists at the dist path after a build.
 *   2. `cli/commands/models.mjs` does NOT import from `packages/sdk/src/`.
 *   3. Dynamic-importing `cli/commands/models.mjs` from this directory
 *      succeeds without `ERR_MODULE_NOT_FOUND`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

const DIST_MIRROR = resolve(
  REPO_ROOT,
  'packages',
  'sdk',
  'dist',
  'router',
  'failover-mirror.mjs',
);
const CLI_MODELS = resolve(REPO_ROOT, 'cli', 'commands', 'models.mjs');
const PROJECT_ROUTER = resolve(REPO_ROOT, 'config', 'claude', 'model-router.json');

test('the project ships no runtime model router; installer factory stays model-neutral', async () => {
  assert.equal(existsSync(PROJECT_ROUTER), false, 'a repository must never be a model-policy source');
  const { EMPTY_GLOBAL_MODEL_ROUTER } = await import('../provision.mjs');
  const router = EMPTY_GLOBAL_MODEL_ROUTER;
  assert.deepEqual(router.disabledProviders, ['anthropic'], 'Anthropic must remain opted out without pinning any model');
  for (const [tier, config] of Object.entries(router.tiers || {})) {
    assert.deepEqual(config.models, [], `shipped ${tier} tier must not hardcode a model`);
  }
  assert.deepEqual(router.userSelected?.models, [], 'a fresh install starts without an implicit model selection');
});

test('mirror ships at packages/sdk/dist/router/failover-mirror.mjs', () => {
  assert.ok(
    existsSync(DIST_MIRROR),
    `expected failover-mirror.mjs at ${DIST_MIRROR} — run \`npm run build:sdk\` first`,
  );
  const src = readFileSync(DIST_MIRROR, 'utf8');
  assert.ok(
    src.includes('rankUserSelectedForRole'),
    'mirror at dist path must export rankUserSelectedForRole',
  );
});

test('cli/commands/models.mjs does not import from packages/sdk/src/', () => {
  const src = readFileSync(CLI_MODELS, 'utf8');
  assert.ok(
    !src.includes("'../../packages/sdk/src/"),
    `cli/commands/models.mjs still imports from packages/sdk/src/ — the src/ directory is not in the published tarball. Point the import at packages/sdk/dist/.`,
  );
  // Sanity: the dist import must actually be present.
  assert.ok(
    src.includes("'../../packages/sdk/dist/router/failover-mirror.mjs'"),
    'cli/commands/models.mjs must import the mirror from the dist path',
  );
});

test('cli/commands/models.mjs dynamic-imports without ERR_MODULE_NOT_FOUND', async () => {
  // This is the actual user-facing assertion: after `bizar install`,
  // running `bizar models` should load the CLI module. We replicate
  // that by dynamic-importing the same module the CLI entrypoint loads.
  await assert.doesNotReject(
    () => import(pathToFileURL(CLI_MODELS).href),
    /ERR_MODULE_NOT_FOUND|Cannot find module/,
  );
  // And the imported symbol we care about is callable.
  const mod = await import(pathToFileURL(CLI_MODELS).href);
  assert.equal(typeof mod.explainSelection, 'function');
  assert.equal(typeof mod.listModels, 'function');
});
