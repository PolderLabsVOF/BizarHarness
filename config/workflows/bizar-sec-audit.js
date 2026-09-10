export const meta = {
  name: 'bizar-sec-audit',
  description: 'Multi-dimensional security audit: STRIDE-style threat model plus four specialist lenses with verifier-of-finder refutation and optional fix-lane dispatch',
  whenToUse: 'Use for a security audit of a working diff, branch, pull request, or specified code scope where independent threat-model, lens, and adversarial-verification lanes are warranted.',
  phases: [
    { title: 'Threat-Model', detail: 'Produce a STRIDE-style mini-threat-model of the target' },
    { title: 'Lenses', detail: 'Run four specialist security lenses (authz, secret, supply-chain, runtime) in parallel' },
    { title: 'Verify', detail: 'Refute every proposed finding independently before reporting' },
    { title: 'Fix-Lanes', detail: 'Optionally dispatch one worktree-isolated lane per confirmed finding' },
    { title: 'Final-Report', detail: 'Synthesize threat model, lens reports, verified findings, and fix status' },
  ],
}

const ROLE_TO_BIZAR_AGENT = Object.freeze({
  'research-analyst': 'greg', planner: 'paul', architect: 'paul', implementer: 'todd',
  'qa-reviewer': 'linda', reviewer: 'linda', adversarial: 'linda', security: 'linda', qa: 'linda',
})
function routeAgentType(role = 'todd') {
  return ROLE_TO_BIZAR_AGENT[role] || (Object.values(ROLE_TO_BIZAR_AGENT).includes(role) ? role : 'todd')
}
// Static alias policy: security is never-downgrade. Every audit lane
// (threat model, lens, verifier, final report) uses `opus`. Only the
// optional fix lane is permitted to use `sonnet` since it is bounded
// implementation work that runs after the audit is already confirmed.
// Callers may override with `opts.model` for any explicit per-lane
// exception.
function pickAlias(risk) {
  if (risk === 'medium' && risk !== 'high') return 'opus'
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
const FIX_MODE = Boolean(args && args.fix)
const ROUTING_ID = (args && args.routing && typeof args.routing.routingDecisionId === 'string')
  ? args.routing.routingDecisionId
  : 'routing-id-absent'

const RUN_ID = 'bizar-sec-audit'

const THREAT_MODEL = {
  type: 'object',
  required: ['summary', 'assets', 'threats', 'mitigations'],
  properties: {
    summary: { type: 'string' },
    assets: { type: 'array', items: { type: 'string' } },
    threats: { type: 'array', items: { type: 'string' } },
    mitigations: { type: 'array', items: { type: 'string' } },
  },
}

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

const LENS_DEFS = [
  ['authz', 'Find concrete authorization and access-control defects: privilege escalation, missing or bypassable permission checks, IDOR, unsafe role/claim/scope parsing, and missing tenant isolation.'],
  ['secret', 'Find concrete secret-handling defects: hardcoded credentials, weak key derivation, secrets in logs/telemetry, plaintext secrets in transit or storage, and credential rotation gaps.'],
  ['supply-chain', 'Find concrete dependency and provenance defects: vulnerable or unmaintained transitive deps, lockfile drift, missing integrity/signature checks, build-time download from untrusted sources, and unsafe post-install hooks.'],
  ['runtime', 'Find concrete injection, unsafe-default, and boundary defects: SQL/command/template/path injection, SSRF, deserialization, prototype/eval pollution, unsafe filesystem/URL/path boundaries, and memory/resource exhaustion.'],
]

const LENS_ROLE = {
  authz: { role: 'security', risk: 'high', capabilities: ['structured-output', 'reasoning', 'security'] },
  secret: { role: 'security', risk: 'high', capabilities: ['structured-output', 'reasoning', 'security'] },
  'supply-chain': { role: 'security', risk: 'high', capabilities: ['structured-output', 'reasoning', 'security'] },
  runtime: { role: 'security', risk: 'high', capabilities: ['structured-output', 'reasoning', 'security'] },
}

phase('Threat-Model')
const threatModel = await dispatchAgent(
  agent,
  'threat-modeler',
  `Produce a STRIDE-style mini-threat-model for ${TARGET}. Enumerate assets, spoofing/tampering/repudiation/information-disclosure/dos/elevation-of-privilege threats, and existing mitigations. Reference routingDecisionId=${ROUTING_ID} when citing audit provenance. Do not edit.`,
  { role: 'security', risk: 'high', model: 'opus', capabilities: ['structured-output', 'reasoning', 'security'], label: 'threat-model', phase: 'Threat-Model', schema: THREAT_MODEL },
)
if (!threatModel || typeof threatModel.summary !== 'string') return { status: 'blocked', reason: 'Threat model produced no usable summary.', threatModel }

const threatModelSummary = `assets=${(threatModel.assets || []).length}; threats=${(threatModel.threats || []).length}; mitigations=${(threatModel.mitigations || []).length}; summary=${String(threatModel.summary).slice(0, 200)}`

phase('Lenses')
const lensReports = await parallel(LENS_DEFS.map((lens) => () => dispatchAgent(
  agent,
  `lens-${lens[0]}`,
  `Audit ${TARGET} through the ${lens[0]} security lens. ${lens[1]} Report only actionable defects with a concrete failure scenario; do not praise or speculate. Use routingDecisionId=${ROUTING_ID} for provenance.\n${barrierRef({ runId: RUN_ID, phase: 'Threat-Model', label: 'threat-model', summary: threatModelSummary }).promptBlock}`,
  { ...LENS_ROLE[lens[0]], label: `lens:${lens[0]}`, phase: 'Lenses', schema: FINDINGS, model: 'opus' },
)))
const lenses = {
  authz: lensReports[0] || { findings: [] },
  secret: lensReports[1] || { findings: [] },
  'supply-chain': lensReports[2] || { findings: [] },
  runtime: lensReports[3] || { findings: [] },
}
const candidateFindings = LENS_DEFS
  .map((lens, index) => (lensReports[index]?.findings || []).slice(0, 12).map((finding) => ({ ...finding, lens: lens[0] })))
  .reduce((acc, list) => acc.concat(list), [])

phase('Verify')
const verifiedRaw = candidateFindings.length === 0
  ? []
  : await parallel(candidateFindings.map((finding, index) => () => dispatchAgent(
      agent,
      `finding-verifier-${index + 1}`,
      `Try to refute this proposed ${finding.lens} finding. Inspect the exact code path and reject it if it is speculative, pre-existing, unreachable, already covered, or a false positive.\n${barrierRef({ runId: RUN_ID, phase: 'Lenses', label: `lens:${finding.lens || 'mixed'}`, summary: finding.summary ? finding.summary.slice(0, 200) : `finding in ${finding.file}` }).promptBlock}`,
      { role: 'adversarial', risk: 'high', capabilities: ['structured-output', 'reasoning'], label: `verify:${index + 1}:${finding.file || 'unknown'}`, phase: 'Verify', schema: VERDICT, model: 'opus' },
    ).then((verdict) => ({ finding, verdict }))))

const verifiedFindings = (verifiedRaw || [])
  .filter(Boolean)
  .filter((item) => item.verdict && item.verdict.confirmed === true)
  .map((item) => ({ ...item.finding, verification: item.verdict.reason || '' }))

phase('Fix-Lanes')
const fixLanes = (FIX_MODE && verifiedFindings.length > 0)
  ? await parallel(verifiedFindings.slice(0, 4).map((finding, index) => () => dispatchAgent(
      agent,
      `fix-lane-${index + 1}`,
      `Write a regression test plus minimal patch for this confirmed ${finding.lens} finding on ${TARGET}. Stay inside the owning worktree; do not revert sibling work. Do not commit, push, publish, or deploy.\nFinding: ${finding.summary}\nFile: ${finding.file}\nLine: ${finding.line}\nFailure: ${finding.failureScenario}\nVerification: ${finding.verification}\n${barrierRef({ runId: RUN_ID, phase: 'Verify', label: `verify:${finding.file || 'unknown'}`, summary: finding.verification ? finding.verification.slice(0, 200) : 'verified' }).promptBlock}`,
      { role: 'implementer', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: `fix:${index + 1}:${finding.file || 'unknown'}`, phase: 'Fix-Lanes', isolation: 'worktree', model: 'sonnet' },
    )))
  : []

phase('Final-Report')
const report = await dispatchAgent(
  agent,
  'final-report-author',
  `Synthesize the security audit into a final report for ${TARGET}. Combine the STRIDE-style threat model, the four lens reports (authz/secret/supply-chain/runtime), only the verified findings, and any fix-lane status. Use routingDecisionId=${ROUTING_ID} for provenance. Persist a single bounded report artifact. Do not edit audit targets.\n${barrierRef({ runId: RUN_ID, phase: 'Threat-Model', label: 'threat-model', summary: threatModelSummary }).promptBlock}\n${barrierRef({ runId: RUN_ID, phase: 'Lenses', label: 'lens-summary', summary: `authz=${(lenses.authz.findings || []).length}; secret=${(lenses.secret.findings || []).length}; supply-chain=${(lenses['supply-chain'].findings || []).length}; runtime=${(lenses.runtime.findings || []).length}` }).promptBlock}\n${barrierRef({ runId: RUN_ID, phase: 'Verify', label: 'verify-summary', summary: `${verifiedFindings.length}/${candidateFindings.length} findings confirmed` }).promptBlock}\n${barrierRef({ runId: RUN_ID, phase: 'Fix-Lanes', label: 'fix-summary', summary: `${fixLanes.filter(Boolean).length}/${Math.min(verifiedFindings.length, 4)} fix lanes dispatched` }).promptBlock}`,
  { role: 'qa-reviewer', risk: 'high', model: 'opus', capabilities: ['structured-output', 'reasoning', 'security'], label: 'final-report', phase: 'Final-Report' },
)

return {
  status: 'ready-for-integration',
  target: TARGET,
  routingDecisionId: ROUTING_ID,
  threatModel,
  lenses,
  verifiedFindings,
  fixLanes: fixLanes.filter(Boolean),
  report: {
    path: typeof report === 'object' && report && typeof report.path === 'string' ? report.path : 'bizar-sec-audit.report',
    summary: typeof report === 'object' && report && typeof report.summary === 'string' ? report.summary : 'security audit report synthesized',
  },
}
