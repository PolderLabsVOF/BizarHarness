#!/usr/bin/env node
/**
 * goal-bootstrap.mjs — Claude Code SessionStart hook (F-207).
 *
 * On every SessionStart, runs the SDK `bootstrapGoalFromFile` helper
 * to decide whether the orchestrator should RESUME an in-flight
 * ultragoal, BOOTSTRAP a fresh one for the next `not_started`
 * feature, or stay IDLE. The verdict is emitted into the SessionStart
 * `additionalContext` so the next agent turn sees it without re-running
 * the helper.
 *
 * Always exits 0 — bootstrap is a hint, not a gate. A malformed
 * `feature_list.json` or write failure is degraded to `idle` with a
 * warning; it never aborts SessionStart.
 *
 * Output shape:
 *   {
 *     hookSpecificOutput: {
 *       hookEventName: 'SessionStart',
 *       additionalContext: '<briefing line>',
 *     },
 *   }
 *
 * The `additionalContext` line is consumed by `sessionstart-prime.mjs`
 * (F-207 wiring) and folded into the standard SessionStart briefing.
 */
'use strict';

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import {
  bootstrapGoalFromFile,
  GoalBootstrapError,
} from '../../../packages/sdk/dist/agent/goal-bootstrap.js';

const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR
  || process.cwd();

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { buf += c; });
    process.stdin.on('end', () => resolve(buf));
  });
}

function resolveSpecsDir(cwd) {
  const candidate = join(cwd, 'docs', 'specs');
  return isAbsolute(candidate) ? candidate : candidate;
}

function summarize(verdict) {
  switch (verdict.action) {
    case 'resume':
      return `goal: resume ultragoal ${verdict.id} (source=${verdict.source})`;
    case 'bootstrap':
      return `goal: bootstrap ultragoal ${verdict.id} → ${verdict.charterPath}`;
    case 'idle':
      return 'goal: idle (no not_started features in feature_list.json)';
    default:
      return 'goal: unknown verdict';
  }
}

async function main() {
  await readStdin(); // consume stdin even though we don't use the payload

  const featureListPath = join(PROJECT_ROOT, 'feature_list.json');
  const specsDir = resolveSpecsDir(PROJECT_ROOT);

  // Ensure specsDir exists for the helper. The helper also creates
  // it, but mkdirSync here lets resume find the directory before
  // any charter file is read.
  if (!existsSync(specsDir)) {
    try {
      mkdirSync(specsDir, { recursive: true });
    } catch (err) {
      const out = {
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: `goal-bootstrap: could not create specsDir ${specsDir}: ${err instanceof Error ? err.message : String(err)} (idle)`,
        },
      };
      process.stdout.write(JSON.stringify(out) + '\n');
      return;
    }
  }

  let result;
  try {
    result = bootstrapGoalFromFile({ featureListPath, specsDir });
  } catch (err) {
    if (!(err instanceof GoalBootstrapError)) {
      // Unknown error — degrade silently rather than abort SessionStart.
      result = { verdict: { action: 'idle' } };
    } else {
      result = { verdict: { action: 'idle' }, warning: err.message };
    }
  }

  const summary = summarize(result.verdict);
  const additionalContext = result.warning
    ? `${summary} — warning: ${result.warning}`
    : summary;

  const out = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext,
    },
  };
  process.stdout.write(JSON.stringify(out) + '\n');
}

main().catch((err) => {
  // Hard safety net — never abort SessionStart.
  const msg = err instanceof Error ? err.message : String(err);
  const out = {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `goal-bootstrap: hard error (${msg}) — idle`,
    },
  };
  process.stdout.write(JSON.stringify(out) + '\n');
});
