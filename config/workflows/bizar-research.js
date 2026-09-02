export const meta = {
  name: 'bizar-research',
  description: 'Research, plan, audit, and implement a bounded task across disjoint lanes with sequential pipeline verification',
  whenToUse: 'Use for substantive research-backed work that needs an explicit plan, an adversarial audit, and disjoint implementation lanes with sequential verification.',
  phases: [
    { title: 'Research', detail: 'Gather repository and primary-documentation evidence in parallel' },
    { title: 'Plan', detail: 'Design disjoint edit lanes with bounded tests' },
    { title: 'Audit', detail: 'Adversarially review the plan before any edit' },
    { title: 'Implement', detail: 'Execute disjoint lanes concurrently in worktrees' },
    { title: 'Verify', detail: 'Sequentially review and synthesize integration evidence' },
  ],
}

import { randomUUID } from 'node:crypto'
import { dispatchAgent, writeArtifact, barrierRef } from './lib/dispatch.js'

const TOPIC = typeof args === 'string'
  ? args
  : (args && typeof args.topic === 'string')
    ? args.topic
    : JSON.stringify(args || {})

// Phase B (v10.21.0) artifact-on-disk barriers: one runId per workflow
// invocation. Used by every writeArtifact() + barrierRef() in this script
// so the on-disk store + the 3-line barrier block stay paired.
const RUN_ID = randomUUID()

const BRIEF = {
  type: 'object',
  required: ['summary', 'files', 'risks', 'verification'],
  properties: {
    summary: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    verification: { type: 'array', items: { type: 'string' } },
  },
}

const PLAN = {
  type: 'object',
  required: ['approach', 'lanes', 'gates'],
  properties: {
    approach: { type: 'string' },
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
    gates: { type: 'array', items: { type: 'string' } },
  },
}

phase('Research')
const research = (await parallel([
  () => dispatchAgent(agent, 'repo-researcher', `Repository research for: ${TOPIC}. Map existing implementations, tests, constraints, and reusable utilities. Do not edit.`, { role: 'research-analyst', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: 'repository-map', phase: 'Research', schema: BRIEF }),
  () => dispatchAgent(agent, 'docs-researcher', `Official-documentation research for: ${TOPIC}. Verify current external APIs/features from primary sources and identify version-sensitive constraints. Do not edit.`, { role: 'research-analyst', risk: 'medium', capabilities: ['structured-output', 'reasoning', 'web-fetch'], label: 'official-docs', phase: 'Research', schema: BRIEF }),
])).filter(Boolean)

if (research.length === 0) return { status: 'blocked', reason: 'No research agent completed successfully.' }

// Phase B: persist the research artifact for the next barrier agent.
const researchSummary = `research lanes: ${research.map((r) => (r && r.summary) ? r.summary.slice(0, 80) : '<lane>').join(' | ')}`
writeArtifact({ runId: RUN_ID, phase: 'Research', label: 'barrier', payload: research, summary: researchSummary, role: 'research-analyst' })

phase('Plan')
const plan = await dispatchAgent(agent, 'plan-author', `Design one reversible implementation for: ${TOPIC}\n${barrierRef({ runId: RUN_ID, phase: 'Research', label: 'barrier', summary: researchSummary }).promptBlock}\nReturn disjoint edit lanes. Shared root/config/lock files must have one owner. Include bounded tests and stop conditions.`, { role: 'architect', risk: 'medium', capabilities: ['structured-output', 'reasoning', 'architecture'], label: 'plan', phase: 'Plan', schema: PLAN })
if (!plan || !Array.isArray(plan.lanes) || plan.lanes.length === 0) {
  return { status: 'blocked', reason: 'Planning produced no implementation lanes.', research }
}

// Phase B: persist the plan artifact for the next barrier agent.
const planSummary = `plan lanes: ${plan.lanes.map((l) => l.name).join(', ')}`
writeArtifact({ runId: RUN_ID, phase: 'Plan', label: 'barrier', payload: plan, summary: planSummary, role: 'architect' })

