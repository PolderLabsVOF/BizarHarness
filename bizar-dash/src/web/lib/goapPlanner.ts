// src/web/lib/goapPlanner.ts — GOAP-style A* planner.
//
// v6.4.0 — Goal Planner UI helper. Maps a plain-English goal into a
// plan of typed action steps, then runs a small A* search over the
// action space to pick an executable sequence whose effects satisfy
// the goal state. Heuristic = count of goal-state keys still false.
//
// Decomposition heuristic (when the caller has no a-priori actions):
//   1. Split the goal text on sentence / clause boundaries.
//   2. For each clause, extract the leading verb.
//   3. Map the verb to a Bizar action template (build / test /
//      deploy / review / document / commit / search / research).
//   4. Deduplicate steps whose action+subject collide.
//   5. Link steps via dependency detection (the default ordering is
//      research -> build -> test -> review -> deploy -> commit).
//
// The same shape is exported so the server router can re-plan
// without a browser context.

export type ActionName =
  | 'research'
  | 'analyze'
  | 'design'
  | 'build'
  | 'implement'
  | 'test'
  | 'review'
  | 'document'
  | 'deploy'
  | 'commit'
  | 'plan';

export type StepStatus = 'pending' | 'active' | 'completed' | 'blocked' | 'skipped';

export interface ActionTemplate {
  name: ActionName;
  /** Heuristic A* cost — higher = planner prefers cheaper alternatives. */
  cost: number;
  /** Free-text description of what the agent does. */
  description: string;
  /** Bizar agent name most likely to own this step (Runes / roles). */
  agent: string;
  /** Effect flag the planner wants satisfied when this step finishes. */
  effect: string;
  /** Optional precondition flags. */
  preconditions?: string[];
}

export interface PlannedStep {
  id: string;
  action: ActionName;
  title: string;
  agent: string;
  description: string;
  /** Effect keys this step produces. */
  effects: string[];
  /** Step ids that must finish before this one starts. */
  deps: string[];
  status: StepStatus;
  estimatedCost: number;
  estimatedDurationMs: number;
}

export interface Plan {
  id: string;
  goal: string;
  steps: PlannedStep[];
  totalCost: number;
  totalDurationMs: number;
  /** Effect keys satisfied at the end of the plan. */
  goalEffects: string[];
}

/**
 * Map a leading verb (after light normalization) to a Bizar
 * action template. Unknown verbs fall back to `research` so the
 * plan always makes forward progress.
 */
