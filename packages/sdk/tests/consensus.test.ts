/**
 * consensus.test.ts — Unit tests for the F-039 consensus layer.
 *
 * Covers:
 *   • Happy path: 5 agents, 3-of-5 agree → commit
 *   • Split: 2-2-1 → no consensus, view-change triggers
 *   • Faulty proposer: proposer votes "no" → view-change to next peer
 *   • Replay protection: same proposalId twice → second is no-op
 *   • Empty quorum: 0 votes → expiry after timeoutMs
 *   • QueenCoordinator round-robin + fault-skip
 *   • Determinism with proposerSeed
 *   • Status snapshot shape
 *   • Singleton + resetSharedConsensus()
 *   • MCP-tool-equivalent propose → castVote cycle
 */

import { describe, test, expect, beforeEach } from "vitest";

import {
  ByzantineConsensus,
  QueenCoordinator,
  createConsensus,
  getSharedConsensus,
  resetSharedConsensus,
  DEFAULT_QUORUM,
  DEFAULT_PEER_COUNT,
  DEFAULT_MAX_FAULTS,
  PHASE_ORDER,
  type ConsensusHandle,
} from "../src/consensus/index.js";
import {
  type ConsensusStatus,
  type ProposeResult,
  type VoteResult,
} from "../src/consensus/types.js";

// ─── Helpers ───────────────────────────────────────────────────────────

const FIVE_PEERS = ["mike", "susan", "janet", "greg", "brenda"] as const;

