export const meta = {
  name: 'bizar-implement',
  description: 'Implement one bounded change in one worktree, or run explicitly supplied disjoint lanes concurrently',
  whenToUse: 'Use when implementation scope is understood and external research or root-cause discovery is unnecessary.',
  phases: [
    { title: 'Implement', detail: 'Run one isolated writer, or explicit disjoint writers concurrently' },
  ],
}

import { dispatchAgent } from './lib/dispatch.js'

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
