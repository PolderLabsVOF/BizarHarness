#!/usr/bin/env node
/**
 * cli/commands/spec-list.mjs
 *
 * `bizar spec-list` — audit #84 (P2 spec-sprawl reduction) surface.
 *
 * Emits a flat listing of:
 *   - Every typed schema in the SDK (name + version + file path)
 *   - Every canonical policy doc (path + owner + review cadence)
 *   - Every mirror file (path + canonical source + sync status)
 *
 * Output is JSON by default; `--format=human` for an aligned table.
 *
 * Why this exists: the audit calls out "version every schema and
 * document which file is authoritative; add ownership and review
 * cadence to each policy document; keep prompts concise and load
 * role-specific instructions on demand". `bizar spec-list` is the
 * machine-readable answer — it surfaces every schema and doc,
 * with owner + version, in one place. Operators can grep it to
 * find drift; tests can assert the canonical mapping is intact.
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = process.cwd();

/**
 * Extract the export schema versions from the SDK's autonomy module.
 * The SDK is the canonical source — the command reads from the
 * compiled `dist/` so the operator never sees drift between
 * source and shipped behavior.
 */
function readSchemaVersions() {
  // Read each dist module's source — the constants live in their
  // own modules (objective-run.js, evidence-bundle.js, outcome-record.js),
  // not the barrel index.js which only re-exports.
  const modules = [
    { name: 'ObjectiveRun', var: 'OBJECTIVE_RUN_SCHEMA_VERSION', file: 'packages/sdk/src/autonomy/objective-run.ts' },
    { name: 'EvidenceBundle', var: 'EVIDENCE_BUNDLE_SCHEMA_VERSION', file: 'packages/sdk/src/autonomy/evidence-bundle.ts' },
    { name: 'OutcomeLearnerOutcome', var: 'OUTCOME_LEARNER_SCHEMA_VERSION', file: 'packages/sdk/src/autonomy/outcome-record.ts' },
  ];
  /** @type {Array<{ name: string, version: string, file: string }>} */
  const schemas = [];
  /** @type {Record<string, boolean>} */
  const dtsMatches = {};
  const dtsAll = readFileSync(join(REPO_ROOT, 'packages', 'sdk', 'dist', 'autonomy', 'index.d.ts'), 'utf8');
  for (const m of modules) {
    const jsPath = join(REPO_ROOT, 'packages', 'sdk', 'dist', 'autonomy', `${m.name === 'ObjectiveRun' ? 'objective-run' : m.name === 'EvidenceBundle' ? 'evidence-bundle' : 'outcome-record'}.js`);
    if (!existsSync(jsPath)) continue;
    const src = readFileSync(jsPath, 'utf8');
    const re = new RegExp(`${m.var}\\s*=\\s*["']([^"']+)["']`);
    const match = src.match(re);
    if (match) {
      schemas.push({ name: m.name, version: match[1], file: m.file });
    }
    dtsMatches[m.name] = new RegExp(m.var).test(dtsAll);
  }
  return { schemas, dtsMatches };
}

/**
 * Scan the policy docs and report owner / review-cadence from
 * frontmatter. The convention is YAML frontmatter with optional
 * `owner:` and `review-cadence:` keys at the top of the file.
 */
function readPolicyDocs() {
  const docs = [
    { path: 'AGENTS.md',                     role: 'canonical',   expectOwner: 'polderlabs', cadence: 'release-cut' },
    { path: 'PROGRESS.md',                   role: 'live-state',  expectOwner: 'orchestrator', cadence: 'each-commit' },
    { path: 'docs/decisions/AUTONOMY_CONTRACT.md', role: 'policy', expectOwner: 'orchestrator', cadence: 'release-cut' },
    { path: 'docs/audits/production-autonomy-improvements-2026-08-28.md', role: 'audit', expectOwner: 'auditor', cadence: 'milestone' },
  ];
  /** @type {Array<{ path: string, role: string, owner: string|null, cadence: string|null, mtime: string|null }>} */
  const enriched = [];
  for (const d of docs) {
    const abs = join(REPO_ROOT, d.path);
    if (!existsSync(abs)) {
      enriched.push({ path: d.path, role: d.role, owner: null, cadence: null, mtime: null });
      continue;
    }
    const src = readFileSync(abs, 'utf8');
    const fm = src.match(/^---\n([\s\S]*?)\n---/);
    let owner = null;
    let cadence = null;
    if (fm) {
      const ownerMatch = fm[1].match(/^owner:\s*(.+)$/m);
      const cadenceMatch = fm[1].match(/^review-cadence:\s*(.+)$/m);
      owner = ownerMatch ? ownerMatch[1].trim() : null;
      cadence = cadenceMatch ? cadenceMatch[1].trim() : null;
    }
    const stat = statSync(abs);
    enriched.push({
      path: d.path,
      role: d.role,
      owner: owner ?? `unowned (expected ${d.expectOwner})`,
      cadence: cadence ?? `unset (expected ${d.cadence})`,
      mtime: stat.mtime.toISOString(),
    });
  }
  return enriched;
}

