export const meta = {
  name: 'ultracode-research',
  description: 'Research a technical question with independent repository, documentation, architecture, and adversarial passes',
  whenToUse: 'Use when a decision needs broad evidence from the repository and current primary sources.',
  phases: [
    { title: 'Research', detail: 'Gather evidence through independent modalities' },
    { title: 'Critique', detail: 'Challenge unsupported or contradictory claims' },
    { title: 'Synthesize', detail: 'Produce a sourced decision brief' },
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

const QUESTION = typeof args === 'string' ? args : args?.question || JSON.stringify(args || {})

const RUN_ID = 'ultracode-research'
const EVIDENCE = {
  type: 'object',
  required: ['claims', 'gaps'],
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        required: ['claim', 'source', 'confidence'],
        properties: { claim: { type: 'string' }, source: { type: 'string' }, confidence: { type: 'string' } },
      },
    },
    gaps: { type: 'array', items: { type: 'string' } },
  },
}

phase('Research')
const evidence = (await parallel([
  () => dispatchAgent(agent, 'repo-evidence', `Answer from repository evidence only: ${QUESTION}. Trace implementation, tests, configuration, and history. Do not edit.`, { role: 'research-analyst', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: 'repository', phase: 'Research', schema: EVIDENCE }),
  () => dispatchAgent(agent, 'docs-evidence', `Answer from current official primary documentation only: ${QUESTION}. Include exact URLs and version/experimental constraints.`, { role: 'research-analyst', risk: 'medium', capabilities: ['structured-output', 'reasoning', 'web-fetch'], label: 'documentation', phase: 'Research', schema: EVIDENCE }),
  () => dispatchAgent(agent, 'arch-evidence', `Analyze architecture and lifecycle implications of: ${QUESTION}. Identify state, ownership, verification, approval, and failure-mode constraints.`, { role: 'architect', risk: 'medium', capabilities: ['structured-output', 'reasoning', 'architecture'], label: 'architecture', phase: 'Research', schema: EVIDENCE }),
])).filter(Boolean)
if (evidence.length === 0) return { status: 'blocked', reason: 'No research pass completed.' }

// Phase B: persist evidence artifact for the next barrier agent.
const evidenceSummary = `${evidence.length} evidence passes with ${evidence.reduce((n, e) => n + (Array.isArray(e?.claims) ? e.claims.length : 0), 0)} total claims`

phase('Critique')
const critique = await dispatchAgent(agent, 'completeness-critic', `Challenge these research claims. Identify contradictions, unread sources, outdated assumptions, and claims lacking reproducible evidence.\nQuestion: ${QUESTION}\n${barrierRef({ runId: RUN_ID, phase: 'Research', label: 'barrier', summary: evidenceSummary }).promptBlock}`, { role: 'adversarial', risk: 'high', capabilities: ['structured-output', 'reasoning'], label: 'completeness-critic', phase: 'Critique', schema: EVIDENCE })

phase('Synthesize')
const synthesis = await dispatchAgent(agent, 'synthesis-author', `Produce a concise sourced decision brief for: ${QUESTION}. Separate verified facts, repository-specific implications, recommendation, risks, and unresolved gaps. Do not invent consensus or hide evidence gaps.\n${barrierRef({ runId: RUN_ID, phase: 'Research', label: 'barrier', summary: evidenceSummary }).promptBlock}\n${barrierRef({ runId: RUN_ID, phase: 'Critique', label: 'barrier', summary: typeof critique === 'string' ? critique.slice(0, 200) : 'critique complete' }).promptBlock}`, { role: 'architect', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: 'synthesis', phase: 'Synthesize' })
return { question: QUESTION, evidence, critique, synthesis }
