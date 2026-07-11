/**
 * federation/index.ts — top-level orchestrator + public exports.
 *
 * F-038 — composes the eight federation primitives into a single
 * `createFederation(opts)` factory. The orchestrator wires:
 *
 *   sign    — produce a signed FederationEnvelope (with fresh nonce +
 *             PII redaction + audit log entry).
 *   verify  — verify an inbound envelope (HMAC + nonce window +
 *             trust + policy + audit log entry).
 *   send    — high-level helper: sign + persist outgoing audit.
 *   receive — high-level helper: verify + accept-or-reject + persist
 *             inbound audit.
 *   status  — snapshot for the `federation_status` MCP tool.
 *
 * No native deps. Pure TS over Node `crypto` + `fs`.
 */

import { randomUUID } from "node:crypto";

import {
  canonicalSignablePayload,
  emptyScanResult,
  type EnvelopeBudget,
  type FederationEnvelope,
  type FederationMessageType,
} from "./envelope.js";
import { freshNonce, NonceCache, signEnvelope, verifySignature } from "./hmac.js";
import { apply, isPiiMode, type PiiMode, type PiiResult } from "./pii.js";
import { TrustEvaluator, type PeerState } from "./trust.js";
import { PolicyEngine, type PolicyDecision } from "./policy.js";
import { AuditService } from "./audit.js";
import { FederationBudget, validateBudgetInput, type PerPeerBudget } from "./budget.js";

// ---------------------------------------------------------------------------
// Public re-exports
// ---------------------------------------------------------------------------

export {
  FEDERATION_MESSAGE_TYPES,
  TRUST_AFFECTING_MESSAGE_TYPES,
  isFederationMessageType,
  canonicalSignablePayload,
  envelopeAgeMs,
  emptyScanResult,
  type EnvelopeBudget,
  type FederationEnvelope,
  type FederationMessageType,
  type PiiScanAction,
  type PiiScanDetection,
  type PiiScanResult,
} from "./envelope.js";

export {
  DEFAULT_NONCE_WINDOW_MS,
  NonceCache,
  freshNonce,
  signEnvelope,
  verifySignature,
  type VerifyOptions,
  type VerifyOutcome,
} from "./hmac.js";

export {
  PII_MODES,
  isPiiMode,
  PiiPipeline,
  apply,
  type ApplyOptions,
  type PiiAction,
  type PiiCategory,
  type PiiDetection,
  type PiiMode,
  type PiiResult,
} from "./pii.js";

export {
  MAX_TRUST_AGE_MS,
  MIN_TRUST_SCORE,
  TrustEvaluator,
  type PeerState,
  type TrustDecision,
} from "./trust.js";

export {
  DEFAULT_MAX_HOPS,
  PolicyEngine,
  type PolicyConfig,
  type PolicyDecision,
} from "./policy.js";

export {
  DEFAULT_AUDIT_PATH,
  AuditService,
  type AuditDecision,
  type AuditEntry,
  type AuditServiceOpts,
} from "./audit.js";

export {
  DEFAULT_BUDGET_PATH,
  MAX_TOKENS_CEILING,
  MAX_USD_CEILING,
  FederationBudget,
  validateBudgetInput,
  type FederationBudgetOpts,
  type PerPeerBudget,
  type ReserveResult,
} from "./budget.js";

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface FederationStatusSnapshot {
  readonly nodeId: string;
  readonly nonceCacheSize: number;
  readonly auditSizeBytes: number;
  readonly auditPath: string;
  readonly budget: {
    readonly path: string;
    readonly perPeer: readonly PerPeerBudget[];
    readonly outstandingReservations: number;
  };
  readonly peers: readonly PeerState[];
}

export interface CreateFederationOpts {
  /** Local node id stamped into audit + status payloads. */
  readonly nodeId: string;
  /** Shared HMAC secret. Sender + receiver MUST match. */
  readonly secret: string;
  /** PII redaction mode applied on `sign()`. */
  readonly piiMode?: PiiMode;
  /** Override audit log path. */
  readonly auditPath?: string;
  /** Override budget JSON path. */
  readonly budgetPath?: string;
  /** Optional explicit PolicyEngine (for custom allowlists/blocklists). */
  readonly policy?: PolicyEngine;
  /** Optional explicit TrustEvaluator (custom allowlist). */
  readonly trust?: TrustEvaluator;
  /** Optional explicit AuditService (test-only override). */
  readonly audit?: AuditService;
  /** Optional explicit FederationBudget (test-only override). */
  readonly budget?: FederationBudget;
}

