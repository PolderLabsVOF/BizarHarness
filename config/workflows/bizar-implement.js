export const meta = {
  name: 'bizar-implement',
  description: 'Implement one bounded change in one worktree, or run explicitly supplied disjoint lanes concurrently',
  whenToUse: 'Use when implementation scope is understood and external research or root-cause discovery is unnecessary.',
  phases: [
    { title: 'Scope', detail: 'Independently confirm the local implementation boundary and risks' },
    { title: 'Plan', detail: 'Turn the bounded objective into owned edit lanes and checks' },
    { title: 'Implement', detail: 'Run isolated writers for the approved lanes' },
    { title: 'Review', detail: 'Independently verify each implementation result before integration' },
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
const routeAgentType = (_risk, role = 'todd') => ({ 'research-analyst': 'greg', planner: 'paul', architect: 'paul', implementer: 'todd', 'qa-reviewer': 'linda', reviewer: 'linda', adversarial: 'linda', security: 'linda', qa: 'linda' }[role] || role)
if (!routeModel('medium') || !routeModel('high') || !routeAgentType('medium') || !routeAgentType('high')) {
  return {
    status: 'blocked',
    reason: 'No generated Bizar model-agent mapping was supplied for workflow routing. Run bizar models and retry; provider defaults are prohibited.',
  }
}
let WORKFLOW_DISPATCH_SEQUENCE = 0
const dispatchAgent = (agentFn, agentName, prompt, opts = {}) => {
  const sequence = ++WORKFLOW_DISPATCH_SEQUENCE
  const prefix = `[Bizar dispatch ${sequence}: ${agentName}; role=${opts.role || 'worker'}; phase=${opts.phase || 'work'}; label=${opts.label || agentName}]`
  const agentOptions = {
    subagent_type: routeAgentType(opts.risk || 'medium', opts.role),
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
const SCOPE = (args && Array.isArray(args.scope)) ? args.scope : []
const suppliedLanes = (args && Array.isArray(args.lanes)) ? args.lanes : []
const fallbackLanes = [{ name: 'bounded-change', scope: SCOPE, task: TOPIC }]

phase('Scope')
const scopeEvidence = await parallel([
  () => dispatchAgent(agent, 'scope-researcher', `Confirm the smallest repository-local implementation boundary for "${TOPIC}". Identify existing code, tests, configuration, and reusable utilities. Do not edit.`, { role: 'research-analyst', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: 'scope-repository', phase: 'Scope' }),
  () => dispatchAgent(agent, 'scope-critic', `Independently challenge the assumed scope for "${TOPIC}". Identify hidden integration points, ownership conflicts, and the minimum regression evidence needed. Do not edit.`, { role: 'adversarial', risk: 'high', capabilities: ['structured-output', 'reasoning'], label: 'scope-risk', phase: 'Scope' }),
])
const scopeSummary = scopeEvidence.map((entry) => JSON.stringify(entry ?? '')).join('\n').slice(0, 4000)

phase('Plan')
const plan = await dispatchAgent(agent, 'bounded-planner', `Produce a minimal reversible plan for "${TOPIC}". Return disjoint edit lanes with a single owner for shared files, plus the smallest proving tests. Do not edit.\n${barrierRef({ phase: 'Scope', label: 'scope-evidence', summary: scopeSummary, payload: scopeEvidence }).promptBlock}`, { role: 'architect', risk: 'medium', capabilities: ['structured-output', 'reasoning', 'architecture'], label: 'plan', phase: 'Plan' })
const lanes = (suppliedLanes.length > 0
  ? suppliedLanes
  : (Array.isArray(plan?.lanes) && plan.lanes.length > 0 ? plan.lanes : fallbackLanes)
).slice(0, 6)

phase('Implement')
const runLane = (lane, index) => dispatchAgent(
  agent,
  `lane-implementer-${index + 1}`,
  `Implement this owned lane for the topic "${TOPIC}".\nLane: ${lane.name || `lane-${index + 1}`}\nTask: ${lane.task || TOPIC}\nWritable scope: ${Array.isArray(lane.scope) && lane.scope.length ? lane.scope.join(', ') : 'discover the smallest necessary scope, then keep it bounded'}\nDo not edit outside the lane's necessary scope. Do not revert sibling work. Add a regression test when behavior changes and run the smallest proving checks. Return changed files, commands, exact results, and blockers. Do not commit, push, publish, or deploy.`,
  { role: 'implementer', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: `implement:${index + 1}:${lane.name || 'bounded-change'}`, phase: 'Implement', isolation: 'worktree' },
)

const implementations = lanes.length === 1
  ? [await runLane(lanes[0], 0)]
  : await parallel(lanes.map((lane, index) => () => runLane(lane, index)))
const completed = implementations.filter(Boolean)

if (completed.length === 0) return { status: 'blocked', reason: 'No implementation lane completed successfully.', scopeEvidence, plan, lanes }

phase('Review')
const reviews = await parallel(completed.map((implementation, index) => () => dispatchAgent(
  agent,
  `implementation-reviewer-${index + 1}`,
  `Review implementation lane "${lanes[index]?.name || index + 1}" for "${TOPIC}". Verify scope, correctness, regression evidence, and integration assumptions. Report only actionable defects and required checks; do not edit.\n${barrierRef({ phase: 'Implement', label: `implement:${index + 1}:${lanes[index]?.name || 'bounded-change'}`, summary: typeof implementation === 'string' ? implementation.slice(0, 400) : 'implementation artifact', payload: implementation }).promptBlock}`,
  { role: 'adversarial', risk: 'high', capabilities: ['structured-output', 'reasoning'], label: `review:${index + 1}:${lanes[index]?.name || 'bounded-change'}`, phase: 'Review' },
)))

return {
  status: 'ready-for-integration',
  topic: TOPIC,
  scopeEvidence,
  plan,
  lanes,
  implementations: completed,
  reviews: reviews.filter(Boolean),
  next: 'Merge queued worktrees and run integration verification in the primary session.',
}
