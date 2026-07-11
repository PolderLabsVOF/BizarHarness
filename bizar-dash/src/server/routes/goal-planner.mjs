/**
 * src/server/routes/goal-planner.mjs
 *
 * v6.4.0 — F-036 (Goal Planner UI).
 *
 * Single endpoint:
 *   POST /api/goal-planner/plan { goal } -> Plan
 *
 * The planner logic is duplicated here in pure JS so the route
 * runs without a Vite build step. The canonical implementation
 * lives in `bizar-dash/src/web/lib/goapPlanner.ts` and produces
 * the same shape.
 */
import { Router } from 'express';
import { wrap } from './_shared.mjs';

const VERB_TO_ACTION = {
  research: { name: 'research', cost: 1, agent: 'Odin', effect: 'context_gathered', description: 'Gather context, examples, and prior art.' },
  investigate: { name: 'research', cost: 1, agent: 'Odin', effect: 'context_gathered', description: 'Probe the unknown regions of the problem.' },
  explore: { name: 'research', cost: 1, agent: 'Odin', effect: 'context_gathered', description: 'Map the solution space.' },
  find: { name: 'research', cost: 1, agent: 'Odin', effect: 'context_gathered', description: 'Locate references and prior work.' },
  analyze: { name: 'analyze', cost: 1, agent: 'Odin', effect: 'goal_analyzed', preconditions: ['context_gathered'], description: 'Decompose the goal into measurable sub-objectives.' },
  plan: { name: 'plan', cost: 1, agent: 'Odin', effect: 'plan_drafted', preconditions: ['goal_analyzed'], description: 'Sequence the work into milestones.' },
  design: { name: 'design', cost: 2, agent: 'Tyr', effect: 'design_drafted', preconditions: ['plan_drafted'], description: 'Sketch the architecture and contracts.' },
  architect: { name: 'design', cost: 2, agent: 'Tyr', effect: 'design_drafted', preconditions: ['plan_drafted'], description: 'Lay out the system structure.' },
  build: { name: 'build', cost: 3, agent: 'Thor', effect: 'artifact_built', preconditions: ['design_drafted'], description: 'Construct the artifact end-to-end.' },
  implement: { name: 'implement', cost: 3, agent: 'Thor', effect: 'artifact_built', preconditions: ['design_drafted'], description: 'Wire up the code path.' },
  create: { name: 'implement', cost: 3, agent: 'Thor', effect: 'artifact_built', preconditions: ['design_drafted'], description: 'Stand up the new module.' },
  add: { name: 'implement', cost: 2, agent: 'Thor', effect: 'artifact_built', preconditions: ['design_drafted'], description: 'Layer the new capability onto an existing surface.' },
  write: { name: 'implement', cost: 2, agent: 'Thor', effect: 'artifact_built', description: 'Author the requested artifact.' },
  fix: { name: 'implement', cost: 2, agent: 'Thor', effect: 'artifact_built', description: 'Repair the reported defect.' },
  refactor: { name: 'implement', cost: 2, agent: 'Thor', effect: 'artifact_built', description: 'Improve the structure without changing behavior.' },
  test: { name: 'test', cost: 2, agent: 'Forseti', effect: 'tests_passing', preconditions: ['artifact_built'], description: 'Exercise the artifact against acceptance criteria.' },
  verify: { name: 'test', cost: 1, agent: 'Forseti', effect: 'tests_passing', preconditions: ['artifact_built'], description: 'Validate against the original goal statement.' },
  validate: { name: 'test', cost: 1, agent: 'Forseti', effect: 'tests_passing', preconditions: ['artifact_built'], description: 'Cross-check the result against acceptance criteria.' },
  review: { name: 'review', cost: 1, agent: 'Forseti', effect: 'review_passed', preconditions: ['artifact_built'], description: 'Audit the change for quality and regressions.' },
  document: { name: 'document', cost: 1, agent: 'Bragi', effect: 'docs_written', preconditions: ['artifact_built'], description: 'Capture the new knowledge in docs.' },
  deploy: { name: 'deploy', cost: 2, agent: 'Heimdall', effect: 'deployed', preconditions: ['tests_passing', 'review_passed'], description: 'Promote the artifact to production.' },
  ship: { name: 'deploy', cost: 2, agent: 'Heimdall', effect: 'deployed', preconditions: ['tests_passing', 'review_passed'], description: 'Release the change to users.' },
  release: { name: 'deploy', cost: 2, agent: 'Heimdall', effect: 'deployed', preconditions: ['tests_passing', 'review_passed'], description: 'Tag and publish a new version.' },
  publish: { name: 'deploy', cost: 1, agent: 'Heimdall', effect: 'deployed', preconditions: ['tests_passing'], description: 'Make the artifact externally available.' },
  commit: { name: 'commit', cost: 1, agent: 'Hermod', effect: 'committed', description: 'Land the change in version control.' },
  save: { name: 'commit', cost: 1, agent: 'Hermod', effect: 'committed', description: 'Persist the work.' },
};

