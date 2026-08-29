/**
 * scripts/__tests__/spec-sprawl.test.mjs
 *
 * Audit #84 — P2 spec-sprawl reduction. Pins the canonical mapping
 * of SDK schemas + mirror files + policy doc frontmatter. Three
 * surfaces under test:
 *
 *   1. SDK schemas (ObjectiveRun, EvidenceBundle, OutcomeLearnerOutcome)
 *      each export a `<NAME>_SCHEMA_VERSION` constant, the factory
 *      stamps it on new records, and the SDK dist + d.ts agree.
 *   2. The AGENTS.md mirror pair (CLAUDE.md at root + config/claude/CLAUDE.md)
 *      is byte-identical to the canonical source (modulo the banner
 *      header in the inner mirror).
 *   3. The canonical policy doc (`docs/decisions/AUTONOMY_CONTRACT.md`)
 *      carries `owner:` and `review-cadence:` frontmatter so the
 *      review owner is discoverable from `bizar spec-list`.
 *
 *   4. `bizar spec-list` returns a JSON document that lists every
 *      schema with its version + file path.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = process.cwd();

describe('spec-sprawl — SDK schema versions (audit #84)', () => {
  it('autonomy/objective-run exports OBJECTIVE_RUN_SCHEMA_VERSION', async () => {
    const sdk = await import('../../packages/sdk/dist/autonomy/index.js');
    assert.equal(typeof sdk.OBJECTIVE_RUN_SCHEMA_VERSION, 'string');
    assert.match(sdk.OBJECTIVE_RUN_SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
  });

  it('autonomy/evidence-bundle exports EVIDENCE_BUNDLE_SCHEMA_VERSION', async () => {
    const sdk = await import('../../packages/sdk/dist/autonomy/index.js');
    assert.equal(typeof sdk.EVIDENCE_BUNDLE_SCHEMA_VERSION, 'string');
    assert.match(sdk.EVIDENCE_BUNDLE_SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
  });

  it('autonomy/outcome-record exports OUTCOME_LEARNER_SCHEMA_VERSION', async () => {
    const sdk = await import('../../packages/sdk/dist/autonomy/index.js');
    assert.equal(typeof sdk.OUTCOME_LEARNER_SCHEMA_VERSION, 'string');
    assert.match(sdk.OUTCOME_LEARNER_SCHEMA_VERSION, /^\d+\.\d+\.\d+$/);
  });

  it('createObjectiveRun stamps schemaVersion on new records', async () => {
    const sdk = await import('../../packages/sdk/dist/autonomy/index.js');
    const run = sdk.createObjectiveRun({
      goal: 'spec-sprawl test',
      allowedSideEffects: [],
      forbiddenPaths: [],
      budget: { usd: 0 },
      evaluatorVersion: '1.0.0',
    });
    assert.equal(run.schemaVersion, sdk.OBJECTIVE_RUN_SCHEMA_VERSION);
  });

  it('createEvidenceBundle stamps schemaVersion on new records', async () => {
    const sdk = await import('../../packages/sdk/dist/autonomy/index.js');
    const fakeHash = '0'.repeat(64);
    const bundle = sdk.createEvidenceBundle({
      objectiveRunId: '00000000-0000-4000-8000-000000000000',
      command: 'true',
      cwd: '/tmp',
      envDigest: fakeHash,
      exitCode: 0,
      stdoutSha256: fakeHash,
      stderrSha256: fakeHash,
      testCounts: { total: 0, passed: 0, failed: 0, skipped: 0 },
      testReports: [],
      baselineRevision: '0'.repeat(40),
      resultingRevision: '0'.repeat(40),
      patchSha256: fakeHash,
      lockfileSha256: fakeHash,
      evaluatorVersion: '1.0.0',
      evaluatorSha256: fakeHash,
      rubricSha256: fakeHash,
      resourceUsage: { wallClockMs: 1, peakRssMb: 1 },
    }, 'spec-sprawl-test-secret');
    assert.equal(bundle.schemaVersion, sdk.EVIDENCE_BUNDLE_SCHEMA_VERSION);
  });

  it('createOutcomeLearnerOutcome stamps schemaVersion on new records', async () => {
    const sdk = await import('../../packages/sdk/dist/autonomy/index.js');
    const fakeHash = '0'.repeat(64);
    const bundle = sdk.createEvidenceBundle({
      objectiveRunId: '00000000-0000-4000-8000-000000000000',
      command: 'true',
      cwd: '/tmp',
      envDigest: fakeHash,
      exitCode: 0,
      stdoutSha256: fakeHash,
      stderrSha256: fakeHash,
      testCounts: { total: 0, passed: 0, failed: 0, skipped: 0 },
      testReports: [],
      baselineRevision: '0'.repeat(40),
      resultingRevision: '0'.repeat(40),
      patchSha256: fakeHash,
      lockfileSha256: fakeHash,
      evaluatorVersion: '1.0.0',
      evaluatorSha256: fakeHash,
      rubricSha256: fakeHash,
      resourceUsage: { wallClockMs: 1, peakRssMb: 1 },
    }, 'spec-sprawl-test-secret');
    const outcome = sdk.createOutcomeLearnerOutcome({
      bundle,
      posteriorUpdates: [{ agentRole: 'worker', tier: 'sonnet', delta: 1, reason: 'spec-sprawl test' }],
    });
    assert.equal(outcome.schemaVersion, sdk.OUTCOME_LEARNER_SCHEMA_VERSION);
  });

  it('dist d.ts re-declares every SCHEMA_VERSION constant', () => {
    const dts = readFileSync(join(REPO_ROOT, 'packages/sdk/dist/autonomy/index.d.ts'), 'utf8');
    assert.match(dts, /OBJECTIVE_RUN_SCHEMA_VERSION/);
    assert.match(dts, /EVIDENCE_BUNDLE_SCHEMA_VERSION/);
    assert.match(dts, /OUTCOME_LEARNER_SCHEMA_VERSION/);
  });
});

describe('spec-sprawl — AGENTS.md mirror pair (audit #84)', () => {
  it('the canonical AGENTS.md exists', () => {
    assert.ok(existsSync(join(REPO_ROOT, 'AGENTS.md')), 'AGENTS.md must exist');
  });

  it('the root CLAUDE.md is byte-identical to AGENTS.md', () => {
    const canonical = readFileSync(join(REPO_ROOT, 'AGENTS.md'));
    const mirror = readFileSync(join(REPO_ROOT, 'CLAUDE.md'));
    assert.ok(canonical.equals(mirror), 'CLAUDE.md must be byte-identical to AGENTS.md; run `make mirror-claude-md`');
  });

  it('config/claude/CLAUDE.md embeds the canonical source body', () => {
    const canonical = readFileSync(join(REPO_ROOT, 'AGENTS.md'), 'utf8');
    const mirror = readFileSync(join(REPO_ROOT, 'config/claude/CLAUDE.md'), 'utf8');
    // The inner mirror prepends a banner + separator. The script
    // also strips the first `# title` line, so we compare against
    // the body past the first heading.
    assert.match(mirror, /auto-mirrored from .AGENTS.md/);
    assert.match(mirror, /## Commands/);
    // And contains a chunk of canonical content past the title.
    const canonicalBody = canonical.split('\n').slice(1).join('\n');
    assert.ok(mirror.includes(canonicalBody.slice(0, 256)),
      'config/claude/CLAUDE.md must contain canonical AGENTS.md content past the title');
  });

  it('the mirror script reports both mirrors in sync', () => {
    if (existsSync(join(REPO_ROOT, 'scripts/mirror-claude-md.sh'))) {
      const out = execFileSync('bash', ['scripts/mirror-claude-md.sh', '--check'], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        timeout: 10_000,
      });
      assert.match(out, /in sync/);
    }
  });
});

describe('spec-sprawl — AUTONOMY_CONTRACT frontmatter (audit #84)', () => {
  it('docs/decisions/AUTONOMY_CONTRACT.md carries owner + review-cadence frontmatter', () => {
    const src = readFileSync(join(REPO_ROOT, 'docs/decisions/AUTONOMY_CONTRACT.md'), 'utf8');
    assert.match(src, /^---\n[\s\S]*?\n---/);
    const fm = src.match(/^---\n([\s\S]*?)\n---/)[1];
    assert.match(fm, /^owner:\s*\S+$/m);
    assert.match(fm, /^review-cadence:\s*\S+$/m);
  });
});

describe('spec-sprawl — bizar spec-list (audit #84)', () => {
  it('cli/commands/spec-list.mjs exports buildSpecList + USAGE + run', async () => {
    const mod = await import('../../cli/commands/spec-list.mjs');
    assert.equal(typeof mod.buildSpecList, 'function');
    assert.equal(typeof mod.USAGE, 'string');
    assert.equal(typeof mod.run, 'function');
    assert.match(mod.USAGE, /bizar spec-list/);
  });

  it('buildSpecList returns schemas + policyDocs + mirrors', async () => {
    const mod = await import('../../cli/commands/spec-list.mjs');
    const doc = mod.buildSpecList();
    assert.ok(doc.schemas);
    assert.ok(Array.isArray(doc.policyDocs));
    assert.ok(doc.mirrors);
    assert.ok(typeof doc.generatedAt === 'string');
    // Schemas: at least ObjectiveRun, EvidenceBundle, OutcomeLearnerOutcome.
    const names = doc.schemas.schemas.map((s) => s.name);
    assert.ok(names.includes('ObjectiveRun'));
    assert.ok(names.includes('EvidenceBundle'));
    assert.ok(names.includes('OutcomeLearnerOutcome'));
    // Each schema has a version + file path.
    for (const s of doc.schemas.schemas) {
      assert.match(s.version, /^\d+\.\d+\.\d+$/);
      assert.ok(s.file.startsWith('packages/sdk/src/'));
    }
  });

  it('buildSpecList.policyDocs includes AUTONOMY_CONTRACT.md with an owner', async () => {
    const mod = await import('../../cli/commands/spec-list.mjs');
    const doc = mod.buildSpecList();
    const contract = doc.policyDocs.find((d) => d.path === 'docs/decisions/AUTONOMY_CONTRACT.md');
    assert.ok(contract, 'AUTONOMY_CONTRACT.md must be in the policy docs list');
    // The frontmatter is in place; the owner should be a real string.
    assert.notEqual(contract.owner, null);
    assert.notEqual(contract.owner, `unowned (expected orchestrator)`);
  });

  it('buildSpecList.mirrors reports both mirrors present + root in sync', async () => {
    const mod = await import('../../cli/commands/spec-list.mjs');
    const doc = mod.buildSpecList();
    assert.equal(doc.mirrors.canonical, 'AGENTS.md');
    for (const m of doc.mirrors.mirrors) {
      assert.ok(m.exists, `${m.path} must exist`);
    }
    assert.equal(doc.mirrors.rootMirrorInSync, true);
  });

  it('bin.mjs registers the spec-list case', () => {
    const src = readFileSync(join(REPO_ROOT, 'cli/bin.mjs'), 'utf8');
    assert.match(src, /case 'spec-list':/);
    assert.match(src, /spec-list[\s\S]+audit #84/);
  });
});
