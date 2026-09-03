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

const WORKFLOW_INPUT = args && typeof args === 'object' ? args : {}
const WORKFLOW_ROUTING = WORKFLOW_INPUT.routing && typeof WORKFLOW_INPUT.routing === 'object'
  ? WORKFLOW_INPUT.routing
  : {}
const WORKFLOW_DEFAULT_MODEL = typeof WORKFLOW_INPUT.model === 'string'
  ? WORKFLOW_INPUT.model.trim()
  : Array.isArray(WORKFLOW_INPUT.models) && typeof WORKFLOW_INPUT.models[0] === 'string'
    ? WORKFLOW_INPUT.models[0].trim()
    : ''
const routeModel = (risk) => {
  const candidate = WORKFLOW_ROUTING[risk] || WORKFLOW_ROUTING.default || WORKFLOW_DEFAULT_MODEL
  if (typeof candidate !== 'string') return ''
  const selected = candidate.trim()
  return selected
}
if (!routeModel('medium') || !routeModel('high')) {
  return {
    status: 'blocked',
    reason: 'No explicit enabled Bizar model was supplied for workflow routing. Read the global model router and retry with args.routing; provider defaults are prohibited.',
  }
}
let WORKFLOW_DISPATCH_SEQUENCE = 0
const dispatchAgent = (agentFn, agentName, prompt, opts = {}) => {
  const sequence = ++WORKFLOW_DISPATCH_SEQUENCE
  const prefix = `[Bizar dispatch ${sequence}: ${agentName}; role=${opts.role || 'worker'}; phase=${opts.phase || 'work'}; label=${opts.label || agentName}]`
  const agentOptions = {
    model: routeModel(opts.risk || 'medium'),
    effort: opts.risk === 'high' ? 'high' : 'medium',
  }
  if (opts.schema) agentOptions.schema = opts.schema
  if (opts.isolation) agentOptions.isolation = opts.isolation
  if (opts.disallowedTools) agentOptions.disallowedTools = opts.disallowedTools
  return agentFn(`${prefix}\n${prompt}`, agentOptions)
}
const barrierRef = ({ phase, label, summary, payload }) => {
  let evidence = ''
  try { evidence = JSON.stringify(payload ?? '').slice(0, 12000) } catch { evidence = '<unserializable>' }
  return { promptBlock: `Prior phase: ${phase}; label: ${label}; summary: ${summary || ''}\nBounded evidence: ${evidence}` }
}

const TOPIC = typeof args === 'string'
  ? args
  : (args && typeof args.topic === 'string')
    ? args.topic
    : JSON.stringify(args || {})

const RUN_ID = 'bizar-research'

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
  () => dispatchAgent(agent, 'repo-researcher', `Repository research for: ${TOPIC}. Map existing implementations, tests, constraints, and reusable utilities. Do not edit.`, { role: 'research-analyst', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: 'repository-map', phase: 'Research', schema: BRIEF }),
  () => dispatchAgent(agent, 'docs-researcher', `Official-documentation research for: ${TOPIC}. Verify current external APIs/features from primary sources and identify version-sensitive constraints. Do not edit.`, { role: 'research-analyst', risk: 'medium', capabilities: ['structured-output', 'reasoning', 'web-fetch'], label: 'official-docs', phase: 'Research', schema: BRIEF }),
])).filter(Boolean)

if (research.length === 0) return { status: 'blocked', reason: 'No research agent completed successfully.' }

const researchSummary = `research lanes: ${research.map((r) => (r && r.summary) ? r.summary.slice(0, 80) : '<lane>').join(' | ')}`

phase('Plan')
const plan = await dispatchAgent(agent, 'plan-author', `Design one reversible implementation for: ${TOPIC}\n${barrierRef({ runId: RUN_ID, phase: 'Research', label: 'barrier', summary: researchSummary }).promptBlock}\nReturn disjoint edit lanes. Shared root/config/lock files must have one owner. Include bounded tests and stop conditions.`, { role: 'architect', risk: 'medium', capabilities: ['structured-output', 'reasoning', 'architecture'], label: 'plan', phase: 'Plan', schema: PLAN })
if (!plan || !Array.isArray(plan.lanes) || plan.lanes.length === 0) {
  return { status: 'blocked', reason: 'Planning produced no implementation lanes.', research }
}

