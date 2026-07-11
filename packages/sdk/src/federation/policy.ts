/**
 * federation/policy.ts — PolicyEngine: enforces per-call envelope
 * constraints (maxHops, action allowlist, peer blocklist).
 *
 * F-038 — ported from ruflo
 * `v3/@claude-flow/plugin-agent-federation/src/application/policy-engine.ts`
 * but stripped to the three checks the skeleton needs:
 *
 *   1. maxHops  — envelope.hopCount must be < budget.maxHops
 *                 (default ceiling = 3 hops).
 *   2. message  — envelope.messageType must be in the action
 *                 allowlist.
 *   3. peer     — source node must NOT be in the blocklist.
 *
 * `enforce(envelope, budget)` returns a discriminated result so
 * callers can map directly to an MCP error string.
 */

import {
  FEDERATION_MESSAGE_TYPES,
  isFederationMessageType,
  type EnvelopeBudget,
  type FederationEnvelope,
  type FederationMessageType,
} from "./envelope.js";

/** Hard ceiling on hops — matches the spec's "≤ 3" rule. */
export const DEFAULT_MAX_HOPS = 3;

export type PolicyDecision =
  | { allowed: true }
  | {
      allowed: false;
      denialReason:
        | "max_hops_exceeded"
        | "message_type_not_allowed"
        | "peer_blocked"
        | "budget_missing"
        | "budget_invalid";
    };

export interface PolicyConfig {
  /** Set of message kinds accepted by this node. Defaults to all
   *  16 ruflo kinds — narrow via `allowedMessageTypes`. */
  readonly allowedMessageTypes?: readonly FederationMessageType[];
  /** Set of sourceNodeIds that are NEVER accepted (blocklist). */
  readonly peerBlocklist?: readonly string[];
  /** Override the default maxHops ceiling. */
  readonly maxHops?: number;
}

export class PolicyEngine {
  private readonly allowed: Set<FederationMessageType>;
  private readonly blocked: Set<string>;
  private readonly maxHops: number;

  constructor(cfg: PolicyConfig = {}) {
    this.allowed = new Set(cfg.allowedMessageTypes ?? FEDERATION_MESSAGE_TYPES);
    this.blocked = new Set((cfg.peerBlocklist ?? []).map((s) => String(s)));
    this.maxHops = cfg.maxHops ?? DEFAULT_MAX_HOPS;
  }

  /** Runtime mutator — narrow the allowlist after construction. */
  allowMessageType(t: FederationMessageType): void {
    this.allowed.add(t);
  }

  /** Runtime mutator — narrow the allowlist after construction. */
  denyMessageType(t: FederationMessageType): void {
    this.allowed.delete(t);
  }

  /** Runtime mutator — block / unblock a peer at runtime. */
  setBlocked(nodeId: string, blocked: boolean): void {
    if (blocked) this.blocked.add(nodeId);
    else this.blocked.delete(nodeId);
  }

  /** Admit or reject an envelope given its budget context. */
  enforce(envelope: FederationEnvelope, budget: EnvelopeBudget | undefined): PolicyDecision {
    // 0. The budget object must exist — without it we can't enforce
    // the maxHops ceiling.
    if (!budget) return { allowed: false, denialReason: "budget_missing" };
    if (typeof budget.maxHops !== "number" || !Number.isFinite(budget.maxHops)) {
      return { allowed: false, denialReason: "budget_invalid" };
    }

    // 1. Peer blocklist
    if (this.blocked.has(envelope.sourceNodeId)) {
      return { allowed: false, denialReason: "peer_blocked" };
    }

    // 2. Message type allowlist
    if (!isFederationMessageType(envelope.messageType)) {
      return { allowed: false, denialReason: "message_type_not_allowed" };
    }
    if (!this.allowed.has(envelope.messageType)) {
      return { allowed: false, denialReason: "message_type_not_allowed" };
    }

    // 3. maxHops — current hopCount must be strictly LESS than the
    // ceiling. A freshly-origin envelope has hopCount=0 so a
    // maxHops=3 budget admits it.
    const hopCount = envelope.hopCount ?? 0;
    const effectiveCeiling = Math.min(budget.maxHops, this.maxHops);
    if (hopCount >= effectiveCeiling) {
      return { allowed: false, denialReason: "max_hops_exceeded" };
    }

    return { allowed: true };
  }
}