function newFivePeerConsensus(opts: Partial<ConstructorParameters<typeof ByzantineConsensus>[0]> = {}): ByzantineConsensus {
  return new ByzantineConsensus({
    localAgentId: "mike",
    peers: [...FIVE_PEERS],
    quorum: 3,
    maxFaults: 1,
    ...opts,
  });
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe("ByzantineConsensus — happy path (3-of-5)", () => {
  let c: ByzantineConsensus;
  beforeEach(() => { c = newFivePeerConsensus(); });

  test("5 agents, 3-of-5 agree → commit", () => {
    const { proposalId, phase } = c.propose({ action: "ship", version: 1 });
    expect(phase).toBe("prepare");
    expect(proposalId).toMatch(/^bft-v\d+-[\da-f]+$/);

    const r1 = c.castVote(proposalId, "mike", "yes");
    expect(r1.approvals).toBe(1);
    expect(r1.committed).toBe(false);

    const r2 = c.castVote(proposalId, "susan", "yes");
    expect(r2.approvals).toBe(2);
    expect(r2.committed).toBe(false);

    const r3 = c.castVote(proposalId, "janet", "yes");
    expect(r3.approvals).toBe(3);
    expect(r3.committed).toBe(true);
    expect(r3.phase).toBe("reply");
    expect(r3.status).toBe("committed");
  });

  test("exactly 3 yes + 2 abstain → commit (3-of-5 simple majority)", () => {
    const { proposalId } = c.propose({ a: 1 });
    c.castVote(proposalId, "mike", "yes");
    c.castVote(proposalId, "susan", "yes");
    c.castVote(proposalId, "janet", "yes");
    const r = c.castVote(proposalId, "greg", "abstain");
    expect(r.committed).toBe(true);
    expect(r.approvals).toBe(3);
  });

  test("2 yes + 3 no (all 5 votes) → rejected (cannot reach quorum)", () => {
    const { proposalId } = c.propose({ a: 1 });
    c.castVote(proposalId, "mike", "yes");
    c.castVote(proposalId, "susan", "yes");
    c.castVote(proposalId, "janet", "no");
    c.castVote(proposalId, "greg", "no");
    const r = c.castVote(proposalId, "brenda", "no");
    expect(r.committed).toBe(false);
    expect(r.status).toBe("rejected");
    expect(r.phase).toBe("reply");
    expect(r.approvals).toBe(2);
    expect(r.rejections).toBe(3);
  });

  test("late vote after commit is a no-op (returns current snapshot)", () => {
    const { proposalId } = c.propose({ x: 1 });
    c.castVote(proposalId, "mike", "yes");
    c.castVote(proposalId, "susan", "yes");
    const committed = c.castVote(proposalId, "janet", "yes");
    expect(committed.committed).toBe(true);
    const late = c.castVote(proposalId, "greg", "yes");
    expect(late.committed).toBe(true);
    expect(late.phase).toBe("reply");
  });
});

describe("ByzantineConsensus — view-change / faulty proposer", () => {
  test("proposer voting 'no' triggers view-change (self-fault)", () => {
    const c = newFivePeerConsensus();
    const { proposalId, phase } = c.propose({ payload: "bad" });
    expect(phase).toBe("prepare");
    const r = c.castVote(proposalId, c.getCurrentProposer(), "no");
    expect(r.status).toBe("view-change");
    expect(r.phase).toBe("reply");
    expect(r.committed).toBe(false);
    expect(c.getViewNumber()).toBeGreaterThanOrEqual(1);
  });

  test("explicit viewChange() advances proposer + view number", () => {
    const c = newFivePeerConsensus();
    const before = c.getCurrentProposer();
    const result = c.viewChange("test-fault", "irrelevant");
    expect(result.previousProposer).toBe(before);
    expect(result.newProposer).not.toBe(before);
    expect(result.viewNumber).toBe(1);
    expect(c.getViewNumber()).toBe(1);
    expect(c.getCurrentProposer()).toBe(result.newProposer);
  });

  test("viewChange() on a pending proposal allows the new view to re-propose", () => {
    const c = newFivePeerConsensus();
    const { proposalId } = c.propose({ same: true });
    c.viewChange("first-proposer-faulty", proposalId);
    // Same payload under the new view must produce a new proposalId.
    const second = c.propose({ same: true });
    expect(second.proposalId).not.toBe(proposalId);
  });

  test("tie-break (2-2-1) does not commit (only 2 yes)", () => {
    const c = newFivePeerConsensus();
    const { proposalId } = c.propose({ split: true });
    c.castVote(proposalId, "mike", "yes");
    c.castVote(proposalId, "susan", "yes");
    c.castVote(proposalId, "janet", "no");
    const r = c.castVote(proposalId, "greg", "no");
    expect(r.committed).toBe(false);
    expect(r.approvals).toBe(2);
    expect(r.rejections).toBe(2);
  });
});

describe("ByzantineConsensus — replay protection", () => {
  test("same payload in same view returns cached proposalId", () => {
    const c = newFivePeerConsensus();
    const first = c.propose({ action: "noop", v: 1 });
    const second = c.propose({ action: "noop", v: 1 });
    expect(second.proposalId).toBe(first.proposalId);
  });

  test("different payloads in same view get different proposalIds", () => {
    const c = newFivePeerConsensus();
    const a = c.propose({ x: 1 });
    const b = c.propose({ x: 2 });
    expect(a.proposalId).not.toBe(b.proposalId);
  });

  test("payload digest keys on viewNumber — view-change produces fresh id", () => {
    const c = newFivePeerConsensus();
    const first = c.propose({ same: "payload" });
    c.viewChange("manual", first.proposalId);
    const second = c.propose({ same: "payload" });
    expect(second.proposalId).not.toBe(first.proposalId);
  });
});

describe("ByzantineConsensus — empty quorum / expiry", () => {
  test("0 votes → expires after timeoutMs (status flips to expired)", async () => {
    let nowMs = 1_000_000_000_000;
    const now = () => new Date(nowMs);
    const c = newFivePeerConsensus({ timeoutMs: 50, now });
    const { proposalId } = c.propose({ stale: true });
    expect(c.getProposal(proposalId)?.status).toBe("prepare");
    nowMs += 100;
    expect(c.getProposal(proposalId)?.status).toBe("expired");
    // Subsequent castVote on an expired proposal is a no-op snapshot.
    const r = c.castVote(proposalId, "mike", "yes");
    expect(r.committed).toBe(false);
  });
});

describe("ByzantineConsensus — validation", () => {
  test("missing localAgentId throws", () => {
    expect(() =>
      new ByzantineConsensus({ localAgentId: "", peers: [...FIVE_PEERS] }),
    ).toThrow(/localAgentId/);
  });

  test("localAgentId not in peer list throws", () => {
    expect(() =>
      new ByzantineConsensus({ localAgentId: "loki", peers: [...FIVE_PEERS] }),
    ).toThrow(/must be in the peer list/);
  });

  test("peer count < 2 throws", () => {
    expect(() =>
      new ByzantineConsensus({ localAgentId: "mike", peers: ["mike"] }),
    ).toThrow(/>=2/);
  });

  test("castVote on unknown proposalId throws", () => {
    const c = newFivePeerConsensus();
    expect(() => c.castVote("missing", "mike", "yes")).toThrow(/unknown proposalId/);
  });

  test("castVote from non-peer throws", () => {
    const c = newFivePeerConsensus();
    const { proposalId } = c.propose({ x: 1 });
    expect(() => c.castVote(proposalId, "loki", "yes")).toThrow(/not in the peer list/);
  });
});

describe("QueenCoordinator — round-robin + fault-skip", () => {
  test("currentProposer advances through peer list on advance()", () => {
    const q = new QueenCoordinator({ peers: ["a", "b", "c", "d", "e"] });
    expect(q.currentProposer()).toBe("a");
    q.advance();
    expect(q.currentProposer()).toBe("b");
    q.advance(); q.advance(); q.advance(); q.advance();
    expect(q.currentProposer()).toBe("a");
  });

  test("recordFault adds skip; the peer is skipped until penalty clears", () => {
    const q = new QueenCoordinator({ peers: ["a", "b", "c", "d", "e"] });
    q.recordFault("a");
    q.recordFault("a");
    // advance() walks one step per call, decrementing any peer's skip
    // counter it lands on. With skip[a]=2, two advances must "consume"
    // a before a becomes proposer again.
    // 1st: cursor 0→1, "b" skip=0 → "b" (a is still current; not yet proposed)
    expect(q.advance()).toBe("b");
    // 2nd: cursor 1→2, "c" → "c"
    expect(q.advance()).toBe("c");
    // 3rd: cursor 2→3, "d" → "d"
    expect(q.advance()).toBe("d");
    // 4th: cursor 3→4, "e" → "e"
    expect(q.advance()).toBe("e");
    // 5th: cursor 4→0, "a" skip=2 → decrement to 1, continue. cursor 0→1, "b" skip=0 → "b"
    expect(q.advance()).toBe("b");
    // 6th: cursor 1→2, "c" → "c"
    expect(q.advance()).toBe("c");
    // 7th: cursor 2→3, "d" → "d"
    expect(q.advance()).toBe("d");
    // 8th: cursor 3→4, "e" → "e"
    expect(q.advance()).toBe("e");
    // 9th: cursor 4→0, "a" skip=1 → decrement to 0, continue. cursor 0→1, "b" → "b"
    expect(q.advance()).toBe("b");
    // 10th: cursor 1→2, "c" → "c"
    expect(q.advance()).toBe("c");
    // Eventually "a" becomes eligible again.
    // (proves the skip penalty is bounded, not permanent.)
    let sawA = false;
    for (let i = 0; i < 10; i++) {
      if (q.advance() === "a") { sawA = true; break; }
    }
    expect(sawA).toBe(true);
  });

  test("seed produces deterministic initial cursor", () => {
    const q1 = new QueenCoordinator({ peers: ["a", "b", "c", "d", "e"], seed: "fixed-seed" });
    const q2 = new QueenCoordinator({ peers: ["a", "b", "c", "d", "e"], seed: "fixed-seed" });
    expect(q1.currentProposer()).toBe(q2.currentProposer());
  });

  test("different seeds produce (likely) different initial cursors", () => {
    const q1 = new QueenCoordinator({ peers: ["a", "b", "c", "d", "e", "f", "g"], seed: "alpha" });
    const q2 = new QueenCoordinator({ peers: ["a", "b", "c", "d", "e", "f", "g"], seed: "omega" });
    expect(q1.currentProposer()).not.toBe(q2.currentProposer());
  });

  test("reset clears faults and cursor", () => {
    const q = new QueenCoordinator({ peers: ["a", "b", "c"] });
    q.recordFault("a");
    q.advance();
    q.reset();
    expect(q.currentProposer()).toBe("a");
    expect(q.faultCounts()).toEqual({ a: 0, b: 0, c: 0 });
  });

  test("duplicate peer ids are rejected", () => {
    expect(() => new QueenCoordinator({ peers: ["a", "b", "a"] })).toThrow(/duplicate/);
  });
});

describe("createConsensus orchestrator", () => {
  test("returns a handle with the expected surface", () => {
    const c: ConsensusHandle = createConsensus({
      localAgentId: "mike",
      peers: [...FIVE_PEERS],
    });
    expect(c.localAgentId).toBe("mike");
    expect(c.getQuorum()).toBe(3);
    expect(c.getPeers()).toEqual([...FIVE_PEERS]);
    expect(c.getCurrentProposer()).toBe("mike"); // head of seeded round-robin
  });

  test("full lifecycle: propose → castVote × 3 → committed + status reflects", () => {
    const c = createConsensus({ localAgentId: "mike", peers: [...FIVE_PEERS] });
    const { proposalId }: ProposeResult = c.propose({ task: "approve-pr" });
    c.castVote(proposalId, "mike", "yes");
    c.castVote(proposalId, "susan", "yes");
    const final = c.castVote(proposalId, "janet", "yes");
    expect(final.committed).toBe(true);
    const s: ConsensusStatus = c.status();
    expect(s.committed).toBe(1);
    expect(s.rejected).toBe(0);
    expect(s.proposals.some((p) => p.id === proposalId && p.status === "committed")).toBe(true);
  });

  test("viewChange() advances view number and proposer", () => {
    const c = createConsensus({ localAgentId: "mike", peers: [...FIVE_PEERS] });
    const before = c.getCurrentProposer();
    const r = c.viewChange("test-fault");
    expect(r.previousProposer).toBe(before);
    expect(r.viewNumber).toBe(1);
    expect(c.getViewNumber()).toBe(1);
  });
});

describe("getSharedConsensus — singleton", () => {
  beforeEach(() => { resetSharedConsensus(); });

  test("returns the same instance on repeated calls", () => {
    const a = getSharedConsensus();
    const b = getSharedConsensus();
    expect(a).toBe(b);
  });

  test("default roster is the 5-agent Norse set", () => {
    const c = getSharedConsensus();
    expect(c.getPeers()).toEqual(["mike", "susan", "janet", "greg", "brenda"]);
    expect(c.getQuorum()).toBe(DEFAULT_QUORUM);
    expect(c.getPeers().length).toBe(DEFAULT_PEER_COUNT);
    expect(c.localAgentId).toBe("mike");
  });

  test("resetSharedConsensus drops the singleton", () => {
    const a = getSharedConsensus();
    resetSharedConsensus();
    const b = getSharedConsensus();
    expect(a).not.toBe(b);
  });
});

describe("PHASE_ORDER constant", () => {
  test("walks pre-prepare → prepare → commit → reply in order", () => {
    expect(PHASE_ORDER).toEqual(["pre-prepare", "prepare", "commit", "reply"]);
  });
});

describe("DEFAULT_* constants", () => {
  test("default quorum is 3 (3-of-5 simple majority)", () => {
    expect(DEFAULT_QUORUM).toBe(3);
  });
  test("default peer count is 5", () => {
    expect(DEFAULT_PEER_COUNT).toBe(5);
  });
  test("default max faults is 1", () => {
    expect(DEFAULT_MAX_FAULTS).toBe(1);
  });
});