const VERB_TO_ACTION: Record<string, ActionTemplate> = {
  // research / discover
  research: {
    name: 'research',
    cost: 1,
    description: 'Gather context, examples, and prior art relevant to the goal.',
    agent: 'Odin',
    effect: 'context_gathered',
  },
  investigate: {
    name: 'research',
    cost: 1,
    description: 'Probe the unknown regions of the problem.',
    agent: 'Odin',
    effect: 'context_gathered',
  },
  explore: {
    name: 'research',
    cost: 1,
    description: 'Map the solution space.',
    agent: 'Odin',
    effect: 'context_gathered',
  },
  find: {
    name: 'research',
    cost: 1,
    description: 'Locate references and prior work.',
    agent: 'Odin',
    effect: 'context_gathered',
  },

  // analyze / plan
  analyze: {
    name: 'analyze',
    cost: 1,
    description: 'Decompose the goal into measurable sub-objectives.',
    agent: 'Odin',
    effect: 'goal_analyzed',
    preconditions: ['context_gathered'],
  },
  plan: {
    name: 'plan',
    cost: 1,
    description: 'Sequence the work into milestones.',
    agent: 'Odin',
    effect: 'plan_drafted',
    preconditions: ['goal_analyzed'],
  },
  design: {
    name: 'design',
    cost: 2,
    description: 'Sketch the architecture and contracts.',
    agent: 'Tyr',
    effect: 'design_drafted',
    preconditions: ['plan_drafted'],
  },
  architect: {
    name: 'design',
    cost: 2,
    description: 'Lay out the system structure.',
    agent: 'Tyr',
    effect: 'design_drafted',
    preconditions: ['plan_drafted'],
  },

  // build / implement
  build: {
    name: 'build',
    cost: 3,
    description: 'Construct the artifact end-to-end.',
    agent: 'Thor',
    effect: 'artifact_built',
    preconditions: ['design_drafted'],
  },
  implement: {
    name: 'implement',
    cost: 3,
    description: 'Wire up the code path.',
    agent: 'Thor',
    effect: 'artifact_built',
    preconditions: ['design_drafted'],
  },
  create: {
    name: 'implement',
    cost: 3,
    description: 'Stand up the new module.',
    agent: 'Thor',
    effect: 'artifact_built',
    preconditions: ['design_drafted'],
  },
  add: {
    name: 'implement',
    cost: 2,
    description: 'Layer the new capability onto an existing surface.',
    agent: 'Thor',
    effect: 'artifact_built',
    preconditions: ['design_drafted'],
  },
  write: {
    name: 'implement',
    cost: 2,
    description: 'Author the requested artifact.',
    agent: 'Thor',
    effect: 'artifact_built',
  },
  fix: {
    name: 'implement',
    cost: 2,
    description: 'Repair the reported defect.',
    agent: 'Thor',
    effect: 'artifact_built',
  },
  refactor: {
    name: 'implement',
    cost: 2,
    description: 'Improve the structure without changing behavior.',
    agent: 'Thor',
    effect: 'artifact_built',
  },

  // test / verify
  test: {
    name: 'test',
    cost: 2,
    description: 'Exercise the artifact against its acceptance criteria.',
    agent: 'Forseti',
    effect: 'tests_passing',
    preconditions: ['artifact_built'],
  },
  verify: {
    name: 'test',
    cost: 1,
    description: 'Validate against the original goal statement.',
    agent: 'Forseti',
    effect: 'tests_passing',
    preconditions: ['artifact_built'],
  },
  validate: {
    name: 'test',
    cost: 1,
    description: 'Cross-check the result against acceptance criteria.',
    agent: 'Forseti',
    effect: 'tests_passing',
    preconditions: ['artifact_built'],
  },

  // review
  review: {
    name: 'review',
    cost: 1,
    description: 'Audit the change for quality, arch-rules, and regressions.',
    agent: 'Forseti',
    effect: 'review_passed',
    preconditions: ['artifact_built'],
  },

  // document
  document: {
    name: 'document',
    cost: 1,
    description: 'Capture the new knowledge in docs.',
    agent: 'Bragi',
    effect: 'docs_written',
    preconditions: ['artifact_built'],
  },

  // deploy / ship
  deploy: {
    name: 'deploy',
    cost: 2,
    description: 'Promote the artifact to production.',
    agent: 'Heimdall',
    effect: 'deployed',
    preconditions: ['tests_passing', 'review_passed'],
  },
  ship: {
    name: 'deploy',
    cost: 2,
    description: 'Release the change to users.',
    agent: 'Heimdall',
    effect: 'deployed',
    preconditions: ['tests_passing', 'review_passed'],
  },
  release: {
    name: 'deploy',
    cost: 2,
    description: 'Tag and publish a new version.',
    agent: 'Heimdall',
    effect: 'deployed',
    preconditions: ['tests_passing', 'review_passed'],
  },
  publish: {
    name: 'deploy',
    cost: 1,
    description: 'Make the artifact externally available.',
    agent: 'Heimdall',
    effect: 'deployed',
    preconditions: ['tests_passing'],
  },

  // commit / save
  commit: {
    name: 'commit',
    cost: 1,
    description: 'Land the change in version control.',
    agent: 'Hermod',
    effect: 'committed',
  },
  save: {
    name: 'commit',
    cost: 1,
    description: 'Persist the work.',
    agent: 'Hermod',
    effect: 'committed',
  },
};

const FALLBACK_TEMPLATE: ActionTemplate = {
  name: 'research',
  cost: 1,
  description: 'Investigate the goal.',
  agent: 'Odin',
  effect: 'context_gathered',
};

/** Action name -> base duration estimate (ms) for the duration rollup. */
const DURATION_MS: Record<ActionName, number> = {
  research: 30_000,
  analyze: 20_000,
  plan: 25_000,
  design: 60_000,
  build: 120_000,
  implement: 90_000,
  test: 60_000,
  review: 30_000,
  document: 30_000,
  deploy: 60_000,
  commit: 10_000,
};

/**
 * Light tokenization of a goal clause. We split on terminal
 * punctuation and the conjunctions "then", "and then", "after",
 * "before". Returns the trimmed clauses without empty fragments.
 */