const planSummary = `plan lanes: ${plan.lanes.map((l) => l.name).join(', ')}`

phase('Audit')
const audit = await dispatchAgent(agent, 'plan-auditor', `Adversarially review this plan for correctness, security, conflicting file ownership, missing regression tests, and unbounded retry loops. Return a corrected plan, not commentary. Topic: ${TOPIC}\n${barrierRef({ runId: RUN_ID, phase: 'Plan', label: 'barrier', summary: planSummary }).promptBlock}`, { role: 'adversarial', risk: 'high', capabilities: ['structured-output', 'reasoning', 'architecture', 'security'], label: 'plan-audit', phase: 'Audit', schema: PLAN })
const approved = audit || plan

phase('Implement')
const lanes = approved.lanes.slice(0, 8)
if (approved.lanes.length > lanes.length) {
  log(`Bounded implementation to 8 of ${approved.lanes.length} lanes; ${approved.lanes.length - lanes.length} lanes were not dispatched.`)
}
const implementation = await parallel(
  lanes.map((lane, index) => () => dispatchAgent(
    agent,
    `lane-implementer-${index + 1}`,
    `Implement this owned lane for the topic "${TOPIC}".\n${barrierRef({ runId: RUN_ID, phase: 'Plan', label: 'barrier', summary: `lane ${lane.name}: ${lane.task.slice(0, 120)}` }).promptBlock}\nDo not edit outside the listed scope. Do not revert sibling work. Add regression tests and run the smallest relevant checks. Return changed files, commands, exact results, and blockers. Do not commit, push, publish, or deploy.`,
    { role: 'implementer', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: `implement:${index + 1}:${lane.name}`, phase: 'Implement', isolation: 'worktree' },
  )),
)
const completed = implementation.filter(Boolean)
if (completed.length === 0) {
  return { status: 'blocked', reason: 'No implementation lane completed successfully.', plan: approved }
}

phase('Verify')
const reviews = await pipeline(
  completed,
  (result, _original, index) => dispatchAgent(
    agent,
    `reviewer-${index + 1}`,
    `Try to refute this implementation result for topic "${TOPIC}". Check correctness, security, scope, test evidence, and integration assumptions. Return only verified findings and required checks.\n${barrierRef({ runId: RUN_ID, phase: 'Implement', label: `implement:${index + 1}:${lanes[index]?.name || ''}`, summary: `review of lane ${lanes[index]?.name || index + 1}` }).promptBlock}`,
    { role: 'adversarial', risk: 'high', capabilities: ['structured-output', 'reasoning'], label: `review:${index + 1}`, phase: 'Verify' },
  ),
)
const verifiedReviews = reviews.filter(Boolean);
const final = await dispatchAgent(agent, 'final-verifier', `Synthesize a bounded integration and verification report for topic "${TOPIC}". Do not claim success without fresh command evidence. Identify conflicts between worktrees, exact integration order, remaining gates, and any required human approvals.\n${barrierRef({ runId: RUN_ID, phase: 'Plan', label: 'barrier', summary: `approved plan with ${approved.lanes.length} lanes` }).promptBlock}\n${barrierRef({ runId: RUN_ID, phase: 'Implement', label: 'implement:summary', summary: `${completed.length} lanes complete` }).promptBlock}\n${barrierRef({ runId: RUN_ID, phase: 'Verify', label: 'review:summary', summary: `${verifiedReviews.length} reviews complete` }).promptBlock}`, { role: 'implementer', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: 'final-verification', phase: 'Verify' })

return { status: 'ready-for-integration', topic: TOPIC, research, plan: approved, implementation: completed, reviews: reviews.filter(Boolean), final }
