export const meta = {
  name: 'bizar-upgrade',
  description: 'Bounded major-version dependency upgrade with codemod, per-package compatibility research, parallel update lanes, and a multi-level regression gate.',
  whenToUse: 'Use when upgrading one package to a new major version with breaking changes, codemod application, per-package owner lanes, and a multi-level regression gate.',
  phases: [
    { title: 'Audit', detail: 'Parallel changelog research and peer-dependency graph audit' },
    { title: 'Plan', detail: 'Architect upgrade plan with rollback strategy and adversarial audit' },
    { title: 'Implement', detail: 'Parallel per-package upgrade lanes in isolated worktrees' },
    { title: 'Verify', detail: 'Multi-level regression gate: existing test suite plus upgrade matrix' },
    { title: 'Finalize', detail: 'Lockfile consolidation, upgrade spec doc, OpenKan evidence' },
  ],
}

const ROLE_TO_BIZAR_AGENT = Object.freeze({
  'research-analyst': 'greg', planner: 'paul', architect: 'paul', implementer: 'todd',
  'qa-reviewer': 'linda', reviewer: 'linda', adversarial: 'linda', security: 'linda', qa: 'linda',
})
function routeAgentType(role = 'todd') {
  return ROLE_TO_BIZAR_AGENT[role] || (Object.values(ROLE_TO_BIZAR_AGENT).includes(role) ? role : 'todd')
}

// Static alias ladder: haiku / sonnet / opus / fable. Ordinary research,
// audit, implementer, verify, and finalize lanes default to `sonnet`.
// The architect plan, plan-auditor, and any other high-risk lane
// escalate to `opus`. Callers may override with `opts.model` for any
// explicit per-lane escalation; non-ladder aliases are rejected.
const ALIAS_LADDER = Object.freeze(new Set(['haiku', 'sonnet', 'opus', 'fable']))
function pickAlias(risk) {
  return risk === 'high' ? 'opus' : 'sonnet'
}
let WORKFLOW_DISPATCH_SEQUENCE = 0
const dispatchAgent = (agentFn, agentName, prompt, opts = {}) => {
  const sequence = ++WORKFLOW_DISPATCH_SEQUENCE
  const model = opts.model || pickAlias(opts.risk || 'medium')
  if (opts.model && !ALIAS_LADDER.has(opts.model)) {
    throw new Error(`Invalid model alias: ${opts.model}; must be one of haiku, sonnet, opus, fable`)
  }
  const prefix = `[Bizar dispatch ${sequence}: ${agentName}; role=${opts.role || 'worker'}; phase=${opts.phase || 'work'}; label=${opts.label || agentName}]`
  const agentOptions = {
    subagent_type: routeAgentType(opts.role),
    model,
  }
  if (opts.schema) agentOptions.schema = opts.schema
  if (opts.isolation) agentOptions.isolation = opts.isolation
  if (opts.disallowedTools) agentOptions.disallowedTools = opts.disallowedTools
  if (opts.routingDecisionId) agentOptions.routingDecisionId = opts.routingDecisionId
  return agentFn(`${prefix}\n${prompt}`, agentOptions)
}
const barrierRef = ({ phase, label, summary }) => {
  const s = typeof summary === 'string' ? summary.slice(0, 1200) : ''
  return { promptBlock: `Prior phase: ${phase}; label: ${label}; summary: ${s}` }
}

const RAW_ARGS = (typeof args === 'object' && args !== null) ? args : {}
const RAW_STRING = typeof args === 'string' ? args : ''
const RAW_PACKAGE = RAW_ARGS.package
const RAW_TARGET = RAW_ARGS.targetMajor
const PACKAGE = (RAW_PACKAGE !== undefined && RAW_PACKAGE !== null) ? String(RAW_PACKAGE) : ((RAW_STRING.match(/^([^@]+)@/) || [])[1] || RAW_STRING)
const TARGET_MAJOR = (RAW_TARGET !== undefined && RAW_TARGET !== null) ? String(RAW_TARGET) : ((RAW_STRING.match(/^[^@]+@(\S+)/) || [])[1] || '')
const ROUTING_ID = (RAW_ARGS && typeof RAW_ARGS.routingDecisionId === 'string')
  ? RAW_ARGS.routingDecisionId
  : ''
