import { randomUUID } from 'node:crypto'
import { dispatchAgent, writeArtifact, barrierRef } from './lib/dispatch.js'

export const meta = {
  name: 'bizar-implement',
  description: 'Run disjoint implementation lanes concurrently, barrier-merge their results, and synthesize an integration report without sequential pipeline stages',
  whenToUse: 'Use when the scope is already understood, lanes can be drawn up front, and a single barrier agent can reconcile the work before final synthesis. Parallel-only — no sequential pipeline stages.',
  phases: [
    { title: 'Scope', detail: 'Extract disjoint lanes from the supplied scope' },
    { title: 'Implement', detail: 'Run lanes concurrently in worktrees' },
    { title: 'Barrier', detail: 'A single agent reconciles all lane outputs' },
    { title: 'Verify', detail: 'A single agent re-checks the barrier plan against the scope' },
    { title: 'Synthesis', detail: 'A single integration agent produces the final report' },
  ],
}

const TOPIC = typeof args === 'string'
  ? args
  : (args && typeof args.topic === 'string')
    ? args.topic
    : JSON.stringify(args || {})
const SCOPE = (args && Array.isArray(args.scope)) ? args.scope : []

// Phase B (v10.21.0) artifact-on-disk barriers: one runId per workflow
// invocation. Used by every writeArtifact() + barrierRef() in this script.
const RUN_ID = randomUUID()

const LANES = {
  type: 'object',
  required: ['lanes'],
  properties: {
    lanes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'scope', 'task'],
        properties: {
          name: { type: 'string' },
          scope: { type: 'array', items: { type: 'string' } },
          task: { type: 'string' },
        },
      },
    },
  },
}

phase('Scope')
const scoped = await dispatchAgent(agent, 'scope-extractor', `Extract 2-6 disjoint edit lanes for: ${TOPIC}\nProvided scope: ${SCOPE.length ? SCOPE.join(', ') : '(none supplied)'}\nEach lane owns a non-overlapping file scope. Shared root/config/lock files must have one owner. Return lanes with name/scope/task.`, { role: 'implementer', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: 'scope-extract', phase: 'Scope', schema: LANES })
if (!scoped || !Array.isArray(scoped.lanes) || scoped.lanes.length === 0) {
  return { status: 'blocked', reason: 'Scope agent produced no lanes.' }
}
// Phase B: persist the scope artifact for the next barrier agent.
const scopeSummary = `scope lanes: ${scoped.lanes.map((l) => l.name).join(', ')}`
writeArtifact({ runId: RUN_ID, phase: 'Scope', label: 'barrier', payload: scoped, summary: scopeSummary, role: 'implementer' })
const lanes = scoped.lanes.slice(0, 6)
if (scoped.lanes.length > lanes.length) {
  log(`Bounded implementation to 6 of ${scoped.lanes.length} lanes.`)
}

phase('Implement')
const implementations = (await parallel(
  lanes.map((lane, index) => () => dispatchAgent(
    agent,
    `lane-implementer-${index + 1}`,
    `Implement this owned lane for the topic "${TOPIC}".\n${barrierRef({ runId: RUN_ID, phase: 'Scope', label: 'barrier', summary: `lane ${lane.name}: ${lane.task.slice(0, 120)}` }).promptBlock}\nDo not edit outside the listed scope. Do not revert sibling work. Add regression tests and run the smallest relevant checks. Return changed files, commands, exact results, and blockers. Do not commit, push, publish, or deploy.`,
    { role: 'implementer', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: `implement:${index + 1}:${lane.name}`, phase: 'Implement', isolation: 'worktree' },
  )),
)).filter(Boolean)
if (implementations.length === 0) {
  return { status: 'blocked', reason: 'No implementation lane completed successfully.', scope: scoped }
}
// Phase B: persist each implementation artifact.
for (let i = 0; i < implementations.length; i++) {
  const lane = lanes[i];
  const label = `implement:${i + 1}:${lane.name}`;
  const summary = `lane ${lane.name} files: ${(implementations[i]?.files || []).slice(0, 5).join(', ')}`;
  writeArtifact({ runId: RUN_ID, phase: 'Implement', label, payload: implementations[i], summary, role: 'implementer' });
}

phase('Barrier')
const merge = await dispatchAgent(agent, 'barrier-merger', `Reconcile the lane outputs for topic "${TOPIC}" into one MERGE plan. Identify conflicts between worktrees, exact integration order, shared-file ownership, and any human approvals required.\n${barrierRef({ runId: RUN_ID, phase: 'Implement', label: 'implement:summary', summary: `${implementations.length} lanes complete across ${lanes.length} planned` }).promptBlock}`, { role: 'implementer', risk: 'high', capabilities: ['structured-output', 'reasoning', 'architecture'], label: 'barrier-merge', phase: 'Barrier' })
writeArtifact({ runId: RUN_ID, phase: 'Barrier', label: 'barrier', payload: merge, summary: typeof merge === 'string' ? merge.slice(0, 200) : `barrier merge complete`, role: 'implementer' })

phase('Verify')
const verify = await dispatchAgent(agent, 'barrier-verifier', `Re-check this MERGE plan against the original scope for topic "${TOPIC}". Reject it if any lane output is missing, any conflict is unresolved, or any test gate is unbounded. Return the verified plan plus the exact gating tests.\n${barrierRef({ runId: RUN_ID, phase: 'Barrier', label: 'barrier', summary: `verify against scope: ${SCOPE.length} scope items` }).promptBlock}`, { role: 'adversarial', risk: 'high', capabilities: ['structured-output', 'reasoning'], label: 'barrier-verify', phase: 'Verify' })

phase('Synthesis')
const synthesis = await dispatchAgent(agent, 'integration-reporter', `Produce the final integration report for topic "${TOPIC}". State exact integration order, remaining gates, evidence commands to run, and any required human approvals. Do not claim success without fresh command evidence.\n${barrierRef({ runId: RUN_ID, phase: 'Barrier', label: 'barrier', summary: `merge plan: ${typeof merge === 'string' ? merge.slice(0, 120) : 'complex'}` }).promptBlock}\n${barrierRef({ runId: RUN_ID, phase: 'Verify', label: 'barrier-verify', summary: typeof verify === 'string' ? verify.slice(0, 120) : 'verified' }).promptBlock}`, { role: 'implementer', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: 'integration-report', phase: 'Synthesis' })

return {
  status: 'ready-for-integration',
  topic: TOPIC,
  lanes,
  implementations,
  barrier: merge,
  verify,
  synthesis,
}
