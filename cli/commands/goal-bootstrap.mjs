#!/usr/bin/env node
/**
 * cli/commands/goal-bootstrap.mjs
 *
 * `bizar goal-bootstrap` — F-207 Mike autonomous goal / ultragoal
 * bootstrap. Reads `feature_list.json` + `docs/specs/ultragoal-*.md`
 * and runs the SDK helper. On `bootstrap` it writes the new charter
 * to disk; on `resume` and `idle` it touches nothing.
 *
 * Usage:
 *   bizar goal-bootstrap [--feature-list <path>] [--specs-dir <path>] [--json]
 *
 * Defaults:
 *   --feature-list  ./feature_list.json
 *   --specs-dir     ./docs/specs
 *
 * Output is JSON on stdout. Exit codes:
 *   0   resume | bootstrap | idle (with optional warning)
 *   1   malformed input / I/O failure (GoalBootstrapError surfaces here)
 *
 * The CLI MUST NOT auto-commit, auto-push, or auto-publish. Only the
 * `bootstrap` action writes a single durable artifact (the charter)
 * under `docs/specs/`.
 */

import { dirname, isAbsolute, resolve } from 'node:path';
import {
  bootstrapGoalFromFile,
  GoalBootstrapError,
} from '../../packages/sdk/dist/agent/goal-bootstrap.js';

const EXIT_OK = 0;
const EXIT_ERROR = 1;

function usage() {
  console.log(`
  bizar goal-bootstrap — F-207 Mike autonomous goal seeding
  Usage:
    bizar goal-bootstrap [--feature-list <path>] [--specs-dir <path>] [--json]
  What it does:
    On every SessionStart, Mike reads feature_list.json and any
    existing docs/specs/ultragoal-*.md charter. If a charter exists
    whose feature is non-passing, the bootstrap RESUMES that goal
    and writes nothing. Otherwise, if any feature is not_started,
    the bootstrap PICKS the smallest F-ID and writes a fresh
    aggregate-mode charter to docs/specs/ultragoal-<id>.md. If
    neither condition holds, the bootstrap returns IDLE.
  Defaults:
    --feature-list  ./feature_list.json
    --specs-dir     ./docs/specs  (resolved to absolute path)
  Output:
    JSON on stdout:
      { action: "resume",    id, source }
      { action: "bootstrap", id, charterPath }
      { action: "idle" }
    Plus an optional "warning" field when the feature_list.json is
    missing or malformed (verdict falls back to idle).
  Exit codes:
    0  resume | bootstrap | idle
    1  GoalBootstrapError (malformed features or write failure)
`);
}

function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a !== 'string') continue;
    if (!a.startsWith('--')) {
      if (!out._positional) out._positional = [];
      out._positional.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function resolveFeatureList(featureListRaw) {
  return typeof featureListRaw === 'string' && featureListRaw.length > 0
    ? resolve(process.cwd(), featureListRaw)
    : resolve(process.cwd(), 'feature_list.json');
}

function resolveSpecsDir(specsDirRaw, featureListPath) {
  if (typeof specsDirRaw === 'string' && specsDirRaw.length > 0) {
    return isAbsolute(specsDirRaw)
      ? specsDirRaw
      : resolve(dirname(featureListPath), specsDirRaw);
  }
  return resolve(dirname(featureListPath), 'docs', 'specs');
}

export async function run(subargs) {
  const args = Array.isArray(subargs) ? subargs : [];
  if (args.length === 0 || args[0] === '--help' || args[0] === '-h' || args[0] === 'help') {
    usage();
    return EXIT_OK;
  }
  const flags = parseFlags(args);
  const featureListPath = resolveFeatureList(flags['feature-list']);
  const specsDir = resolveSpecsDir(
    typeof flags['specs-dir'] === 'string' ? flags['specs-dir'] : null,
    featureListPath,
  );

  let result;
  try {
    result = bootstrapGoalFromFile({ featureListPath, specsDir });
  } catch (err) {
    if (err instanceof GoalBootstrapError) {
      console.error(`goal-bootstrap: ${err.message}`);
      return EXIT_ERROR;
    }
    console.error(`goal-bootstrap: unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    return EXIT_ERROR;
  }

  const payload = result.warning
    ? { ...result.verdict, warning: result.warning }
    : result.verdict;
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  return EXIT_OK;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).then((code) => process.exit(code ?? 0));
}