const SUPPLIED_LANES = (RAW_ARGS && Array.isArray(RAW_ARGS.lanes)) ? RAW_ARGS.lanes : []
const TOPIC = PACKAGE && TARGET_MAJOR ? `${PACKAGE}@${TARGET_MAJOR}` : (PACKAGE || 'upgrade')
const RUN_ID = 'bizar-upgrade'

const AUDIT_RESULT = {
  type: 'object',
  required: ['summary', 'breakingChanges', 'peerDependencies', 'currentPins'],
  properties: {
    summary: { type: 'string' },
    breakingChanges: { type: 'array', items: { type: 'string' } },
    peerDependencies: { type: 'array', items: { type: 'string' } },
    currentPins: { type: 'object' },
  },
}

const UPGRADE_PLAN = {
  type: 'object',
  required: ['plan', 'codemodSteps', 'lanes', 'rollback', 'matrix'],
  properties: {
    plan: { type: 'string' },
    codemodSteps: { type: 'array', items: { type: 'string' } },
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
    rollback: { type: 'string' },
    matrix: { type: 'array', items: { type: 'string' } },
  },
}

phase('Audit')
const auditLanes = await parallel([
  () => dispatchAgent(
    agent,
    'changelog-researcher',
    `Research the changelog and release notes for ${PACKAGE} between current major and target major ${TARGET_MAJOR}. Document breaking changes, migration steps, and codemod availability with primary-source citations. Do not edit.`,
    { role: 'research-analyst', risk: 'medium', routingDecisionId: ROUTING_ID, capabilities: ['structured-output', 'reasoning', 'web-fetch'], label: 'changelog', phase: 'Audit', schema: AUDIT_RESULT },
  ),
  () => dispatchAgent(
    agent,
    'peer-deps-researcher',
    `Audit the peer-dependency graph for ${PACKAGE}. Identify every package that depends on ${PACKAGE} (directly or transitively), audit current pins, and flag conflicts with target major ${TARGET_MAJOR}. Do not edit.`,
    { role: 'research-analyst', risk: 'medium', routingDecisionId: ROUTING_ID, capabilities: ['structured-output', 'reasoning'], label: 'peer-deps', phase: 'Audit', schema: AUDIT_RESULT },
  ),
])
const completedAudit = auditLanes.filter(Boolean)
if (completedAudit.length === 0) return { status: 'blocked', reason: 'No audit lane completed successfully.' }

const auditSummary = `audit lanes: ${completedAudit.map((r) => (r && r.summary) ? r.summary.slice(0, 120) : '<lane>').join(' | ')}`

phase('Plan')
const plan = await dispatchAgent(
  agent,
  'upgrade-planner',
  `Design one bounded major-version upgrade plan for ${PACKAGE} to target major ${TARGET_MAJOR}. Return codemod steps, per-package owner lanes (single owner per package, disjoint writable scopes), rollback strategy, and the upgrade-matrix test scope. Do not edit.\n${barrierRef({ runId: RUN_ID, phase: 'Audit', label: 'audit', summary: auditSummary }).promptBlock}`,
  { role: 'architect', risk: 'high', routingDecisionId: ROUTING_ID, capabilities: ['structured-output', 'reasoning', 'architecture'], label: 'upgrade-plan', phase: 'Plan', schema: UPGRADE_PLAN },
)
if (!plan || !Array.isArray(plan.lanes) || plan.lanes.length === 0) {
  return { status: 'blocked', reason: 'Planning produced no upgrade lanes.', audit: completedAudit }
}

const planSummary = `upgrade lanes: ${plan.lanes.map((l) => l.name).join(', ')}`

const audited = await dispatchAgent(
  agent,
  'plan-auditor',
  `Adversarially review this major-version upgrade plan for ${PACKAGE} to ${TARGET_MAJOR}. Refute conflicting file ownership, missing codemod steps, missing rollback, missing upgrade-matrix scope, and unbounded retry loops. Return a corrected plan, not commentary.\n${barrierRef({ runId: RUN_ID, phase: 'Plan', label: 'upgrade-plan', summary: planSummary }).promptBlock}`,
  { role: 'adversarial', risk: 'high', routingDecisionId: ROUTING_ID, capabilities: ['structured-output', 'reasoning', 'architecture', 'security'], label: 'plan-audit', phase: 'Plan', schema: UPGRADE_PLAN },
)
const approved = audited || plan

