/**
 * scripts/sprint.mjs
 *
 * /sprint <goal-id> — auto-fill a sprint contract from an OpenKan PRD.
 *
 * Usage:
 *   node scripts/sprint.mjs <goal-id> [projectRoot]
 *
 * projectRoot defaults to process.cwd().
 *
 * Operational model (DEC-023): OpenKan `.ok/prds/<id>.json` is the
 * canonical source of durable goals. The sprint contract is a derived
 * operator artifact under `.bizar/sprints/`, regenerated from the
 * matching PRD on demand.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const STATUS_DONE = new Set(['done', 'completed', 'passing']);
const STATUS_PENDING = new Set(['open', 'pending', 'in_progress', 'review', 'blocked']);

/**
 * Read every PRD under `.ok/prds/` and return the matching goal + the
 * PRD that hosts it.
 */
function findOpenKanGoal(goalId, projectRoot) {
  const prdDir = join(projectRoot, '.ok', 'prds');
  if (!existsSync(prdDir)) return null;
  const files = readdirSync(prdDir).filter((name) => name.endsWith('.json')).sort();
  for (const file of files) {
    const prdPath = join(prdDir, file);
    let prd;
    try {
      prd = JSON.parse(readFileSync(prdPath, 'utf8'));
    } catch {
      continue;
    }
    if (prd?.schema !== 'ok.prd.v1') continue;
    const goal = (prd.goals || []).find((candidate) =>
      typeof candidate?.id === 'string'
      && candidate.id.toUpperCase() === goalId.toUpperCase()
    );
    if (goal) {
      return { prd, goal, prdPath };
    }
  }
  return null;
}

/** @param {string} goalId @param {string} projectRoot */
export async function fillSprintContract(goalId, projectRoot = process.cwd()) {
  // 1. Find the goal across every PRD in .ok/prds/
  const located = findOpenKanGoal(goalId, projectRoot);
  if (!located) {
    throw new Error(
      `goal '${goalId}' not found under .ok/prds/. `
      + `Run \`bizar goals list\` or \`bizar openkan prd list --json\` to see available goals.`,
    );
  }
  const { goal, prd } = located;

  // 2. Derive the sprint-shape fields. OpenKan PRDs use simple goal
  //    entries ({ id, text, status }) rather than the legacy PROGRESS.md
  //    key-results list; we surface each goal text as a single scope item
  //    so the operator gets a useful contract even with the leaner shape.
  const goalTitle = goal.text?.split('\n')[0]?.trim() || prd.title || goalId;
  const goalOwner = (Array.isArray(prd.owners) && prd.owners.length > 0)
    ? prd.owners[0]
    : (typeof prd.owner === 'string' ? prd.owner : 'claude');
  const goalStatus = typeof goal.status === 'string' ? goal.status.toLowerCase() : 'open';
  const isDone = STATUS_DONE.has(goalStatus);
  const sprintGoal = {
    id: goalId,
    title: goalTitle,
    owner: goalOwner,
    keyResults: [{ title: goal.text || goalTitle, done: isDone }],
  };

  // 3. Read template
  const templatePath = join(projectRoot, 'templates', 'sprint-contract.md');
  if (!existsSync(templatePath)) {
    throw new Error(`sprint-contract.md not found at ${templatePath}`);
  }
  const template = readFileSync(templatePath, 'utf8');

  // 4. Build pre-filled content
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const lines = template.split('\n');
  const out = [];

  let inScopeIn = false;
  let inScopeOut = false;
  let inDod = false;
  let filledFeatureId = false;
  let filledTitle = false;
  let filledOwner = false;
  let filledSprintDate = false;
  let scopeInStarted = false;

  const completedKRs = sprintGoal.keyResults.filter((kr) => kr.done);
  const pendingKRs = sprintGoal.keyResults.filter((kr) => !kr.done);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!filledFeatureId && /Feature ID/.test(line)) {
      out.push(line.replace('F-NNN', sprintGoal.id));
      filledFeatureId = true;
      continue;
    }
    if (!filledTitle && /^\s*- \*\*Title:\*\*/.test(line)) {
      out.push(line.replace('<one-line>', sprintGoal.title));
      filledTitle = true;
      continue;
    }
    if (!filledSprintDate && /Sprint date/.test(line)) {
      out.push(line.replace('YYYY-MM-DD', today));
      filledSprintDate = true;
      continue;
    }
    if (!filledOwner && /^\s*- \*\*Owner:\*\*/.test(line)) {
      out.push(line.replace('<agent name or "claude">', sprintGoal.owner ?? 'claude'));
      filledOwner = true;
      continue;
    }

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
      out.push('\n- _None defined yet — add items as the sprint evolves_\n');
      continue;
    }
    if (inScopeIn && !scopeInStarted && /^-\s*<item/.test(line)) {
      scopeInStarted = true;
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
      if (sprintGoal.keyResults.length === 0) {
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
    if (inScopeOut && /^-\s*<item/.test(line)) {
      continue;
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

  // 5. Write to .bizar/sprints/<goal-id>-<date>.md
  const sprintsDir = join(projectRoot, '.bizar', 'sprints');
  mkdirSync(sprintsDir, { recursive: true });
  const destPath = join(sprintsDir, `${sprintGoal.id}-${today}.md`);

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