export interface FederationHandle {
  readonly nodeId: string;
  /** PII redaction mode currently in effect. */
  getPiiMode(): PiiMode;
  setPiiMode(mode: PiiMode): void;
  /** Sign + redact + audit. The resulting envelope is ready to
   *  transmit to the peer. */
  sign<T>(input: SignInput<T>): FederationEnvelope<T>;
  /** Verify + admit-or-reject + audit. The caller decides what
   *  to do with the result. */
  receive<T>(envelope: FederationEnvelope<T>): ReceiveResult;
  /** Snapshot for the `federation_status` MCP tool. */
  status(): FederationStatusSnapshot;
  /** Direct access to the underlying services — for advanced
   *  consumers + tests. */
  readonly services: {
    readonly trust: TrustEvaluator;
    readonly policy: PolicyEngine;
    readonly audit: AuditService;
    readonly budget: FederationBudget;
    readonly nonces: NonceCache;
  };
}

export interface SignInput<T> {
  readonly targetNodeId: string;
  readonly sessionId: string;
  readonly messageType: FederationMessageType;
  readonly payload: T;
  readonly budget?: EnvelopeBudget;
  /** If true, skip PII redaction. Defaults to false. */
  readonly skipPii?: boolean;
}

export interface ReceiveResult {
  readonly trusted: boolean;
  readonly policyAllowed: boolean;
  readonly hmacValid: boolean;
  readonly pii: PiiResult;
  readonly envelope: FederationEnvelope;
  readonly rejectionReason?: string;
}

