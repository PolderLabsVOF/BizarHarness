export const meta = {
  name: 'bizar-research',
  description: 'Research, plan, audit, and implement a bounded task across disjoint lanes with sequential pipeline verification',
  whenToUse: 'Use for substantive research-backed work that needs an explicit plan, an adversarial audit, and disjoint implementation lanes with sequential verification.',
  phases: [
    { title: 'Research', detail: 'Gather repository and primary-documentation evidence in parallel' },
    { title: 'Plan', detail: 'Design disjoint edit lanes with bounded tests' },
    { title: 'Audit', detail: 'Adversarially review the plan before any edit' },
    { title: 'Implement', detail: 'Execute disjoint lanes concurrently in worktrees' },
    { title: 'Verify', detail: 'Sequentially review and synthesize integration evidence' },
  ],
}

const TOPIC = typeof args === 'string'
  ? args
  : (args && typeof args.topic === 'string')
    ? args.topic
    : JSON.stringify(args || {})

const BRIEF = {
  type: 'object',
  required: ['summary', 'files', 'risks', 'verification'],
  properties: {
    summary: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    verification: { type: 'array', items: { type: 'string' } },
  },
}

const PLAN = {
  type: 'object',
  required: ['approach', 'lanes', 'gates'],
  properties: {
    approach: { type: 'string' },
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
    gates: { type: 'array', items: { type: 'string' } },
  },
}

phase('Research')
const research = (await parallel([
  () => agent(`Repository research for: ${TOPIC}. Map existing implementations, tests, constraints, and reusable utilities. Do not edit.`, { label: 'repository-map', phase: 'Research', schema: BRIEF }),
  () => agent(`Official-documentation research for: ${TOPIC}. Verify current external APIs/features from primary sources and identify version-sensitive constraints. Do not edit.`, { label: 'official-docs', phase: 'Research', schema: BRIEF }),
])).filter(Boolean)

if (research.length === 0) return { status: 'blocked', reason: 'No research agent completed successfully.' }

phase('Plan')
const plan = await agent(`Design one reversible implementation for: ${TOPIC}\nResearch:\n${JSON.stringify(research)}\nReturn disjoint edit lanes. Shared root/config/lock files must have one owner. Include bounded tests and stop conditions.`, { label: 'plan', phase: 'Plan', schema: PLAN })
if (!plan || !Array.isArray(plan.lanes) || plan.lanes.length === 0) {
  return { status: 'blocked', reason: 'Planning produced no implementation lanes.', research }
}

phase('Audit')
const audit = await agent(`Adversarially review this plan for correctness, security, conflicting file ownership, missing regression tests, and unbounded retry loops. Return a corrected plan, not commentary. Topic: ${TOPIC}\nPlan: ${JSON.stringify(plan)}`, { label: 'plan-audit', phase: 'Audit', schema: PLAN })
const approved = audit || plan

phase('Implement')
const lanes = approved.lanes.slice(0, 8)
if (approved.lanes.length > lanes.length) {
  log(`Bounded implementation to 8 of ${approved.lanes.length} lanes; ${approved.lanes.length - lanes.length} lanes were not dispatched.`)
}
const implementation = await parallel(
  lanes.map((lane, index) => () => agent(
    `Implement this owned lane for the topic "${TOPIC}".\nLane: ${JSON.stringify(lane)}\nDo not edit outside the listed scope. Do not revert sibling work. Add regression tests and run the smallest relevant checks. Return changed files, commands, exact results, and blockers. Do not commit, push, publish, or deploy.`,
    { label: `implement:${index + 1}:${lane.name}`, phase: 'Implement', isolation: 'worktree' },
  )),
)
const completed = implementation.filter(Boolean)
if (completed.length === 0) {
  return { status: 'blocked', reason: 'No implementation lane completed successfully.', plan: approved }
}

phase('Verify')
const reviews = await pipeline(
  completed,
  (result, _original, index) => agent(
    `Try to refute this implementation result for topic "${TOPIC}". Check correctness, security, scope, test evidence, and integration assumptions. Return only verified findings and required checks.\nResult: ${String(result)}`,
    { label: `review:${index + 1}`, phase: 'Verify' },
  ),
)
const final = await agent(`Synthesize a bounded integration and verification report for topic "${TOPIC}". Do not claim success without fresh command evidence. Identify conflicts between worktrees, exact integration order, remaining gates, and any required human approvals.\nPlan: ${JSON.stringify(approved)}\nImplementations: ${JSON.stringify(completed)}\nReviews: ${JSON.stringify(reviews.filter(Boolean))}`, { label: 'final-verification', phase: 'Verify' })

return { status: 'ready-for-integration', topic: TOPIC, research, plan: approved, implementation: completed, reviews: reviews.filter(Boolean), final }