export const meta = {
  name: 'ultracode-review',
  description: 'Review a change across independent dimensions and adversarially verify every finding',
  whenToUse: 'Use for high-confidence review of a working diff, branch, pull request, or specified code scope.',
  phases: [
    { title: 'Review', detail: 'Inspect correctness, security, tests, and maintainability in parallel' },
    { title: 'Verify', detail: 'Try to refute every proposed finding before reporting it' },
  ],
}

const ROLE_TO_BIZAR_AGENT = Object.freeze({
  'research-analyst': 'greg', planner: 'paul', architect: 'paul', implementer: 'todd',
  'qa-reviewer': 'linda', reviewer: 'linda', adversarial: 'linda', security: 'linda', qa: 'linda',
})
function routeAgentType(role = 'todd') {
  return ROLE_TO_BIZAR_AGENT[role] || (Object.values(ROLE_TO_BIZAR_AGENT).includes(role) ? role : 'todd')
}
// Static alias policy: review is by definition adversarial/hard. Every
// lens — correctness, security, tests, maintainability — and every
// finding-verifier lane uses `opus`. Callers may override with
// `opts.model` for any explicit per-lane exception.
function pickAlias(_risk) {
  return 'opus'
}
let WORKFLOW_DISPATCH_SEQUENCE = 0
const dispatchAgent = (agentFn, agentName, prompt, opts = {}) => {
  const sequence = ++WORKFLOW_DISPATCH_SEQUENCE
  const prefix = `[Bizar dispatch ${sequence}: ${agentName}; role=${opts.role || 'worker'}; phase=${opts.phase || 'work'}; label=${opts.label || agentName}]`
  const agentOptions = {
    subagent_type: routeAgentType(opts.role),
    model: opts.model || pickAlias(opts.risk || 'medium'),
  }
  if (opts.schema) agentOptions.schema = opts.schema
  if (opts.isolation) agentOptions.isolation = opts.isolation
  if (opts.disallowedTools) agentOptions.disallowedTools = opts.disallowedTools
  return agentFn(`${prefix}\n${prompt}`, agentOptions)
}
const barrierRef = ({ phase, label, summary }) => {
  const s = typeof summary === 'string' ? summary.slice(0, 1200) : ''
  return { promptBlock: `Prior phase: ${phase}; label: ${label}; summary: ${s}` }
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
