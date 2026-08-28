/**
 * packages/sdk/tests/e2e/_fixtures/team-spawn-stub.mjs —
 * Deterministic stand-in for the Claude Code team-spawn surface
 * (IMP-022 / F-192).
 *
 * Closes the IMP-022 acceptance gate from `IMPROVEMENTS.md` line 875 —
 * the matrix test must prove every teammate spawn carries its own
 * `routingDecisionId` and `model`, including per-spawn uniqueness when
 * the same role spawns multiple teammates.
 *
 * The stub records every member into `members` and returns a handle
 * whose `join()` always resolves deterministically. The harness wires
 * each spawn through `selectDispatchModel` so the captured member
 * payload carries the selector's `model` + `routingDecisionId`.
 *
 * IMPORTANT: this file is a TEST FIXTURE. Production code under
 * `packages/sdk/src/` MUST NOT import it. The drift guard in
 * `scripts/__tests__/autonomy-contract-e2e.test.mjs` enforces the
 * boundary.
 */

/**
 * Create a fresh team-spawn stub.
 *
 * @returns {{
 *   members: Array<{ role: string, payload: object, dispatchId: string, ctx?: object, outcome?: object }>,
 *   spawn: (role: string, payload: object, ctx?: object) => Promise<{ dispatchId: string, role: string, payload: object, ctx: object }>,
 *   join: (member: { dispatchId: string, role: string }) => Promise<{ ok: true, dispatchId: string }>,
 *   reset: () => void,
 * }}
 */
export function createTeamSpawnStub() {
  const members = [];
  let counter = 0;

  function reset() {
    members.length = 0;
    counter = 0;
  }

  async function spawn(role, payload = {}, ctx = {}) {
    if (typeof role !== 'string' || !role) {
      throw new TypeError('team-spawn-stub: spawn(role, payload) requires a non-empty role');
    }
    counter += 1;
    const dispatchId = payload?.routingDecisionId ?? `dispatch-${counter}`;
    const member = { role, payload, dispatchId, ctx };
    members.push(member);
    return member;
  }

  async function join(member) {
    if (!member || typeof member !== 'object') {
      throw new TypeError('team-spawn-stub: join(member) requires a member handle');
    }
    return { ok: true, dispatchId: member.dispatchId, role: member.role };
  }

  return { members, spawn, join, reset };
}