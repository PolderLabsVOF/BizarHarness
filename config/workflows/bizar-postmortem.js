export const meta = {
  name: 'bizar-postmortem',
  description: 'Drive a production incident from a ticket through triage, RCA, fix, runbook update, durable postmortem artifact, and OpenKan action items.',
  whenToUse: 'Use after a production incident is reported and a confirmed postmortem with filed action items is needed for service review and durability.',
  phases: [
    { title: 'Triage', detail: 'Fetch the incident ticket and classify severity, scope, and affected service' },
    { title: 'RCA', detail: 'Delegate the root-cause hypothesis loop to the bizar-debug workflow via a nested agent dispatch' },
    { title: 'Fix+Test', detail: 'Apply the smallest fix in an isolated worktree with a regression test and canary smoke' },
    { title: 'Runbook-Update', detail: 'Refresh the service runbook with the new procedure, blast radius, and escalation path' },
    { title: 'Postmortem', detail: 'Author the durable postmortem artifact and file one OpenKan task per action item' },
    { title: 'Verify', detail: 'Adversarially review the postmortem for completeness and confirm runbook + action items' },
  ],
}

const ROLE_TO_BIZAR_AGENT = Object.freeze({
  'research-analyst': 'greg', planner: 'paul', architect: 'paul', implementer: 'todd',
  'qa-reviewer': 'linda', reviewer: 'linda', adversarial: 'linda', security: 'linda', qa: 'linda',
})
function routeAgentType(role = 'todd') {
  return ROLE_TO_BIZAR_AGENT[role] || (Object.values(ROLE_TO_BIZAR_AGENT).includes(role) ? role : 'todd')
}
// Static alias policy: triage and verifier lanes are high-risk and
// escalate to `opus`. The implementer, runbook, postmortem-author,
// and nested-RCA lanes default to `sonnet` per the postmortem alias
// ladder. Callers may override with `opts.model` for any explicit
// per-lane escalation.
function pickAlias(risk) {
  return risk === 'high' ? 'opus' : 'sonnet'
}
let WORKFLOW_DISPATCH_SEQUENCE = 0
const dispatchAgent = (agentFn, agentName, prompt, opts = {}) => {
  const sequence = ++WORKFLOW_DISPATCH_SEQUENCE
  const routingId = (opts && typeof opts.routingDecisionId === 'string')
    ? opts.routingDecisionId
    : (typeof WORKFLOW_ROUTING_ID === 'string' ? WORKFLOW_ROUTING_ID : 'none')
  const prefix = `[Bizar dispatch ${sequence}: ${agentName}; role=${opts.role || 'worker'}; phase=${opts.phase || 'work'}; label=${opts.label || agentName}; routing=${routingId}]`
  const agentOptions = {
    subagent_type: routeAgentType(opts.role),
    model: opts.model || pickAlias(opts.risk || 'medium'),
    routingDecisionId: routingId,
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

const INCIDENT_ID = typeof args === 'string'
  ? args
  : (args && typeof args.incident_id === 'string')
    ? args.incident_id
    : (args && typeof args.id === 'string')
      ? args.id
      : (args && typeof args.topic === 'string')
        ? args.topic
        : String(args || '')
const RAW_ARGS = args
const WORKFLOW_ROUTING_ID = (RAW_ARGS && typeof RAW_ARGS.routingDecisionId === 'string')
  ? String(RAW_ARGS.routingDecisionId)
  : ''

const RUN_ID = 'bizar-postmortem'

phase('Triage')
const triage = await dispatchAgent(
  agent,
  'triage',
  `Fetch incident ${INCIDENT_ID} via \`gh issue view\` (or accept the supplied URL), classify severity as SEV1, SEV2, or SEV3, scope the affected service(s), and produce a triage summary. Return \`{ incident: { id, severity, scope, summary } }\`. Do not propose a fix yet.`,
  { role: 'qa-reviewer', risk: 'high', capabilities: ['structured-output', 'reasoning'], label: 'triage', phase: 'Triage' },
)
const incident = (triage && triage.incident) ? triage.incident : { id: INCIDENT_ID, severity: 'SEV3', scope: [], summary: 'triage stub' }
const triageSummary = `incident ${incident.id} severity=${incident.severity} scope=${Array.isArray(incident.scope) ? incident.scope.join(',') : ''}`

phase('RCA')
const rca = await dispatchAgent(
  agent,
  'rca-delegate',
  `Run the bizar-debug workflow for incident ${incident.id} and return its { status, fix, verification } artifact`,
  { role: 'research-analyst', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: 'rca', phase: 'RCA' },
)

phase('Fix+Test')
const fix = await dispatchAgent(
  agent,
  'fix-and-test',
  `Apply the smallest fix for incident ${incident.id} from the accepted RCA hypothesis, write a regression test, and run a canary smoke against the smallest proving subset of checks. Edit and test in your isolated worktree. Do not commit, push, publish, or deploy.\n${barrierRef({ phase: 'RCA', label: 'rca', summary: `rca status=${rca?.status || 'unknown'}; fix=${typeof rca?.fix === 'string' ? rca.fix.slice(0, 200) : 'see rca artifact'}` }).promptBlock}`,
  { role: 'implementer', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: 'fix-and-test', phase: 'Fix+Test', isolation: 'worktree' },
)

phase('Runbook-Update')
const runbook = await dispatchAgent(
  agent,
  'bizar-doc-updater',
  `Refresh \`docs/runbooks/<service>.md\` for incident ${incident.id} with the new procedure, blast radius, escalation path, and link to the postmortem artifact. Return \`{ runbook: { path } }\`. Do not edit files outside the service's runbook directory.\n${barrierRef({ phase: 'Fix+Test', label: 'fix-and-test', summary: typeof fix === 'string' ? fix.slice(0, 200) : 'fix-and-test artifact' }).promptBlock}`,
  { role: 'implementer', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: 'runbook', phase: 'Runbook-Update' },
)

phase('Postmortem')
const postmortem = await dispatchAgent(
  agent,
  'postmortem-author',
  `Write \`docs/postmortems/<date>-<slug>.md\` for incident ${incident.id} with: timeline, root cause, contributing factors, blameless narrative, and a numbered list of action items. Each action item must be filed as a scoped OpenKan task via the bundled OK CLI (do NOT shell out from the workflow — the running agent invokes \`ok task add\` for each item). Return \`{ postmortem: { path, actionItemCount } }\`.\n${barrierRef({ phase: 'Fix+Test', label: 'fix-and-test', summary: typeof fix === 'string' ? fix.slice(0, 200) : 'fix-and-test artifact' }).promptBlock}\n${barrierRef({ phase: 'Runbook-Update', label: 'runbook', summary: `runbook=${runbook?.runbook?.path || runbook?.path || 'updated in phase'}` }).promptBlock}`,
  { role: 'implementer', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: 'postmortem', phase: 'Postmortem' },
)
const actionItems = (postmortem && Array.isArray(postmortem.actionItems))
  ? postmortem.actionItems
  : (postmortem && typeof postmortem.actionItemCount === 'number')
    ? Array.from({ length: postmortem.actionItemCount }, (_v, i) => ({ index: i + 1, filed: 'pending' }))
    : []

phase('Verify')
const verification = await dispatchAgent(
  agent,
  'postmortem-verifier',
  `Adversarially review the postmortem artifact for incident ${incident.id}. Confirm: timeline is faithful, root cause is corroborated by the RCA artifact, blameless narrative is preserved, the runbook was updated, and every action item is filed as a scoped OpenKan task with an owner and a verification gate. Reject if any section is speculative or any action item is missing.\n${barrierRef({ phase: 'Postmortem', label: 'postmortem', summary: `path=${postmortem?.postmortem?.path || postmortem?.path || 'see artifact'}; items=${actionItems.length}` }).promptBlock}\n${barrierRef({ phase: 'Runbook-Update', label: 'runbook', summary: `path=${runbook?.runbook?.path || runbook?.path || 'updated in phase'}` }).promptBlock}`,
  { role: 'qa-reviewer', risk: 'high', capabilities: ['structured-output', 'reasoning'], label: 'verify', phase: 'Verify' },
)

return {
  status: 'ready-for-integration',
  incident,
  rca,
  fix,
  runbook,
  postmortem,
  actionItems,
}
