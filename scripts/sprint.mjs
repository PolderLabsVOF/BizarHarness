/**
 * scripts/sprint.mjs
 *
 * /sprint <goal-id> — auto-fill a sprint contract from root PROGRESS.md.
 *
 * Usage:
 *   node scripts/sprint.mjs <goal-id> [projectRoot]
 *
 * projectRoot defaults to process.cwd().
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @param {string} goalId @param {string} projectRoot */
export async function fillSprintContract(goalId, projectRoot = process.cwd()) {
  // 1. Find and read progress-parser.mjs
  const parserPath = join(projectRoot, 'cli', 'progress-parser.mjs');
  let parseProgress;
  try {
    ({ parseProgress } = await import(parserPath));
  } catch {
    throw new Error(`progress-parser.mjs not found at ${parserPath}`);
  }

  // 2. Read the canonical root PROGRESS.md.
  const progressPath = join(projectRoot, 'PROGRESS.md');
  if (!existsSync(progressPath)) {
    throw new Error(`PROGRESS.md not found at ${progressPath}`);
  }
  const progressText = readFileSync(progressPath, 'utf8');
  const { goals } = parseProgress(progressText);

  // 3. Find the goal
  const goal = goals.find((g) => g.id.toUpperCase() === goalId.toUpperCase());
  if (!goal) {
    const available = goals.map((g) => g.id).join(', ');
    throw new Error(`goal '${goalId}' not found in PROGRESS.md. Available: ${available || 'none'}`);
  }

  // 4. Read template
  const templatePath = join(projectRoot, 'templates', 'sprint-contract.md');
  if (!existsSync(templatePath)) {
    throw new Error(`sprint-contract.md not found at ${templatePath}`);
  }
  const template = readFileSync(templatePath, 'utf8');

  // 5. Build pre-filled content
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  // Split template into lines for section-by-section replacement
  const lines = template.split('\n');
  const out = [];

  // Section flags
  let inScopeIn = false;
  let inScopeOut = false;
  let inDod = false;
  let filledFeatureId = false;
  let filledTitle = false;
  let filledOwner = false;
  let filledSprintDate = false;
  let scopeInStarted = false;

  const completedKRs = goal.keyResults.filter((kr) => kr.done);
  const pendingKRs = goal.keyResults.filter((kr) => !kr.done);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Fill Identification section
    if (!filledFeatureId && /Feature ID/.test(line)) {
      out.push(line.replace('F-NNN', goal.id));
      filledFeatureId = true;
      continue;
    }
    if (!filledTitle && /^\s*- \*\*Title:\*\*/.test(line)) {
      out.push(line.replace('<one-line>', goal.title));
      filledTitle = true;
      continue;
    }
    if (!filledSprintDate && /Sprint date/.test(line)) {
      out.push(line.replace('YYYY-MM-DD', today));
      filledSprintDate = true;
      continue;
    }
    if (!filledOwner && /^\s*- \*\*Owner:\*\*/.test(line)) {
      out.push(line.replace('<agent name or "claude">', goal.owner ?? 'claude'));
      filledOwner = true;
      continue;
    }

    // Scope (in) — replace placeholder with goal KRs
    if (/^\s*## Scope \(in\)/.test(line)) {
      inScopeIn = true;
      inScopeOut = false;
      inDod = false;
      out.push(line);
      continue;
    }
    if (/^\s*## Scope \(out\)/.test(line)) {
      inScopeIn = false;
      inScopeOut = true;
      inDod = false;
      out.push(line);
      // Add a blank "not yet defined" placeholder if no scope-out is natural
      out.push('\n- _None defined yet — add items as the sprint evolves_\n');
      continue;
    }
    if (inScopeIn && !scopeInStarted && /^-\s*<item/.test(line)) {
      scopeInStarted = true;
      // Replace placeholder with pending KRs first, then completed
      if (pendingKRs.length > 0) {
        out.push(`- _In progress (${pendingKRs.length}):_`);
        for (const kr of pendingKRs) {
          out.push(`- [ ] ${kr.title}`);
        }
        out.push('');
      }
      if (completedKRs.length > 0) {
        out.push(`- _Done (${completedKRs.length}):_`);
        for (const kr of completedKRs) {
          out.push(`- [x] ${kr.title}`);
        }
        out.push('');
      }
      if (goal.keyResults.length === 0) {
        out.push('- <scope item — add from goal key results>');
      }
      continue;
    }
    if (/^\s*## Definition of Done/.test(line)) {
      inScopeIn = false;
      inScopeOut = false;
      inDod = true;
      out.push(line);
      continue;
    }
    // DoD — copy the template checkboxes verbatim. The operator (or a
    // post-sprint verifier) marks them `[x]` after evidence-backed
    // verification. Pre-checking would silently turn every acceptance
    // criterion into a "done" claim with no recorded proof.
    // See: docs/audits/production-autonomy-improvements-2026-08-28.md (P0:
    // "Stop pre-completing Definition of Done in sprint generation").
    // Scope out — skip any remaining placeholders (already handled above)
    if (inScopeOut && /^-\s*<item/.test(line)) {
      continue; // skip placeholder — we added our own above
    }
    if (/^\s*## Architecture/.test(line)) {
      inScopeIn = false;
      inScopeOut = false;
      inDod = false;
    }
    if (/^\s*## Risk/.test(line)) {
      inScopeIn = false;
      inScopeOut = false;
      inDod = false;
    }

    out.push(line);
  }

  const content = out.join('\n');

  // 6. Write to .bizar/sprints/<goal-id>-<date>.md
  const sprintsDir = join(projectRoot, '.bizar', 'sprints');
  mkdirSync(sprintsDir, { recursive: true });
  const destPath = join(sprintsDir, `${goal.id}-${today}.md`);

  if (existsSync(destPath)) {
    throw new Error(`Sprint file already exists: ${destPath}\nDelete it or use a different goal.`);
  }

  writeFileSync(destPath, content, 'utf8');
  return destPath;
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const goalId = process.argv[2];
  if (!goalId) {
    console.error('Usage: node scripts/sprint.mjs <goal-id> [projectRoot]');
    process.exit(1);
  }
  const projectRoot = process.argv[3] || process.cwd();
  fillSprintContract(goalId, projectRoot)
    .then((path) => {
      console.log(`Sprint contract written: ${path}`);
    })
    .catch((err) => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
}
