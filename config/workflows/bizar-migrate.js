export const meta = {
  name: 'bizar-migrate',
  description: 'Multi-lane migration (JS→TS, REST→gRPC, Vue 2→Vue 3, monolith→modulith) with one owner for the shared contract and per-wave barriers',
  whenToUse: 'Use when a migration spans many modules and one owner must publish the new shared shape (contract + adapters) before consumers adapt.',
  phases: [
    { title: 'Inventory', detail: 'Map current surface and external target documentation in parallel' },
    { title: 'Contract', detail: 'Author and adversarially audit the new shared-shape contract' },
    { title: 'Wave-1', detail: 'Interface owner publishes the new boundary and adapter shims' },
    { title: 'Wave-2', detail: 'Per-module consumers adapt to the Wave-1 contract in parallel worktrees' },
    { title: 'Wave-3 + Verify', detail: 'Cleanup pass and final adversarial verification' },
  ],
}

const ROLE_TO_BIZAR_AGENT = Object.freeze({
  'research-analyst': 'greg', planner: 'paul', architect: 'paul', implementer: 'todd',
  'qa-reviewer': 'linda', reviewer: 'linda', adversarial: 'linda', security: 'linda', qa: 'linda',
})
const ALIASES = Object.freeze(['haiku', 'sonnet', 'opus', 'fable'])
function isAlias(value) {
  return typeof value === 'string' && ALIASES.includes(value)
}
function routeAgentType(role = 'todd') {
  return ROLE_TO_BIZAR_AGENT[role] || (Object.values(ROLE_TO_BIZAR_AGENT).includes(role) ? role : 'todd')
}
// Static alias policy: inventory and implementation lanes default to
// `sonnet`. Contract author/auditor and final verifier escalate to
// `opus`. Callers may override with `opts.model` for any explicit
// per-lane escalation; any override must be one of the four static
// aliases (`haiku`, `sonnet`, `opus`, `fable`).
function pickAlias(risk) {
  return risk === 'high' ? 'opus' : 'sonnet'
}
let WORKFLOW_DISPATCH_SEQUENCE = 0
const dispatchAgent = (agentFn, agentName, prompt, opts = {}) => {
  if (opts.model !== undefined && !isAlias(opts.model)) {
    throw new Error(`bizar-migrate: opts.model must be one of ${ALIASES.join(', ')}, got ${JSON.stringify(opts.model)}`)
  }
  const sequence = ++WORKFLOW_DISPATCH_SEQUENCE
  const prefix = `[Bizar dispatch ${sequence}: ${agentName}; role=${opts.role || 'worker'}; phase=${opts.phase || 'work'}; label=${opts.label || agentName}]`
  const agentOptions = {
    subagent_type: routeAgentType(opts.role),
    model: opts.model || pickAlias(opts.risk || 'medium'),
  }
  if (opts.schema) agentOptions.schema = opts.schema
  if (opts.isolation) agentOptions.isolation = opts.isolation
  if (opts.disallowedTools) agentOptions.disallowedTools = opts.disallowedTools
  const RAW_ARGS = args
  const routingDecisionId = opts.routingDecisionId || (RAW_ARGS && RAW_ARGS.routingDecisionId)
  if (routingDecisionId) agentOptions.routingDecisionId = routingDecisionId
  return agentFn(`${prefix}\n${prompt}`, agentOptions)
}
const barrierRef = ({ phase, label, summary }) => {
  const s = typeof summary === 'string' ? summary.slice(0, 1200) : ''
  return { promptBlock: `Prior phase: ${phase}; label: ${label}; summary: ${s}` }
}