export function splitGoalClauses(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  // Split on terminal punctuation AND on the conjunctions /, then,
  // and, after, before. The "and" split is intentional: a sentence
  // like "Design, build, test, and deploy" should produce 4 clauses.
  const separators = /[.;!?\n]|\bthen\b|\bafter that\b|\bafter\b|\bbefore\b|\band then\b|\s*,\s*|\band\b/gi;
  const parts = text.split(separators);
  // Collapse runs that contain a verb only (commas between verb-led
  // fragments) into separate clauses by splitting on whitespace as
  // a fallback for "Design, build, test, and deploy the API".
  const out: string[] = [];
  for (const part of parts) {
    const t = part.trim();
    if (!t) continue;
    // Heuristic: if the part has no verb-looking first word AND
    // contains a comma, split it again on commas.
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

/**
 * Strip a leading polite framing so the verb itself is what remains.
 * Examples handled: "please", "we should", "let's", "i want to",
 * "i need to", "can you", "could you", "would you", "help me",
 * "help us", "make sure to". Multiple polite layers can stack.
 */
function stripPolite(body: string): string {
  let out = body;
  // Repeat up to 4 times to handle stacked pleasantries.
  for (let i = 0; i < 4; i++) {
    const before = out;
    out = out.replace(
      /^(?:please\s+|kindly\s+)/i,
      '',
    );
    out = out.replace(
      /^(?:we should|let's|lets|i want to|i need to|i'd like to|i would like to|can you|could you|would you|help me|help us|make sure to|please)\s+/i,
      '',
    );
    if (out === before) break;
  }
  return out;
}

/**
 * Extract the leading verb from a clause, lowercased.
 */
export function extractVerb(clause: string): string {
  const trimmed = clause.trim();
  const body = stripPolite(trimmed);
  const firstWord = body.split(/\s+/)[0] || '';
  return firstWord.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Map a clause to an action template. Strips the verb to leave a
 * subject phrase used for the step title.
 */
export function clauseToAction(clause: string): ActionTemplate {
  const verb = extractVerb(clause);
  const template = VERB_TO_ACTION[verb] || FALLBACK_TEMPLATE;
  return template;
}

/**
 * Convert a clause into a step subject phrase (verb stripped).
 */
export function clauseSubject(clause: string): string {
  const trimmed = clause.trim();
  const body = stripPolite(trimmed);
  const stripped = body.replace(/^[a-zA-Z]+\s+/, '').trim();
  return stripped.length > 0 ? stripped : trimmed;
}

/**
 * A* search over the action space. State is the set of satisfied
 * effect flags. Goal state = a curated list of effect flags derived
 * from the action templates. Returns the sequence of step ids that
 * brings us from empty to goal state.
 *
 * For the Goal Planner we keep the state space tiny: at most one
 * flag per effect (key presence). The heuristic is the count of
 * unmet goal flags.
 */
function aStar(templateActions: ActionTemplate[], goalEffects: string[]): ActionTemplate[] {
  const goalSet = new Set(goalEffects);
  if (goalSet.size === 0) return templateActions.slice(0, 1);

  interface Node {
    satisfied: Set<string>;
    path: ActionTemplate[];
    cost: number;
  }

  const heuristic = (satisfied: Set<string>): number => {
    let unmet = 0;
    for (const g of goalSet) if (!satisfied.has(g)) unmet++;
    return unmet;
  };

  const start: Node = { satisfied: new Set(), path: [], cost: 0 };
  const open: Node[] = [start];
  const closed = new Set<string>();
  const keyOf = (s: Set<string>): string => Array.from(s).sort().join('|') || '∅';

  let best: Node = start;
  while (open.length) {
    // Pop the node with the lowest (cost + heuristic).
    open.sort((a, b) => (a.cost + heuristic(a.satisfied)) - (b.cost + heuristic(b.satisfied)));
    const node = open.shift() as Node;
    if (heuristic(node.satisfied) === 0) {
      return node.path;
    }
    if (heuristic(node.satisfied) < heuristic(best.satisfied)) {
      best = node;
    }
    const k = keyOf(node.satisfied);
    if (closed.has(k)) continue;
    closed.add(k);

    for (const action of templateActions) {
      // Skip if preconditions are not satisfied.
      const pre = action.preconditions || [];
      if (!pre.every((p) => node.satisfied.has(p))) continue;
      const next = new Set(node.satisfied);
      next.add(action.effect);
      const nextNode: Node = {
        satisfied: next,
        path: [...node.path, action],
        cost: node.cost + action.cost,
      };
      open.push(nextNode);
    }
  }

  return best.path;
}

/**
 * Plan a goal end-to-end. Returns a Plan with steps that have been
 * dep-linked and given stable ids. Pure function — does no I/O.
 */
export function planGoal(goalText: string, opts?: { maxSteps?: number }): Plan {
  const id = `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const clauses = splitGoalClauses(goalText);
  // If the user gave no clauses (e.g. an empty string), generate a
  // single fallback research step so the UI still has something to
  // show.
  const effectiveClauses = clauses.length > 0 ? clauses : [(goalText || 'Investigate the goal').trim()];

  // Map each clause to an action template.
  const rawTemplates = effectiveClauses.map(clauseToAction);
  const subjects = effectiveClauses.map(clauseSubject);

  // Deduplicate by action+subject signature.
  const seen = new Set<string>();
  const deduped: { template: ActionTemplate; subject: string }[] = [];
  for (let i = 0; i < rawTemplates.length; i++) {
    const t = rawTemplates[i];
    const subj = subjects[i] || `step ${i + 1}`;
    const sig = `${t.name}::${subj.toLowerCase().slice(0, 40)}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    deduped.push({ template: t, subject: subj });
  }

  // Cap step count to keep A* tractable and the UI sane.
  const maxSteps = opts?.maxSteps ?? 8;
  const trimmed = deduped.slice(0, maxSteps);

  // Derive the goal effect set as the union of effects from the
  // chosen templates. The planner will run A* over this set so we
  // include a sensible order.
  const goalEffects = trimmed.map((d) => d.template.effect);

  // Run A* on the trimmed templates. The action set the planner
  // considers is the same trimmed set (no external actions).
  const sequence = aStar(trimmed.map((d) => d.template), goalEffects);

  // Map each chosen template back to its subject for the title.
  // If A* skipped a template we still keep it (it may be a
  // sub-step needed for the dependency chain).
  const stepById = new Map<string, { template: ActionTemplate; subject: string }>();
  let stepCounter = 0;
  const allSteps: { template: ActionTemplate; subject: string }[] = trimmed;

  // Walk the sequence, assign ids, compute deps from the template's
  // preconditions (resolved against any earlier step that produces
  // the matching effect).
  const idByEffect = new Map<string, string>();
  const steps: PlannedStep[] = [];

  // First pass: assign ids in A* order so deps can resolve.
  for (const tpl of sequence) {
    const match = allSteps.find((s) => s.template === tpl);
    if (!match) continue;
    stepCounter += 1;
    const stepId = `s${stepCounter}`;
    const deps: string[] = [];
    for (const pre of tpl.preconditions || []) {
      const preId = idByEffect.get(pre);
      if (preId) deps.push(preId);
    }
    const titleBase = match.subject.charAt(0).toUpperCase() + match.subject.slice(1);
    steps.push({
      id: stepId,
      action: tpl.name,
      title: titleBase.length > 0 ? titleBase : tpl.name,
      agent: tpl.agent,
      description: tpl.description,
      effects: [tpl.effect],
      deps,
      status: 'pending',
      estimatedCost: tpl.cost,
      estimatedDurationMs: DURATION_MS[tpl.name] ?? 30_000,
    });
    idByEffect.set(tpl.effect, stepId);
  }

  // If A* returned zero steps (shouldn't happen, but be defensive),
  // fall back to the raw trimmed list so the UI never renders empty.
  if (steps.length === 0 && trimmed.length > 0) {
    let idx = 0;
    for (const { template, subject } of trimmed) {
      idx += 1;
      const stepId = `s${idx}`;
      const deps: string[] = [];
      for (const pre of template.preconditions || []) {
        const preId = idByEffect.get(pre);
        if (preId) deps.push(preId);
      }
      const titleBase = subject.charAt(0).toUpperCase() + subject.slice(1);
      steps.push({
        id: stepId,
        action: template.name,
        title: titleBase.length > 0 ? titleBase : template.name,
        agent: template.agent,
        description: template.description,
        effects: [template.effect],
        deps,
        status: 'pending',
        estimatedCost: template.cost,
        estimatedDurationMs: DURATION_MS[template.name] ?? 30_000,
      });
      idByEffect.set(template.effect, stepId);
    }
  }

  const totalCost = steps.reduce((sum, s) => sum + s.estimatedCost, 0);
  const totalDurationMs = steps.reduce((sum, s) => sum + s.estimatedDurationMs, 0);

  return {
    id,
    goal: goalText,
    steps,
    totalCost,
    totalDurationMs,
    goalEffects,
  };
}

/**
 * Helper used by the UI: returns the dependency edges as a flat list
 * of {from, to} pairs so the DependencyGraph panel can lay them out
 * without inspecting the planner internals.
 */
export function planDependencyEdges(plan: Plan): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (const step of plan.steps) {
    for (const dep of step.deps) {
      out.push({ from: dep, to: step.id });
    }
  }
  return out;
}

/**
 * Convenience: title-case the action verb so step labels look
 * pleasant in the UI.
 */
export function humanizeAction(action: ActionName): string {
  return action.charAt(0).toUpperCase() + action.slice(1);
}