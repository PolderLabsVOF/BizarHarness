/**
 * federation/envelope.ts — Federation envelope type and message kinds.
 *
 * F-038 — ported from ruflo
 * `v3/@claude-flow/plugin-agent-federation/src/domain/entities/federation-envelope.ts:1-20`
 * (the 16-kind `FederationMessageType` union + `FederationEnvelope` shape).
 *
 * This module is intentionally minimal: it exports ONLY types + a
 * tiny `emptyScanResult()` helper. The runtime signing/verification
 * lives in `./hmac.ts`, PII in `./pii.ts`, audit in `./audit.ts`,
 * budget in `./budget.ts`. Keeping the type isolated here avoids a
 * cycle with the signing/policy modules that import from this file.
 *
 * Backward-compat note: Bizar's v6.4.0 release (current `master`)
 * shipped zero federation code, so anything we add is purely
 * additive — no consumers can break. The 16 message kinds are
 * defined as a `readonly` array AND a union type so the validator
 * surface (e.g. PolicyEngine) can iterate without re-listing them.
 */

/**
 * Wire-level message kinds carried inside a federation envelope.
 * 16 total — kept identical to the ruflo source so cross-installation
 * pairs can interoperate if both run a Bizar build ≥ v6.5.0.
 */
export const FEDERATION_MESSAGE_TYPES = [
  "task-assignment",
  "memory-query",
  "memory-response",
  "context-share",
  "status-broadcast",
  "trust-change",
  "topology-change",
  "agent-spawn",
  "heartbeat",
  "challenge",
  "challenge-response",
  "handshake-init",
  "handshake-accept",
  "handshake-reject",
  "session-terminate",
  "claim-event",
  "agent-handoff",
] as const;

export type FederationMessageType = (typeof FEDERATION_MESSAGE_TYPES)[number];

/** Is `t` a recognised federation message kind? Useful for validation. */
export function isFederationMessageType(t: unknown): t is FederationMessageType {
  return typeof t === "string" && (FEDERATION_MESSAGE_TYPES as readonly string[]).includes(t);
}

/** Subset of message kinds that mutate trust / topology state — those
 *  that should require extra policy scrutiny (mirrors ruflo's
 *  CONSENSUS_REQUIRED_TYPES set, minus the consensus-vote-specific
 *  types that don't apply to the skeleton). */
export const TRUST_AFFECTING_MESSAGE_TYPES: ReadonlySet<FederationMessageType> = new Set<FederationMessageType>([
  "trust-change",
  "topology-change",
  "agent-spawn",
  "agent-handoff",
]);

/** Outcome of a PII scan over the envelope payload. Mirrors ruflo's
 *  PIIScanResult so audit consumers can read either implementation
 *  interchangeably. */
export type PiiScanAction = "pass" | "redact" | "hash" | "block";

export interface PiiScanDetection {
  readonly type: string;
  readonly action: PiiScanAction;
  readonly confidence: number;
  readonly count: number;
}

export interface PiiScanResult {
  readonly scanned: boolean;
  readonly piiFound: boolean;
  readonly detections: readonly PiiScanDetection[];
  readonly actionsApplied: readonly PiiScanAction[];
  readonly scanDurationMs: number;
}

/** Empty / no-op scan result — used by senders that opt out of PII
 *  scanning for the given message kind. */
export function emptyScanResult(): PiiScanResult {
  return {
    scanned: false,
    piiFound: false,
    detections: [],
    actionsApplied: [],
    scanDurationMs: 0,
  };
}

/** Per-peer budget attached to every envelope. `maxTokens` and
 *  `maxUsd` are the sender's original limits for the call; the
 *  remote decrements them as the message fans out. `maxHops` is
 *  the absolute hop ceiling (sender's value). */
export interface EnvelopeBudget {
  readonly maxTokens: number;
  readonly maxUsd: number;
  readonly maxHops: number;
}

export interface FederationEnvelope<T = unknown> {
  readonly envelopeId: string;
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly sessionId: string;
  readonly messageType: FederationMessageType;
  readonly payload: T;
  readonly timestamp: string; // ISO-8601, parsed back via new Date()
  readonly nonce: string; // 128-bit random via crypto.randomUUID()
  readonly hmacSignature: string; // hex SHA-256 HMAC over canonical payload
  readonly piiScanResult: PiiScanResult;
  readonly budget?: EnvelopeBudget;
  readonly hopCount?: number; // present on re-emit, defaults to 0 on origin
  readonly hopsRemaining?: number;
}

/** Canonical JSON form signed by HMAC. Field order MUST stay stable
 *  across sender + receiver or signatures will mismatch. */
export function canonicalSignablePayload<T>(e: FederationEnvelope<T>): string {
  const obj = {
    envelopeId: e.envelopeId,
    sourceNodeId: e.sourceNodeId,
    targetNodeId: e.targetNodeId,
    sessionId: e.sessionId,
    messageType: e.messageType,
    payload: e.payload,
    timestamp: e.timestamp,
    nonce: e.nonce,
    hopCount: e.hopCount ?? 0,
  };
  return JSON.stringify(obj);
}

/** `Date.now()`-based envelope age in milliseconds. */
export function envelopeAgeMs(e: FederationEnvelope, now: number = Date.now()): number {
  const ts = new Date(e.timestamp).getTime();
  if (!Number.isFinite(ts)) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - ts);
}