const DURATION_MS = {
  research: 30000, analyze: 20000, plan: 25000, design: 60000,
  build: 120000, implement: 90000, test: 60000, review: 30000,
  document: 30000, deploy: 60000, commit: 10000,
};

const FALLBACK = { name: 'research', cost: 1, agent: 'Odin', effect: 'context_gathered', description: 'Investigate the goal.' };

function splitClauses(text) {
  // Split on terminal punctuation, conjunctions (then/after/before/and
  // then), AND commas / the word "and" so that "Design, build, test,
  // and deploy" produces 4 clauses.
  const parts = text.split(/[.;!?\n]|\bthen\b|\bafter that\b|\bafter\b|\bbefore\b|\band then\b|\s*,\s*|\band\b/gi);
  const out = [];
  for (const part of parts) {
    const t = part.trim();
    if (!t) continue;
    if (!/^[a-zA-Z]+\b/.test(t) && t.includes(',')) {
      for (const sub of t.split(',')) {
        const s = sub.trim();
        if (s) out.push(s);
      }
    } else {
      out.push(t);
    }
  }
  return out;
}

function stripPolite(body) {
  let out = body;
  for (let i = 0; i < 4; i++) {
    const before = out;
    out = out.replace(/^(?:please\s+|kindly\s+)/i, '');
    out = out.replace(/^(?:we should|let's|lets|i want to|i need to|i'd like to|i would like to|can you|could you|would you|help me|help us|make sure to|please)\s+/i, '');
    if (out === before) break;
  }
  return out;
}

function extractVerb(clause) {
  const body = stripPolite(clause.trim());
  const first = (body.split(/\s+/)[0] || '').toLowerCase().replace(/[^a-z]/g, '');
  return first;
}

function clauseSubject(clause) {
  const body = stripPolite(clause.trim());
  const stripped = body.replace(/^[a-zA-Z]+\s+/, '').trim();
  return stripped.length > 0 ? stripped : clause;
}

function aStar(actions, goals) {
  const goalSet = new Set(goals);
  if (goalSet.size === 0) return actions.slice(0, 1);
  const heur = (s) => {
    let u = 0;
    for (const g of goalSet) if (!s.has(g)) u++;
    return u;
  };
  const keyOf = (s) => Array.from(s).sort().join('|') || 'empty';
  const start = { sat: new Set(), path: [], cost: 0 };
  const open = [start];
  const closed = new Set();
  let best = start;
  while (open.length) {
    open.sort((a, b) => (a.cost + heur(a.sat)) - (b.cost + heur(b.sat)));
    const node = open.shift();
    if (heur(node.sat) === 0) return node.path;
    if (heur(node.sat) < heur(best.sat)) best = node;
    const k = keyOf(node.sat);
    if (closed.has(k)) continue;
    closed.add(k);
    for (const a of actions) {
      const pre = a.preconditions || [];
      if (!pre.every((p) => node.sat.has(p))) continue;
      const next = new Set(node.sat);
      next.add(a.effect);
      open.push({ sat: next, path: [...node.path, a], cost: node.cost + a.cost });
    }
  }
  return best.path;
}