/**
 * Inspect the mirror pair (AGENTS.md → CLAUDE.md + config/claude/CLAUDE.md)
 * and report sync status. `in_sync` is true when both mirrors are
 * byte-identical to the canonical source (modulo the banner header).
 */
function readMirrorStatus() {
  const canonical = join(REPO_ROOT, 'AGENTS.md');
  const rootMirror = join(REPO_ROOT, 'CLAUDE.md');
  const innerMirror = join(REPO_ROOT, 'config', 'claude', 'CLAUDE.md');
  const result = {
    canonical: 'AGENTS.md',
    mirrors: [
      { path: 'CLAUDE.md', exists: existsSync(rootMirror) },
      { path: 'config/claude/CLAUDE.md', exists: existsSync(innerMirror) },
    ],
  };
  if (!existsSync(canonical)) {
    result.status = 'CANONICAL_MISSING';
    return result;
  }
  const canonicalBytes = readFileSync(canonical);
  const rootBytes = existsSync(rootMirror) ? readFileSync(rootMirror) : null;
  const innerBytes = existsSync(innerMirror) ? readFileSync(innerMirror) : null;
  result.rootMirrorInSync = rootBytes != null && rootBytes.equals(canonicalBytes);
  // The inner mirror prepends a banner; we can't byte-compare. Run
  // the existing mirror script in --check mode for the inner one.
  // For spec-list we approximate: the inner mirror must contain the
  // canonical source verbatim somewhere in its body.
  if (innerBytes != null) {
    result.innerMirrorContainsCanonical = innerBytes.toString('utf8').includes(
      canonicalBytes.toString('utf8').split('\n').slice(1).join('\n').slice(0, 256),
    );
  } else {
    result.innerMirrorContainsCanonical = false;
  }
  return result;
}

/** Build the full spec-list document. Pure function over the FS. */
export function buildSpecList() {
  return {
    schemas: readSchemaVersions(),
    policyDocs: readPolicyDocs(),
    mirrors: readMirrorStatus(),
    generatedAt: new Date().toISOString(),
  };
}

export const USAGE = `
  bizar spec-list — audit #84 schema + policy doc inventory

  Usage:
    bizar spec-list [--format=json|human]

  Output (json by default):
    schemas     SDK schemas + versions + source file paths
    policyDocs  canonical docs + owner + review cadence
    mirrors     AGENTS.md mirror pair sync status
`;

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    }
  }
  return flags;
}

export async function run(subargs) {
  if (subargs.includes('--help') || subargs.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  const flags = parseFlags(subargs);
  const doc = buildSpecList();
  const format = String(flags.format ?? 'json');

  if (format === 'json') {
    console.log(JSON.stringify(doc, null, 2));
    return 0;
  }

  // Human format: aligned columns.
  console.log(`bizar spec-list — audit #84 (generated ${doc.generatedAt})`);
  console.log('');
  console.log('  Schemas:');
  if (doc.schemas) {
    for (const s of doc.schemas.schemas) {
      console.log(`    ${s.name.padEnd(28)} ${s.version.padEnd(10)} ${s.file}`);
    }
  } else {
    console.log('    (SDK dist not built; run npm run build:sdk)');
  }
  console.log('');
  console.log('  Policy docs:');
  for (const d of doc.policyDocs) {
    console.log(`    ${d.path.padEnd(58)} owner=${d.owner}  cadence=${d.cadence}`);
  }
  console.log('');
  console.log('  Mirrors:');
  for (const m of doc.mirrors.mirrors) {
    const tag = m.exists ? 'present' : 'missing';
    console.log(`    ${m.path.padEnd(28)} ${tag}`);
  }
  if (doc.mirrors.rootMirrorInSync !== undefined) {
    console.log(`    root-mirror-in-sync: ${doc.mirrors.rootMirrorInSync}`);
  }
  if (doc.mirrors.innerMirrorContainsCanonical !== undefined) {
    console.log(`    inner-mirror-contains-canonical: ${doc.mirrors.innerMirrorContainsCanonical}`);
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
