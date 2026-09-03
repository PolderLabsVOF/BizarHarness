export const meta = {
  name: 'ultracode-review',
  description: 'Review a change across independent dimensions and adversarially verify every finding',
  whenToUse: 'Use for high-confidence review of a working diff, branch, pull request, or specified code scope.',
  phases: [
    { title: 'Review', detail: 'Inspect correctness, security, tests, and maintainability in parallel' },
    { title: 'Verify', detail: 'Try to refute every proposed finding before reporting it' },
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
const routeAgentType = (risk, role = 'todd') => WORKFLOW_ROUTING.agentTypes?.[routeModel(risk)]?.[({ 'research-analyst': 'greg', planner: 'paul', implementer: 'todd', 'qa-reviewer': 'linda', reviewer: 'linda' }[role] || role)] || ''
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

const TARGET = typeof args === 'string' ? args : args?.target || 'the current working diff'

const RUN_ID = 'ultracode-review'
const FINDINGS = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['summary', 'file', 'line', 'failureScenario'],
        properties: {
          summary: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'number' },
          failureScenario: { type: 'string' },
        },
      },
    },
  },
}
const VERDICT = {
  type: 'object',
  required: ['confirmed', 'reason'],
  properties: { confirmed: { type: 'boolean' }, reason: { type: 'string' } },
}
const lenses = [
  ['correctness', 'Find concrete logic, state, API, concurrency, and edge-case defects.'],
  ['security', 'Find concrete authorization, injection, secret, boundary, and unsafe-default defects.'],
  ['tests', 'Find behavior changes lacking regression coverage and tests that cannot prove their claim.'],
  ['maintainability', 'Find concrete integration breakage, duplicated mechanisms, dead paths, and lifecycle leaks.'],
]

// Map of lens -> role for the never-downgrade rule. Security and
// correctness are never-downgrade; the others carry the same risk label
// but with different capability floors.
const lensRole = {
  correctness: { role: 'adversarial', risk: 'high', capabilities: ['reasoning', 'structured-output'] },
  security: { role: 'security', risk: 'high', capabilities: ['reasoning', 'security'] },
  tests: { role: 'qa', risk: 'medium', capabilities: ['reasoning', 'structured-output'] },
  maintainability: { role: 'architect', risk: 'medium', capabilities: ['reasoning', 'architecture'] },
}

phase('Review')
const lensReviews = await parallel(lenses.map((lens) => () => dispatchAgent(agent, `reviewer-${lens[0]}`, `Review ${TARGET} through the ${lens[0]} lens. ${lens[1]} Report only actionable defects with a concrete failure scenario; do not praise or speculate.`, { ...lensRole[lens[0]], label: `review:${lens[0]}`, phase: 'Review', schema: FINDINGS })))
const findings = lensReviews.flatMap((review, index) => (review?.findings || []).slice(0, 12).map((finding) => ({ ...finding, lens: lenses[index][0] })))
const reviewed = await parallel(findings.map((finding, index) => () => dispatchAgent(agent, `finding-verifier-${index + 1}`, `Try to refute this proposed finding. Inspect the exact code path and reject it if it is speculative, pre-existing, unreachable, or already covered.\n${barrierRef({ runId: RUN_ID, phase: 'Review', label: `review:${finding.lens || 'mixed'}`, summary: `${finding.summary ? finding.summary.slice(0, 200) : `finding in ${finding.file}`}` }).promptBlock}`, { role: 'adversarial', risk: 'high', capabilities: ['reasoning', 'structured-output'], label: `verify:${index + 1}:${finding.file}`, phase: 'Verify', schema: VERDICT }).then((verdict) => ({ finding, verdict }))))

const verified = reviewed.filter(Boolean).filter((item) => item.verdict?.confirmed).map((item) => ({ ...item.finding, verification: item.verdict.reason }))
return { target: TARGET, findings: verified }