phase('Audit')
const audit = await dispatchAgent(agent, 'plan-auditor', `Adversarially review this plan for correctness, security, conflicting file ownership, missing regression tests, and unbounded retry loops. Return a corrected plan, not commentary. Topic: ${TOPIC}\n${barrierRef({ runId: RUN_ID, phase: 'Plan', label: 'barrier', summary: planSummary }).promptBlock}`, { role: 'adversarial', risk: 'high', capabilities: ['structured-output', 'reasoning', 'architecture', 'security'], label: 'plan-audit', phase: 'Audit', schema: PLAN })
const approved = audit || plan

phase('Implement')
const lanes = approved.lanes.slice(0, 8)
if (approved.lanes.length > lanes.length) {
  log(`Bounded implementation to 8 of ${approved.lanes.length} lanes; ${approved.lanes.length - lanes.length} lanes were not dispatched.`)
}
const implementation = await parallel(
  lanes.map((lane, index) => () => dispatchAgent(
    agent,
    `lane-implementer-${index + 1}`,
    `Implement this owned lane for the topic "${TOPIC}".\n${barrierRef({ runId: RUN_ID, phase: 'Plan', label: 'barrier', summary: `lane ${lane.name}: ${lane.task.slice(0, 120)}` }).promptBlock}\nDo not edit outside the listed scope. Do not revert sibling work. Add regression tests and run the smallest relevant checks. Return changed files, commands, exact results, and blockers. Do not commit, push, publish, or deploy.`,
    { role: 'implementer', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: `implement:${index + 1}:${lane.name}`, phase: 'Implement', isolation: 'worktree' },
  )),
)
const completed = implementation.filter(Boolean)
if (completed.length === 0) {
  return { status: 'blocked', reason: 'No implementation lane completed successfully.', plan: approved }
}

// Phase B: persist each lane's artifact for the next barrier agent.
for (let i = 0; i < completed.length; i++) {
  const lane = lanes[i];
  const label = `implement:${i + 1}:${lane.name}`;
  const summary = `lane ${lane.name} files: ${(completed[i]?.files || []).slice(0, 5).join(', ')}`;
  writeArtifact({ runId: RUN_ID, phase: 'Implement', label, payload: completed[i], summary, role: 'implementer' });
}

phase('Verify')
const reviews = await pipeline(
  completed,
  (result, _original, index) => dispatchAgent(
    agent,
    `reviewer-${index + 1}`,
    `Try to refute this implementation result for topic "${TOPIC}". Check correctness, security, scope, test evidence, and integration assumptions. Return only verified findings and required checks.\n${barrierRef({ runId: RUN_ID, phase: 'Implement', label: `implement:${index + 1}:${lanes[index]?.name || ''}`, summary: `review of lane ${lanes[index]?.name || index + 1}` }).promptBlock}`,
    { role: 'adversarial', risk: 'high', capabilities: ['structured-output', 'reasoning'], label: `review:${index + 1}`, phase: 'Verify' },
  ),
)
// Phase B: persist review artifacts.
const verifiedReviews = reviews.filter(Boolean);
for (let i = 0; i < verifiedReviews.length; i++) {
  writeArtifact({ runId: RUN_ID, phase: 'Verify', label: `review:${i + 1}`, payload: verifiedReviews[i], summary: typeof verifiedReviews[i] === 'string' ? verifiedReviews[i].slice(0, 200) : `review ${i + 1}`, role: 'adversarial' });
}
const final = await dispatchAgent(agent, 'final-verifier', `Synthesize a bounded integration and verification report for topic "${TOPIC}". Do not claim success without fresh command evidence. Identify conflicts between worktrees, exact integration order, remaining gates, and any required human approvals.\n${barrierRef({ runId: RUN_ID, phase: 'Plan', label: 'barrier', summary: `approved plan with ${approved.lanes.length} lanes` }).promptBlock}\n${barrierRef({ runId: RUN_ID, phase: 'Implement', label: 'implement:summary', summary: `${completed.length} lanes complete` }).promptBlock}\n${barrierRef({ runId: RUN_ID, phase: 'Verify', label: 'review:summary', summary: `${verifiedReviews.length} reviews complete` }).promptBlock}`, { role: 'implementer', risk: 'medium', capabilities: ['structured-output', 'reasoning'], label: 'final-verification', phase: 'Verify' })

return { status: 'ready-for-integration', topic: TOPIC, research, plan: approved, implementation: completed, reviews: reviews.filter(Boolean), final }