/** Build the orchestrator handle. */
export function createFederation(opts: CreateFederationOpts): FederationHandle {
  if (!opts || typeof opts.nodeId !== "string" || opts.nodeId.length === 0) {
    throw new Error("createFederation: nodeId is required");
  }
  if (typeof opts.secret !== "string" || opts.secret.length === 0) {
    throw new Error("createFederation: secret is required");
  }
  const modeRef: { value: PiiMode } = { value: isPiiMode(opts.piiMode) ? opts.piiMode : "soc2" };

  const trust = opts.trust ?? new TrustEvaluator({ allowlist: [] });
  const policy = opts.policy ?? new PolicyEngine();
  const audit = opts.audit ?? new AuditService({ nodeId: opts.nodeId, path: opts.auditPath });
  const budget = opts.budget ?? new FederationBudget({ path: opts.budgetPath });
  const nonces = new NonceCache();

  function getPiiMode(): PiiMode { return modeRef.value; }
  function setPiiMode(m: PiiMode): void {
    if (!isPiiMode(m)) throw new Error(`unknown PII mode: ${m}`);
    modeRef.value = m;
  }

  function sign<T>(input: SignInput<T>): FederationEnvelope<T> {
    const validated = input.budget
      ? validateBudgetInput(input.budget)
      : { ok: true as const, maxTokens: Number.POSITIVE_INFINITY, maxUsd: Number.POSITIVE_INFINITY, maxHops: 8 };
    if (!validated.ok) throw new Error(`sign: bad budget: ${validated.error}`);

    const env: FederationEnvelope<T> = {
      envelopeId: randomUUID(),
      sourceNodeId: opts.nodeId,
      targetNodeId: input.targetNodeId,
      sessionId: input.sessionId,
      messageType: input.messageType,
      payload: input.payload,
      timestamp: new Date().toISOString(),
      nonce: freshNonce(),
      hmacSignature: "", // filled in below
      piiScanResult: emptyScanResult(),
      budget: {
        maxTokens: validated.maxTokens,
        maxUsd: validated.maxUsd,
        maxHops: validated.maxHops,
      },
      hopCount: 0,
      hopsRemaining: validated.maxHops,
    };

    // PII redaction over the stringified payload — keep the result
    // in `piiScanResult` so the receiver can audit what was stripped.
    let pii: PiiResult = { transformed: "", detections: [], actionsApplied: [], blocked: false, mode: modeRef.value };
    if (!input.skipPii && typeof input.payload === "string") {
      pii = apply(input.payload, modeRef.value);
      if (pii.blocked) {
        audit.record({
          ts: new Date().toISOString(),
          envelopeId: env.envelopeId,
          sourceNodeId: env.sourceNodeId,
          targetNodeId: env.targetNodeId,
          messageType: env.messageType,
          nonce: env.nonce,
          allowed: false,
          reason: `pii_blocked (mode=${modeRef.value})`,
          layer: "budget",
        });
      }
    }

    const finalEnv: FederationEnvelope<T> = {
      ...env,
      payload: (pii.transformed ? (pii.transformed as unknown as T) : input.payload),
      piiScanResult: pii.detections.length > 0
        ? {
            scanned: true,
            piiFound: true,
            detections: pii.detections.map((d) => ({
              type: d.category,
              action: "redact",
              confidence: d.confidence,
              count: 1,
            })),
            actionsApplied: pii.actionsApplied.map((a) => a.action),
            scanDurationMs: 0,
          }
        : emptyScanResult(),
    };

    const signature = signEnvelope(finalEnv, opts.secret);
    const signed: FederationEnvelope<T> = { ...finalEnv, hmacSignature: signature };

    audit.record({
      ts: signed.timestamp,
      envelopeId: signed.envelopeId,
      sourceNodeId: signed.sourceNodeId,
      targetNodeId: signed.targetNodeId,
      messageType: signed.messageType,
      nonce: signed.nonce,
      allowed: true,
      reason: `signed (pii_mode=${modeRef.value})`,
      layer: "sent",
    });
    return signed;
  }

  function receive<T>(envelope: FederationEnvelope<T>): ReceiveResult {
    // 1. HMAC + freshness + nonce replay
    const verifyOut = verifySignature(envelope, opts.secret, nonces as unknown as ReadonlySet<string>);
    if (verifyOut.ok) {
      nonces.check(envelope.nonce);
    }

    const piiScanResult = envelope.piiScanResult ?? emptyScanResult();
    const pii: PiiResult = {
      transformed: typeof envelope.payload === "string" ? envelope.payload : "",
      detections: piiScanResult.detections.map((d) => ({
        category: d.type as never,
        value: "",
        offset: 0,
        confidence: d.confidence,
      })),
      actionsApplied: piiScanResult.actionsApplied.map((a) => ({ category: "email", action: a })),
      blocked: false,
      mode: modeRef.value,
    };

    let trusted = false;
    let policyAllowed = false;
    let rejectionReason: string | undefined;

    if (!verifyOut.ok) {
      rejectionReason = `hmac:${verifyOut.reason}`;
      audit.record({
        ts: new Date().toISOString(),
        envelopeId: envelope.envelopeId,
        sourceNodeId: envelope.sourceNodeId,
        targetNodeId: envelope.targetNodeId,
        messageType: envelope.messageType,
        nonce: envelope.nonce,
        allowed: false,
        reason: rejectionReason,
        layer: "hmac",
      });
    } else {
      // 2. Trust
      const peer: PeerState = trust.getPeerState(envelope.sourceNodeId);
      const trustOut = trust.evaluate(envelope, peer);
      trusted = trustOut.allowed;
      if (!trusted) {
        rejectionReason = `trust:${trustOut.reason}`;
        trust.recordOutcome(envelope.sourceNodeId, false);
        audit.record({
          ts: new Date().toISOString(),
          envelopeId: envelope.envelopeId,
          sourceNodeId: envelope.sourceNodeId,
          targetNodeId: envelope.targetNodeId,
          messageType: envelope.messageType,
          nonce: envelope.nonce,
          allowed: false,
          reason: rejectionReason,
          layer: "trust",
        });
      } else {
        trust.recordOutcome(envelope.sourceNodeId, true);
        // 3. Policy (hops + blocklist + message allowlist)
        const polOut: PolicyDecision = policy.enforce(envelope, envelope.budget);
        policyAllowed = polOut.allowed;
        if (!polOut.allowed) {
          rejectionReason = `policy:${polOut.denialReason}`;
          audit.record({
            ts: new Date().toISOString(),
            envelopeId: envelope.envelopeId,
            sourceNodeId: envelope.sourceNodeId,
            targetNodeId: envelope.targetNodeId,
            messageType: envelope.messageType,
            nonce: envelope.nonce,
            allowed: false,
            reason: rejectionReason,
            layer: "policy",
          });
        } else {
          audit.record({
            ts: new Date().toISOString(),
            envelopeId: envelope.envelopeId,
            sourceNodeId: envelope.sourceNodeId,
            targetNodeId: envelope.targetNodeId,
            messageType: envelope.messageType,
            nonce: envelope.nonce,
            allowed: true,
            reason: `accepted (score=${trustOut.score.toFixed(3)})`,
            layer: "received",
          });
        }
      }
    }

    return {
      trusted,
      policyAllowed,
      hmacValid: verifyOut.ok,
      pii,
      envelope,
      rejectionReason,
    };
  }

  function status(): FederationStatusSnapshot {
    // Synthesize a peer list from audit history + TrustEvaluator internal map.
    const peerIds = new Set<string>();
    const tail = audit.tail(1000);
    for (const entry of tail) peerIds.add(entry.sourceNodeId);
    const peerSnapshots: PeerState[] = [];
    for (const id of peerIds) peerSnapshots.push(trust.getPeerState(id));

    return {
      nodeId: opts.nodeId,
      nonceCacheSize: nonces.size(),
      auditSizeBytes: audit.size(),
      auditPath: audit.getPath(),
      budget: {
        path: opts.budgetPath ?? ".harness/federation-budget.json",
        perPeer: budget.snapshot(),
        outstandingReservations: budget.outstanding().length,
      },
      peers: peerSnapshots,
    };
  }

  return {
    nodeId: opts.nodeId,
    getPiiMode,
    setPiiMode,
    sign,
    receive,
    status,
    services: { trust, policy, audit, budget, nonces },
  };
}

// ---------------------------------------------------------------------------
// Convenience helper — re-export `canonicalSignablePayload` so callers
// that want to compute their own signature can import it from the top.
// ---------------------------------------------------------------------------

export { canonicalSignablePayload as buildSignablePayload };

// ---------------------------------------------------------------------------
// Helper for tests — produce a fresh envelope-id.
// ---------------------------------------------------------------------------

export function freshEnvelopeId(): string {
  return randomUUID();
}