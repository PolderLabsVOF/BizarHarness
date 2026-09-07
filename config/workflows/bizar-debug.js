export const meta = {
  name: 'bizar-debug',
  description: 'Root-cause a bug with bounded loop-until-dry: RCA hypothesis, adversarial verification, smallest fix, regression test',
  whenToUse: 'Use when a bug report needs a defended root-cause hypothesis, the smallest fix with a regression test, and a bounded retry loop if the hypothesis does not survive adversarial verification.',
  phases: [
    { title: 'Hypothesis', detail: 'Cheapest discriminating RCA hypothesis' },
    { title: 'AdversarialVerify', detail: 'Refute the hypothesis before accepting it' },
    { title: 'Loop', detail: 'Bounded iteration if verification fails (cap=3)' },
    { title: 'Fix', detail: 'Smallest fix + regression test' },
    { title: 'Verify', detail: 'Re-check the fix on the regression test and adjacent paths' },
  ],
}

const ROLE_TO_BIZAR_AGENT = Object.freeze({
  'research-analyst': 'greg', planner: 'paul', architect: 'paul', implementer: 'todd',
  'qa-reviewer': 'linda', reviewer: 'linda', adversarial: 'linda', security: 'linda', qa: 'linda',
})
function routeAgentType(role = 'todd') {
  return ROLE_TO_BIZAR_AGENT[role] || (Object.values(ROLE_TO_BIZAR_AGENT).includes(role) ? role : 'todd')
}
// Static alias policy: debug is hard. RCA hypothesis, fix, and
// verification lanes use `opus`; the loop's refine pass defaults to
// `sonnet` because it is the cheapest discriminating RCA after the
// initial hypothesis was rejected. Callers may override with
// `opts.model` when a lane is explicitly hard.
function pickAlias(risk) {
  return risk === 'high' ? 'opus' : 'sonnet'
}
let WORKFLOW_DISPATCH_SEQUENCE = 0
const dispatchAgent = (agentFn, agentName, prompt, opts = {}) => {
  const sequence = ++WORKFLOW_DISPATCH_SEQUENCE
  const prefix = `[Bizar dispatch ${sequence}: ${agentName}; role=${opts.role || 'worker'}; phase=${opts.phase || 'work'}; label=${opts.label || agentName}]`
  const agentOptions = {
    subagent_type: routeAgentType(opts.role),
    model: opts.model || pickAlias(opts.risk || 'medium'),
  }
  if (opts.schema) agentOptions.schema = opts.schema
  if (opts.isolation) agentOptions.isolation = opts.isolation
  if (opts.disallowedTools) agentOptions.disallowedTools = opts.disallowedTools
  return agentFn(`${prefix}\n${prompt}`, agentOptions)
}
const barrierRef = ({ phase, label, summary }) => {
  const s = typeof summary === 'string' ? summary.slice(0, 1200) : ''
  return { promptBlock: `Prior phase: ${phase}; label: ${label}; summary: ${s}` }
}

const BUG_ID = typeof args === 'string'
  ? args
  : (args && typeof args.bug_id === 'string')
    ? args.bug_id
    : (args && typeof args.topic === 'string')
      ? args.topic
      : String(args || '')

const RUN_ID = 'bizar-debug'

const HYPOTHESIS = {
  type: 'object',
  required: ['cause', 'experiment', 'predictedOutcome'],
  properties: {
    cause: { type: 'string' },
    experiment: { type: 'string' },
    predictedOutcome: { type: 'string' },
  },
}

const VERDICT = {
  type: 'object',
  required: ['confirmed', 'reason'],
  properties: { confirmed: { type: 'boolean' }, reason: { type: 'string' } },
}

const MAX_ITERATIONS = 3
const iterations = []

phase('Hypothesis')
const initial = await dispatchAgent(agent, 'rca-hypothesis', `Root-cause bug ${BUG_ID} with the cheapest discriminating experiment. Return {cause, experiment, predictedOutcome}. Do not propose a fix yet.`, { role: 'research-analyst', risk: 'medium', model: 'opus', capabilities: ['structured-output', 'reasoning'], label: 'hypothesis:initial', phase: 'Hypothesis', schema: HYPOTHESIS })
iterations.push(initial)

