export const meta = {
  name: 'ultracode',
  description: 'Research, design, implement, review, and verify a substantial engineering task with bounded multi-agent orchestration',
  whenToUse: 'Use for substantive changes that benefit from independent research, design, implementation, and adversarial verification.',
  phases: [
    { title: 'Research', detail: 'Map repository behavior and current official documentation' },
    { title: 'Design', detail: 'Generate and challenge an implementation plan' },
    { title: 'Implement', detail: 'Execute disjoint edit scopes in isolated worktrees' },
    { title: 'Verify', detail: 'Adversarially review and run evidence-driven checks' },
  ],
}

const TASK = typeof args === 'string' ? args : args?.task || JSON.stringify(args || {})
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
  () => agent(`Repository research for: ${TASK}. Map existing implementations, tests, constraints, and reusable utilities. Do not edit.`, { label: 'repository-map', phase: 'Research', schema: BRIEF }),
  () => agent(`Official-documentation research for: ${TASK}. Verify current external APIs/features from primary sources and identify version-sensitive constraints. Do not edit.`, { label: 'official-docs', phase: 'Research', schema: BRIEF }),
])).filter(Boolean)

if (research.length === 0) return { status: 'blocked', reason: 'No research agent completed successfully.' }

phase('Design')
const plan = await agent(`Design one reversible implementation for: ${TASK}\nResearch:\n${JSON.stringify(research)}\nReturn disjoint edit lanes. Shared root/config/lock files must have one owner. Include bounded tests and stop conditions.`, { label: 'plan', phase: 'Design', schema: PLAN })
if (!plan || !Array.isArray(plan.lanes) || plan.lanes.length === 0) return { status: 'blocked', reason: 'Planning produced no implementation lanes.', research }

const audit = await agent(`Adversarially review this plan for correctness, security, conflicting file ownership, missing regression tests, and unbounded retry loops. Return a corrected plan, not commentary. Task: ${TASK}\nPlan: ${JSON.stringify(plan)}`, { label: 'plan-audit', phase: 'Design', schema: PLAN })
const approved = audit || plan

phase('Implement')
const lanes = approved.lanes.slice(0, 8)
if (approved.lanes.length > lanes.length) log(`Bounded implementation to 8 of ${approved.lanes.length} lanes; ${approved.lanes.length - lanes.length} lanes were not dispatched.`)
const implementation = await pipeline(
  lanes,
  (lane, _original, index) => agent(`Implement this owned lane for the task "${TASK}".\nLane: ${JSON.stringify(lane)}\nDo not edit outside the listed scope. Do not revert sibling work. Add regression tests and run the smallest relevant checks. Return changed files, commands, exact results, and blockers. Do not commit, push, publish, or deploy.`, { label: `implement:${index + 1}:${lane.name}`, phase: 'Implement', isolation: 'worktree' }),
)
const completed = implementation.filter(Boolean)
if (completed.length === 0) return { status: 'blocked', reason: 'No implementation lane completed successfully.', plan: approved }

phase('Verify')
const reviews = await pipeline(
  completed,
  (result, _original, index) => agent(`Try to refute this implementation result for task "${TASK}". Check correctness, security, scope, test evidence, and integration assumptions. Return only verified findings and required checks.\nResult: ${String(result)}`, { label: `review:${index + 1}`, phase: 'Verify' }),
)
const final = await agent(`Synthesize a bounded integration and verification report for task "${TASK}". Do not claim success without fresh command evidence. Identify conflicts between worktrees, exact integration order, remaining gates, and any required human approvals.\nPlan: ${JSON.stringify(approved)}\nImplementations: ${JSON.stringify(completed)}\nReviews: ${JSON.stringify(reviews.filter(Boolean))}`, { label: 'final-verification', phase: 'Verify' })

return { status: 'ready-for-integration', task: TASK, research, plan: approved, implementation: completed, reviews: reviews.filter(Boolean), final }