const parseMigrationArgs = (rawArgs) => {
  let from = ''
  let to = ''
  let migration = ''
  if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    from = typeof rawArgs.from === 'string' ? rawArgs.from : ''
    to = typeof rawArgs.to === 'string' ? rawArgs.to : ''
    migration = typeof rawArgs.migration === 'string' ? rawArgs.migration : ''
  } else if (typeof rawArgs === 'string') {
    const fromMatch = rawArgs.match(/--from\s+(\S+)/)
    const toMatch = rawArgs.match(/--to\s+(\S+)/)
    if (fromMatch) from = fromMatch[1]
    if (toMatch) to = toMatch[1]
    migration = rawArgs
  }
  return { from, to, migration }
}

const parsedArgs = parseMigrationArgs(args)
const FROM = parsedArgs.from
const TO = parsedArgs.to
const MIGRATION = (FROM && TO)
  ? `Migrate from ${FROM} to ${TO}`
  : (parsedArgs.migration || String(args || ''))

const RUN_ID = 'bizar-migrate'

const INVENTORY = {
  type: 'object',
  required: ['summary', 'files', 'interfaces', 'breakingChanges'],
  properties: {
    summary: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    interfaces: { type: 'array', items: { type: 'string' } },
    breakingChanges: { type: 'array', items: { type: 'string' } },
  },
}

const CONTRACT = {
  type: 'object',
  required: ['contract', 'owners'],
  properties: {
    contract: { type: 'string' },
    owners: { type: 'array', items: { type: 'string' } },
    boundary: { type: 'string' },
  },
}

const suppliedWave2Modules = (args && Array.isArray(args.wave2_modules)) ? args.wave2_modules : []
const MAX_WAVE2 = 6
const wave2Modules = suppliedWave2Modules.slice(0, MAX_WAVE2)
if (suppliedWave2Modules.length > wave2Modules.length) {
  log(`bizar-migrate bounded Wave-2 to ${MAX_WAVE2} of ${suppliedWave2Modules.length} modules`)
}

phase('Inventory')
const inventory = (await parallel([
  () => dispatchAgent(agent, 'repo-surveyor', `Repository surface inventory for migrating "${MIGRATION}". Map every existing public interface, API surface, type, schema, and shared shape that must change or be wrapped. Identify call sites and consumers. Do not edit.`, { role: 'research-analyst', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: 'inventory:repo', phase: 'Inventory', schema: INVENTORY }),
  () => dispatchAgent(agent, 'target-researcher', `Official-documentation research for the target API/version behind migrating "${MIGRATION}". Verify the new shape, breaking changes, migration cookbook, and version-sensitive constraints from primary sources. Do not edit.`, { role: 'research-analyst', risk: 'medium', capabilities: ['structured-output', 'reasoning', 'web-fetch'], label: 'inventory:docs', phase: 'Inventory', schema: INVENTORY }),
])).filter(Boolean)

if (inventory.length === 0) {
  return { status: 'blocked', reason: 'No inventory lanes completed.', migration: MIGRATION }
}

const inventorySummary = inventory.map((r) => (r && r.summary) ? r.summary.slice(0, 200) : '<lane>').join(' | ')

phase('Contract')
const contractDraft = await dispatchAgent(agent, 'contract-author', `Author the new shared-shape spec for migrating "${MIGRATION}". One owner publishes the new boundary, the single contract file, and adapter shims. Every Wave-2 module imports from this contract file; disjoint lanes must not edit it.\n${barrierRef({ phase: 'Inventory', label: 'inventory:summary', summary: inventorySummary }).promptBlock}`, { role: 'architect', risk: 'high', capabilities: ['structured-output', 'reasoning', 'architecture'], label: 'contract:author', phase: 'Contract', schema: CONTRACT })
if (!contractDraft || typeof contractDraft.contract !== 'string') {
  return { status: 'blocked', reason: 'Contract authoring produced no shared-shape spec.', migration: MIGRATION, inventory }
}

