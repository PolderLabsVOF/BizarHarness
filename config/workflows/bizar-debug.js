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
const initial = await agent(`Root-cause bug ${BUG_ID} with the cheapest discriminating experiment. Return {cause, experiment, predictedOutcome}. Do not propose a fix yet.`, { label: 'hypothesis:initial', phase: 'Hypothesis', schema: HYPOTHESIS })
iterations.push(initial)

let accepted = null
for (let i = 0; i < MAX_ITERATIONS; i++) {
  phase('AdversarialVerify')
  const verdict = await agent(`Refute the RCA hypothesis for bug ${BUG_ID}. Inspect the predicted experiment and reject it if it is speculative, pre-existing, unreachable, or already covered by an existing test.\nHypothesis: ${JSON.stringify(iterations[iterations.length - 1])}`, { label: `verify:${i + 1}`, phase: 'AdversarialVerify', schema: VERDICT })
  if (verdict && verdict.confirmed) {
    accepted = { iteration: i + 1, hypothesis: iterations[iterations.length - 1], verdict }
    break
  }
  if (i === MAX_ITERATIONS - 1) {
    log(`bizar-debug budget exhausted at ${MAX_ITERATIONS} iterations for ${BUG_ID}; surfacing unconfirmed hypothesis.`)
    break
  }
  phase('Loop')
  const refined = await agent(`The previous RCA hypothesis for bug ${BUG_ID} was not confirmed. Produce a refined hypothesis with a new cheapest discriminating experiment.\nPrior: ${JSON.stringify(iterations[iterations.length - 1])}\nRejection: ${JSON.stringify(verdict)}`, { label: `refine:${i + 1}`, phase: 'Loop', schema: HYPOTHESIS })
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
const fix = await agent(`Produce the smallest fix + regression test for bug ${BUG_ID} based on the accepted hypothesis. Do not commit, push, publish, or deploy.\nAccepted hypothesis: ${JSON.stringify(accepted.hypothesis)}`, { label: 'fix', phase: 'Fix' })

phase('Verify')
const verify = await agent(`Re-check the proposed fix for bug ${BUG_ID} against the regression test and adjacent paths. Reject the fix if it is unbounded, out of scope, or already covered.\nFix: ${String(fix)}`, { label: 'fix-verify', phase: 'Verify' })

return {
  status: 'dry',
  bug_id: BUG_ID,
  iterations: accepted.iteration,
  hypothesis: accepted.hypothesis,
  fix,
  verification: verify,
}