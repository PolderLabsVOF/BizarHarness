export const meta = {
  name: 'ultracode-review',
  description: 'Review a change across independent dimensions and adversarially verify every finding',
  whenToUse: 'Use for high-confidence review of a working diff, branch, pull request, or specified code scope.',
  phases: [
    { title: 'Review', detail: 'Inspect correctness, security, tests, and maintainability in parallel' },
    { title: 'Verify', detail: 'Try to refute every proposed finding before reporting it' },
  ],
}

const TARGET = typeof args === 'string' ? args : args?.target || 'the current working diff'
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

phase('Review')
const reviewed = await pipeline(
  lenses,
  (lens) => agent(`Review ${TARGET} through the ${lens[0]} lens. ${lens[1]} Report only actionable defects with a concrete failure scenario; do not praise or speculate.`, { label: `review:${lens[0]}`, phase: 'Review', schema: FINDINGS }),
  (review, original) => (review?.findings || []).slice(0, 12).map((finding) => ({ ...finding, lens: original[0] })),
  (findings) => parallel(findings.map((finding, index) => () => agent(`Try to refute this proposed finding. Inspect the exact code path and reject it if it is speculative, pre-existing, unreachable, or already covered.\n${JSON.stringify(finding)}`, { label: `verify:${index + 1}:${finding.file}`, phase: 'Verify', schema: VERDICT }).then((verdict) => ({ finding, verdict })))),
)

const verified = reviewed.flat(2).filter(Boolean).filter((item) => item.verdict?.confirmed).map((item) => ({ ...item.finding, verification: item.verdict.reason }))
return { target: TARGET, findings: verified }