function inlinePlan(goalText) {
  const id = `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const clauses = splitClauses(goalText);
  const effective = clauses.length > 0 ? clauses : [(goalText || 'Investigate the goal').trim()];
  const rawTemplates = effective.map((c) => VERB_TO_ACTION[extractVerb(c)] || FALLBACK);
  const subjects = effective.map(clauseSubject);
  const seen = new Set();
  const dedup = [];
  for (let i = 0; i < rawTemplates.length; i++) {
    const t = rawTemplates[i];
    const s = subjects[i] || `step ${i + 1}`;
    const sig = `${t.name}::${s.toLowerCase().slice(0, 40)}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    dedup.push({ template: t, subject: s });
  }
  const trimmed = dedup.slice(0, 8);
  const goalEffects = trimmed.map((d) => d.template.effect);
  const sequence = aStar(trimmed.map((d) => d.template), goalEffects);
  const idByEffect = new Map();
  const steps = [];
  let n = 0;
  for (const tpl of sequence) {
    const match = trimmed.find((s) => s.template === tpl);
    if (!match) continue;
    n += 1;
    const sid = `s${n}`;
    const deps = [];
    for (const p of tpl.preconditions || []) {
      const pid = idByEffect.get(p);
      if (pid) deps.push(pid);
    }
    const title = match.subject.charAt(0).toUpperCase() + match.subject.slice(1);
    steps.push({
      id: sid,
      action: tpl.name,
      title: title.length > 0 ? title : tpl.name,
      agent: tpl.agent,
      description: tpl.description,
      effects: [tpl.effect],
      deps,
      status: 'pending',
      estimatedCost: tpl.cost,
      estimatedDurationMs: DURATION_MS[tpl.name] || 30000,
    });
    idByEffect.set(tpl.effect, sid);
  }
  if (steps.length === 0 && trimmed.length > 0) {
    let idx = 0;
    for (const { template, subject } of trimmed) {
      idx += 1;
      const sid = `s${idx}`;
      const deps = [];
      for (const p of template.preconditions || []) {
        const pid = idByEffect.get(p);
        if (pid) deps.push(pid);
      }
      const title = subject.charAt(0).toUpperCase() + subject.slice(1);
      steps.push({
        id: sid,
        action: template.name,
        title: title.length > 0 ? title : template.name,
        agent: template.agent,
        description: template.description,
        effects: [template.effect],
        deps,
        status: 'pending',
        estimatedCost: template.cost,
        estimatedDurationMs: DURATION_MS[template.name] || 30000,
      });
      idByEffect.set(template.effect, sid);
    }
  }
  const totalCost = steps.reduce((sum, s) => sum + s.estimatedCost, 0);
  const totalDurationMs = steps.reduce((sum, s) => sum + s.estimatedDurationMs, 0);
  return { id, goal: goalText, steps, totalCost, totalDurationMs, goalEffects };
}

function readGoal(body) {
  const raw = body && body.goal;
  if (typeof raw !== 'string' || !raw.trim()) {
    const err = new Error('goal (non-empty string) is required');
    err.status = 400;
    err.code = 'bad_request';
    throw err;
  }
  if (raw.length > 4000) {
    const err = new Error('goal must be 4000 chars or fewer');
    err.status = 400;
    err.code = 'bad_request';
    throw err;
  }
  return raw.trim();
}

export function createGoalPlannerRouter({ broadcast } = {}) {
  const router = Router();
  router.post('/goal-planner/plan', wrap(async (req, res) => {
    const goal = readGoal(req.body);
    const plan = inlinePlan(goal);
    if (broadcast) {
      try { broadcast({ type: 'goal:planned', planId: plan.id, goal }); } catch { /* best-effort */ }
    }
    res.json(plan);
  }));
  return router;
}
