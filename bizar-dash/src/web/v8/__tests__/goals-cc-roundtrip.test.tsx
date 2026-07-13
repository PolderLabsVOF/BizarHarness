import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { GoalsView } from '../views/Goals/GoalsView';
import { parseProgress } from '../../../server/progress-parser.mjs';

// v10-S3 — verify GoalsView renders whatever parseProgress hands back
// when given a CC-shape PROGRESS.md fixture (the same shape CC's /goal
// slash command writes). Closes the audit gap where GoalsView was
// assumed to round-trip with CC's writer without test evidence.
//
// Fixture shape follows what `parseProgress` actually consumes: each
// goal is a level-2 heading `## F-NNN — Title` (or `## Some — Title`),
// with status from the `Goal is **status**` paragraph, KRs as
// `- [x] text` lines, and Owner/Due extracted from the body.

const ccShapeProgress = `# Cross-session progress

## G-001 — Ship v8 dashboard (Sprint S1 In Progress)

Goal is **on-track**

The dashboard is the orchestration center for all agent + task + goal
work. Fully rewritten in v9 with a real component library.

Owner: berk
Due: 2026-09-30

- [x] Foundations (controls, feedback, data display)
- [x] First wave of P0 views (Overview, Agents, Tasks, Goals, Settings)
- [ ] Chat surface (S37)
- [ ] Remaining endpoint groups (S38-S43)
- [ ] Settings audit + SettingsView sections (S41)

## G-002 — Reduce test flakiness (Sprint S2 In Progress)

Goal is **at-risk**

Network-dependent tests flake under 2% rate. Need to either mock or
make them truly idempotent.

Owner: berk

- [x] Identify flaky tests (10 of 312)
- [ ] Pin mock latency to deterministic values
- [ ] Add retry-with-cap to remaining CLI tests

## G-003 — Write integration E2E (Sprint S3 Next Steps)

Goal is **blocked**

Final open: cross-boundary agent ↔ restart roundtrip.

`;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

function installFetchWith(goals: unknown): void {
  globalThis.fetch = vi.fn(async (_input: RequestInfo | URL) => jsonResponse({ goals, count: Array.isArray(goals) ? goals.length : 0 })) as unknown as typeof fetch;
}

describe('GoalsView CC-shape round-trip (v10-S3)', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('parser recognises the CC-shape fixture as 3 goals with KR progress', () => {
    // Pure parser sanity check that runs without DOM/jsdom — proves the
    // fixture is in the canonical shape before we mount React over it.
    const parsed = parseProgress(ccShapeProgress);
    expect(parsed.goals).toHaveLength(3);
    expect(parsed.goals.map((g) => g.id)).toEqual(['G-001', 'G-002', 'G-003']);
    // Titles include the sprint metadata the parser preserves verbatim.
    expect(parsed.goals[0].title).toMatch(/Ship v8 dashboard/);
    expect(parsed.goals[1].title).toMatch(/Reduce test flakiness/);
    expect(parsed.goals[2].title).toMatch(/Write integration E2E/);
    expect(parsed.goals[0].status).toBe('on-track');
    expect(parsed.goals[0].keyResults).toHaveLength(5);
    expect(parsed.goals[0].progress).toBeCloseTo(2 / 5);
    expect(parsed.goals[0].due).toBe('2026-09-30');
    expect(parsed.goals[0].owner).toBe('berk');
    expect(parsed.goals[1].status).toBe('at-risk');
    expect(parsed.goals[2].status).toBe('blocked');
  });

  it('GoalsView renders cards for every goal the parser produces from the CC-shape fixture', async () => {
    const parsed = parseProgress(ccShapeProgress);
    installFetchWith(parsed.goals);
    render(<GoalsView />);
    expect(await screen.findByText(/Ship v8 dashboard/i)).toBeTruthy();
    expect(await screen.findByText(/Reduce test flakiness/i)).toBeTruthy();
    // Third goal renders; wait for second+ before asserting presence.
    await waitFor(() => { expect(screen.queryByText(/Write integration E2E/i)).toBeTruthy(); });
  });
});