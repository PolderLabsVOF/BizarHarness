export const meta = {
  name: 'bizar-implement',
  description: 'Implement one bounded change in one worktree, or run explicitly supplied disjoint lanes concurrently',
  whenToUse: 'Use when implementation scope is understood and external research or root-cause discovery is unnecessary.',
  phases: [
    { title: 'Implement', detail: 'Run one isolated writer, or explicit disjoint writers concurrently' },
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
  return typeof candidate === 'string' ? candidate.trim() : ''
}
if (!routeModel('medium') || !routeModel('high')) {
  return {
    status: 'blocked',
    reason: 'No explicit configured Bizar model routing was supplied. Read the global Bizar model router and retry with args.routing; provider defaults are prohibited.',
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
const SCOPE = (args && Array.isArray(args.scope)) ? args.scope : []
const suppliedLanes = (args && Array.isArray(args.lanes)) ? args.lanes : []
const lanes = (suppliedLanes.length > 0
  ? suppliedLanes
  : [{ name: 'bounded-change', scope: SCOPE, task: TOPIC }]
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

if (completed.length === 0) {
  return { status: 'blocked', reason: 'No implementation lane completed successfully.', lanes }
}

return {
  status: 'ready-for-integration',
  topic: TOPIC,
  lanes,
  implementations: completed,
  next: 'Merge queued worktrees and run integration verification in the primary session.',
}