const contractAudit = await dispatchAgent(agent, 'contract-auditor', `Adversarially review the proposed shared-shape spec for migrating "${MIGRATION}". Find ownership collisions, ambiguous boundaries, missing adapter layers, and unbounded migrations. Return only verified corrections.\n${barrierRef({ phase: 'Contract', label: 'contract:author', summary: contractDraft.contract.slice(0, 800) }).promptBlock}`, { role: 'adversarial', risk: 'high', capabilities: ['structured-output', 'reasoning', 'architecture', 'security'], label: 'contract:audit', phase: 'Contract', schema: CONTRACT })
const approvedContract = (contractAudit && typeof contractAudit.contract === 'string') ? contractAudit : contractDraft

phase('Wave-1')
const wave1 = await dispatchAgent(agent, 'wave1-interface-owner', `Publish the new boundary, the single contract file, and the adapter shims for migrating "${MIGRATION}". Edit only the contract file, the adapter module, and their tests in your isolated worktree. Do not consume any module that has not yet been migrated. Add regression tests and run the smallest proving checks. Do not commit, push, publish, or deploy.\n${barrierRef({ phase: 'Contract', label: 'contract:author', summary: approvedContract.contract.slice(0, 800) }).promptBlock}`, { role: 'implementer', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: 'wave1:interface', phase: 'Wave-1', isolation: 'worktree' })

phase('Wave-2')
const wave2Plan = (wave2Modules.length > 0)
  ? wave2Modules
  : [{ name: 'default-module', scope: [], task: `Migrate one module to the new boundary for ${MIGRATION}` }]
const wave2 = await parallel(wave2Plan.map((mod, index) => () => dispatchAgent(agent, `wave2-module-${index + 1}`, `Migrate module "${mod.name}" to the new shared-shape contract published by Wave-1. Import the new boundary from the Wave-1 contract file. Do not edit the contract file. Do not revert sibling work. Add regression tests and run the smallest proving checks. Return changed files, commands, exact results, and blockers.\n${barrierRef({ phase: 'Wave-1', label: 'wave1:interface', summary: typeof wave1 === 'string' ? wave1.slice(0, 400) : 'wave-1 artifact' }).promptBlock}\nModule task: ${mod.task || MIGRATION}`, { role: 'implementer', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: `wave2:${index + 1}:${mod.name}`, phase: 'Wave-2', isolation: 'worktree' })))
const wave2Completed = wave2.filter(Boolean)

phase('Wave-3 + Verify')
const wave3 = await dispatchAgent(agent, 'refactor-cleaner', `Cleanup pass over the migrated modules for "${MIGRATION}". Deduplicate the adapter shims, prune dead paths, and align naming with the Wave-1 contract. Do not change public behavior. Do not commit, push, publish, or deploy.\n${barrierRef({ phase: 'Wave-2', label: 'wave2:summary', summary: `${wave2Completed.length} modules migrated` }).promptBlock}`, { role: 'implementer', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: 'wave3:cleanup', phase: 'Wave-3 + Verify', isolation: 'worktree' })
const verification = await dispatchAgent(agent, 'final-verifier', `Synthesize a bounded integration and verification report for migrating "${MIGRATION}". Verify the contract file is owned by exactly one writer, that no Wave-2 module edits the contract, that regressions exist for each wave, and that no human-approval gates were crossed. Report conflicts, exact integration order, remaining gates, and required human approvals.\n${barrierRef({ phase: 'Contract', label: 'contract:author', summary: approvedContract.contract.slice(0, 400) }).promptBlock}\n${barrierRef({ phase: 'Wave-1', label: 'wave1:interface', summary: typeof wave1 === 'string' ? wave1.slice(0, 200) : 'wave-1 artifact' }).promptBlock}\n${barrierRef({ phase: 'Wave-2', label: 'wave2:summary', summary: `${wave2Completed.length} modules migrated` }).promptBlock}`, { role: 'adversarial', risk: 'high', capabilities: ['structured-output', 'reasoning'], label: 'verification:final', phase: 'Wave-3 + Verify' })

return {
  status: 'ready-for-integration',
  migration: MIGRATION,
  contract: approvedContract,
  waves: { wave1, wave2: wave2Completed, wave3 },
  verification,
}
