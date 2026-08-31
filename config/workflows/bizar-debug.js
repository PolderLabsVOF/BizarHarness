import { randomUUID } from 'node:crypto'
import { dispatchAgent, writeArtifact, barrierRef } from './lib/dispatch.js'

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

const BUG_ID = typeof args === 'string'
  ? args
  : (args && typeof args.bug_id === 'string')
    ? args.bug_id
    : (args && typeof args.topic === 'string')
      ? args.topic
      : JSON.stringify(args || {})

// Phase B (v10.21.0) artifact-on-disk barriers: one runId per workflow
// invocation. Used by every writeArtifact() + barrierRef() in this script.
const RUN_ID = randomUUID()

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
const initial = await dispatchAgent(agent, 'rca-hypothesis', `Root-cause bug ${BUG_ID} with the cheapest discriminating experiment. Return {cause, experiment, predictedOutcome}. Do not propose a fix yet.`, { role: 'research-analyst', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: 'hypothesis:initial', phase: 'Hypothesis', schema: HYPOTHESIS })
iterations.push(initial)
// Phase B: persist initial hypothesis artifact.
writeArtifact({ runId: RUN_ID, phase: 'Hypothesis', label: 'hypothesis:initial', payload: initial, summary: initial?.cause ? initial.cause.slice(0, 200) : 'initial hypothesis', role: 'research-analyst' })

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
  // Phase B: persist refined hypothesis artifact.
  writeArtifact({ runId: RUN_ID, phase: 'Hypothesis', label: `refine:${i + 1}`, payload: refined, summary: refined?.cause ? refined.cause.slice(0, 200) : `refined iter ${i + 1}`, role: 'research-analyst' });
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
const fix = await dispatchAgent(agent, 'fix-author', `Produce the smallest fix + regression test for bug ${BUG_ID} based on the accepted hypothesis. Do not commit, push, publish, or deploy.\n${barrierRef({ runId: RUN_ID, phase: 'Hypothesis', label: 'hypothesis:initial', summary: accepted.hypothesis?.cause ? accepted.hypothesis.cause.slice(0, 200) : 'accepted hypothesis' }).promptBlock}`, { role: 'implementer', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: 'fix', phase: 'Fix' })
writeArtifact({ runId: RUN_ID, phase: 'Fix', label: 'fix', payload: fix, summary: typeof fix === 'string' ? fix.slice(0, 200) : 'fix proposed', role: 'implementer' })

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
