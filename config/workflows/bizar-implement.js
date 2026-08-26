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
const scoped = await agent(`Extract 2-6 disjoint edit lanes for: ${TOPIC}\nProvided scope: ${JSON.stringify(SCOPE)}\nEach lane owns a non-overlapping file scope. Shared root/config/lock files must have one owner. Return lanes with name/scope/task.`, { label: 'scope-extract', phase: 'Scope', schema: LANES })
if (!scoped || !Array.isArray(scoped.lanes) || scoped.lanes.length === 0) {
  return { status: 'blocked', reason: 'Scope agent produced no lanes.' }
}
const lanes = scoped.lanes.slice(0, 6)
if (scoped.lanes.length > lanes.length) {
  log(`Bounded implementation to 6 of ${scoped.lanes.length} lanes.`)
}

phase('Implement')
const implementations = (await parallel(
  lanes.map((lane, index) => () => agent(
    `Implement this owned lane for the topic "${TOPIC}".\nLane: ${JSON.stringify(lane)}\nDo not edit outside the listed scope. Do not revert sibling work. Add regression tests and run the smallest relevant checks. Return changed files, commands, exact results, and blockers. Do not commit, push, publish, or deploy.`,
    { label: `implement:${index + 1}:${lane.name}`, phase: 'Implement', isolation: 'worktree' },
  )),
)).filter(Boolean)
if (implementations.length === 0) {
  return { status: 'blocked', reason: 'No implementation lane completed successfully.', scope: scoped }
}

phase('Barrier')
const merge = await agent(`Reconcile the lane outputs for topic "${TOPIC}" into one MERGE plan. Identify conflicts between worktrees, exact integration order, shared-file ownership, and any human approvals required.\nLanes: ${JSON.stringify(lanes)}\nImplementations: ${JSON.stringify(implementations)}`, { label: 'barrier-merge', phase: 'Barrier' })

phase('Verify')
const verify = await agent(`Re-check this MERGE plan against the original scope for topic "${TOPIC}". Reject it if any lane output is missing, any conflict is unresolved, or any test gate is unbounded. Return the verified plan plus the exact gating tests.\nScope: ${JSON.stringify(SCOPE)}\nMerge: ${String(merge)}`, { label: 'barrier-verify', phase: 'Verify' })

phase('Synthesis')
const synthesis = await agent(`Produce the final integration report for topic "${TOPIC}". State exact integration order, remaining gates, evidence commands to run, and any required human approvals. Do not claim success without fresh command evidence.\nMerge: ${String(merge)}\nVerify: ${String(verify)}`, { label: 'integration-report', phase: 'Synthesis' })

return {
  status: 'ready-for-integration',
  topic: TOPIC,
  lanes,
  implementations,
  barrier: merge,
  verify,
  synthesis,
}