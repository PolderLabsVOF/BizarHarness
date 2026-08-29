/**
 * scripts/__tests__/evidence-ledger-drift.test.mjs
 *
 * Phase B.2 drift guard. Exercises the F-194 evidence-ledger surface so
 * silent regressions fail CI:
 *
 *   1. The shipped CLI exposes `bizar evidence append`, `bizar evidence list`,
 *      and `bizar evidence verify-bundles` subcommands.
 *   2. `cli/commands/evidence-bundles.mjs` exports the typed ledger
 *      surface (`resolveEvidenceDir`, `ensureEvidenceDir`, `appendBundle`,
 *      `listBundles`, `verifyBundles`, `EVIDENCE_DIR_MODE`, `SIGNATURES_BUNDLE`).
 *   3. `cli/provision.mjs` re-creates `evidence/` with `0o700` on every
 *      BIZAR_HOME ensure and lists `BIZAR_HOME/evidence` in
 *      `forceCleanInstall().preserved`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { isAbsolute, join } from 'node:path';

describe('F-194 evidence ledger drift guard', () => {
  it('cli/commands/evidence-bundles.mjs exports the F-194 surface', async () => {
    const mod = await import('../../cli/commands/evidence-bundles.mjs');
    assert.equal(typeof mod.resolveEvidenceDir, 'function');
    assert.equal(typeof mod.ensureEvidenceDir, 'function');
    assert.equal(typeof mod.appendBundle, 'function');
    assert.equal(typeof mod.listBundles, 'function');
    assert.equal(typeof mod.verifyBundles, 'function');
    assert.equal(mod.EVIDENCE_DIR_MODE, 0o700);
    assert.equal(mod.SIGNATURES_BUNDLE, 'signatures.bundle');
  });

  it('cli/commands/evidence.mjs dispatches the append/list/verify-bundles subcommands', async () => {
    const src = readFileSync(
      join(process.cwd(), 'cli', 'commands', 'evidence.mjs'),
      'utf8',
    );
    assert.match(src, /case 'append':/);
    assert.match(src, /case 'list':/);
    assert.match(src, /case 'verify-bundles':/);
    assert.match(src, /handleAppend/);
    assert.match(src, /handleList/);
    assert.match(src, /handleVerifyBundles/);
  });

  it('cli/provision.mjs creates evidence/ with mode 0o700 and preserves it under force-clean', async () => {
    const src = readFileSync(
      join(process.cwd(), 'cli', 'provision.mjs'),
      'utf8',
    );
    // ensureBizarHome creates the evidence subdir via the shared secure-dir
    // helper (which mkdirs at 0o700 and tightens pre-existing loose dirs).
    assert.match(src, /join\(BIZAR_HOME\(\), 'evidence'\)/);
    assert.match(src, /ensureSecureDir\(\{[^}]*subdir:\s*'evidence'/);
    // forceCleanInstall preserves the evidence dir explicitly.
    const preservedBlock = src.match(/const evidenceDir = join\(BIZAR_HOME\(\), 'evidence'\);[\s\S]{0,400}preserved\.push\(evidenceDir\)/);
    assert.ok(preservedBlock, 'forceCleanInstall must push evidenceDir into preserved[]');
  });

  it('the bin entrypoint advertises append/list/verify-bundles in --help', () => {
    // We can't easily run the bin in a sandbox (it imports chalk, opens
    // telemetry, etc.). Spot-check that the help text mentions the new
    // subcommands — they're documented inside evidence.mjs.
    const src = readFileSync(
      join(process.cwd(), 'cli', 'commands', 'evidence.mjs'),
      'utf8',
    );
    assert.match(src, /bizar evidence append/);
    assert.match(src, /bizar evidence list/);
    assert.match(src, /bizar evidence verify-bundles/);
  });
});
