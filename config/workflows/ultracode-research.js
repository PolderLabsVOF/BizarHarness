import { dispatchAgent } from './lib/dispatch.js'

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

const QUESTION = typeof args === 'string' ? args : args?.question || JSON.stringify(args || {})
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

phase('Critique')
const critique = await dispatchAgent(agent, 'completeness-critic', `Challenge these research claims. Identify contradictions, unread sources, outdated assumptions, and claims lacking reproducible evidence.\nQuestion: ${QUESTION}\nEvidence: ${JSON.stringify(evidence)}`, { role: 'adversarial', risk: 'high', capabilities: ['structured-output', 'reasoning'], label: 'completeness-critic', phase: 'Critique', schema: EVIDENCE })

phase('Synthesize')
const synthesis = await dispatchAgent(agent, 'synthesis-author', `Produce a concise sourced decision brief for: ${QUESTION}. Separate verified facts, repository-specific implications, recommendation, risks, and unresolved gaps. Do not invent consensus or hide evidence gaps.\nEvidence: ${JSON.stringify(evidence)}\nCritique: ${JSON.stringify(critique)}`, { role: 'architect', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: 'synthesis', phase: 'Synthesize' })
return { question: QUESTION, evidence, critique, synthesis }