let accepted = null
for (let i = 0; i < MAX_ITERATIONS; i++) {
  phase('AdversarialVerify')
  const prior = iterations[iterations.length - 1];
  const priorLabel = i === 0 ? 'hypothesis:initial' : `refine:${i}`;
  const verdict = await dispatchAgent(agent, 'rca-verifier', `Refute the RCA hypothesis for bug ${BUG_ID}. Inspect the predicted experiment and reject it if it is speculative, pre-existing, unreachable, or already covered by an existing test.\n${barrierRef({ runId: RUN_ID, phase: 'Hypothesis', label: priorLabel, summary: prior?.cause ? prior.cause.slice(0, 200) : `hypothesis iter ${i + 1}` }).promptBlock}`, { role: 'adversarial', risk: 'high', capabilities: ['structured-output', 'reasoning'], label: `verify:${i + 1}`, phase: 'AdversarialVerify', schema: VERDICT })
  if (verdict && verdict.confirmed) {
    accepted = { iteration: i + 1, hypothesis: iterations[iterations.length - 1], verdict }
    break
  }
  if (i === MAX_ITERATIONS - 1) {
    log(`bizar-debug budget exhausted at ${MAX_ITERATIONS} iterations for ${BUG_ID}; surfacing unconfirmed hypothesis.`)
    break
  }
  phase('Loop')
  const refined = await dispatchAgent(agent, 'rca-refiner', `The previous RCA hypothesis for bug ${BUG_ID} was not confirmed. Produce a refined hypothesis with a new cheapest discriminating experiment.\n${barrierRef({ runId: RUN_ID, phase: 'Hypothesis', label: priorLabel, summary: prior?.cause ? prior.cause.slice(0, 200) : `prior iter ${i + 1}` }).promptBlock}\n${barrierRef({ runId: RUN_ID, phase: 'AdversarialVerify', label: `verify:${i + 1}`, summary: verdict?.reason ? verdict.reason.slice(0, 200) : 'no confirmation' }).promptBlock}`, { role: 'research-analyst', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: `refine:${i + 1}`, phase: 'Loop', schema: HYPOTHESIS })
  iterations.push(refined)
}

if (!accepted) {
  return {
    status: 'budget-exhausted',
    bug_id: BUG_ID,
    iterations,
    reason: `Hypothesis did not survive adversarial verification in ${MAX_ITERATIONS} iterations.`,
  }
}

phase('Fix')
const fix = await dispatchAgent(agent, 'fix-author', `Implement the smallest fix + regression test for bug ${BUG_ID} based on the accepted hypothesis. Edit and test in your isolated worktree. Do not commit, push, publish, or deploy.\n${barrierRef({ runId: RUN_ID, phase: 'Hypothesis', label: 'hypothesis:initial', summary: accepted.hypothesis?.cause ? accepted.hypothesis.cause.slice(0, 200) : 'accepted hypothesis' }).promptBlock}`, { role: 'implementer', risk: 'medium', model: 'opus', capabilities: ['structured-output', 'reasoning'], label: 'fix', phase: 'Fix', isolation: 'worktree' })

phase('Verify')
const verify = await dispatchAgent(agent, 'fix-verifier', `Re-check the proposed fix for bug ${BUG_ID} against the regression test and adjacent paths. Reject the fix if it is unbounded, out of scope, or already covered.\n${barrierRef({ runId: RUN_ID, phase: 'Fix', label: 'fix', summary: typeof fix === 'string' ? fix.slice(0, 200) : 'fix artifact' }).promptBlock}`, { role: 'adversarial', risk: 'high', capabilities: ['structured-output', 'reasoning'], label: 'fix-verify', phase: 'Verify' })

return {
  status: 'dry',
  bug_id: BUG_ID,
  iterations: accepted.iteration,
  hypothesis: accepted.hypothesis,
  fix,
  verification: verify,
}