phase('Implement')
const fallbackLanes = [{ name: PACKAGE || 'bounded-upgrade', scope: [], task: `Upgrade ${PACKAGE} to ${TARGET_MAJOR}` }]
const laneSource = SUPPLIED_LANES.length > 0
  ? SUPPLIED_LANES
  : (Array.isArray(approved.lanes) && approved.lanes.length > 0 ? approved.lanes : fallbackLanes)
const lanes = laneSource.slice(0, 6)
if (laneSource.length > lanes.length) log(`Bounded implementation to 6 of ${laneSource.length} lanes; ${laneSource.length - lanes.length} lanes were not dispatched.`)

const runLane = (lane, index) => dispatchAgent(
  agent,
  `upgrade-implementer-${index + 1}`,
  `Implement this owned package upgrade lane for ${PACKAGE} to ${TARGET_MAJOR}.\nLane: ${lane.name || `lane-${index + 1}`}\nTask: ${lane.task || `upgrade ${lane.name || `lane-${index + 1}`}`}\nWritable scope: ${Array.isArray(lane.scope) && lane.scope.length ? lane.scope.join(', ') : 'discover the smallest necessary scope, then keep it bounded'}\nApply the codemod, bump the version, update the manifest, and run the smallest proving checks. Do not edit outside the lane's necessary scope. Do not revert sibling work. Return changed files, commands, exact results, and blockers. Do not commit, push, publish, or deploy.\n${barrierRef({ runId: RUN_ID, phase: 'Plan', label: 'approved-plan', summary: planSummary }).promptBlock}`,
  { role: 'implementer', risk: 'medium', routingDecisionId: ROUTING_ID, capabilities: ['structured-output', 'reasoning'], label: `upgrade:${index + 1}:${lane.name || 'bounded-lane'}`, phase: 'Implement', isolation: 'worktree' },
)

const implementations = lanes.length === 1
  ? [await runLane(lanes[0], 0)]
  : await parallel(lanes.map((lane, index) => () => runLane(lane, index)))
const completed = implementations.filter(Boolean)
if (completed.length === 0) return { status: 'blocked', reason: 'No upgrade lane completed successfully.', plan: approved }

phase('Verify')
const verifyLanes = await parallel([
  () => dispatchAgent(
    agent,
    'test-suite-runner',
    `Run the existing test suite for the ${PACKAGE} ${TARGET_MAJOR} upgrade. Report per-package pass/fail status with exact commands and outputs. Do not edit.`,
    { role: 'qa-reviewer', risk: 'medium', routingDecisionId: ROUTING_ID, capabilities: ['structured-output', 'reasoning'], label: 'test-suite', phase: 'Verify' },
  ),
  () => dispatchAgent(
    agent,
    'upgrade-matrix-runner',
    `Run the upgrade-matrix smoke checks for the ${PACKAGE} ${TARGET_MAJOR} upgrade. Verify per-package compatibility, cross-package integration, and documented breaking-change expectations. Do not edit.`,
    { role: 'qa-reviewer', risk: 'medium', routingDecisionId: ROUTING_ID, capabilities: ['structured-output', 'reasoning'], label: 'upgrade-matrix', phase: 'Verify' },
  ),
])
const verifiedReviews = verifyLanes.filter(Boolean)

phase('Finalize')
const evidence = await dispatchAgent(
  agent,
  'finalizer',
  `Consolidate the upgrade work for ${PACKAGE} to ${TARGET_MAJOR}. Resolve peer-dependency conflicts in the lockfile. Produce docs/specs/upgrade-${PACKAGE}-${TARGET_MAJOR}.md with breaking-change status and per-package pass/fail evidence. Attach OpenKan evidence. Return {lockfile, evidence}.\n${barrierRef({ runId: RUN_ID, phase: 'Plan', label: 'approved-plan', summary: planSummary }).promptBlock}\n${barrierRef({ runId: RUN_ID, phase: 'Implement', label: 'upgrade:summary', summary: `${completed.length} lanes complete` }).promptBlock}\n${barrierRef({ runId: RUN_ID, phase: 'Verify', label: 'verify:summary', summary: `${verifiedReviews.length} verify lanes complete` }).promptBlock}`,
  { role: 'implementer', risk: 'medium', routingDecisionId: ROUTING_ID, capabilities: ['structured-output', 'reasoning'], label: 'finalize', phase: 'Finalize' },
)

return {
  status: 'ready-for-integration',
  topic: TOPIC,
  plan: approved,
  lanes,
  implementations: completed,
  reviews: { testSuite: verifiedReviews[0], upgradeMatrix: verifiedReviews[1] },
  evidence,
}
