/**
 * federation/hmac.ts — HMAC-SHA-256 signing + verification for
 * federation envelopes.
 *
 * F-038 — security-critical. Pinned by AGENTS.md hard constraint:
 *   "MUST use crypto.timingSafeEqual for HMAC comparison
 *    (timing-attack resistant)."
 *   "MUST use crypto.randomUUID() for nonces (128-bit random)."
 *
 * Nonce strategy:
 *   - Sender generates a fresh `crypto.randomUUID()` per envelope.
 *   - Receiver tracks every nonce it has seen in a TTL-bounded Set.
 *   - An envelope whose nonce appears twice is a replay → reject.
 *   - An envelope whose timestamp is older than `nonceWindowMs`
 *     (default 5 min) is also a replay → reject.
 *
 * No native deps. Pure Node `node:crypto`.
 */

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  canonicalSignablePayload,
  type FederationEnvelope,
} from "./envelope.js";

/** Default freshness window for HMAC verification (5 minutes). */
export const DEFAULT_NONCE_WINDOW_MS = 5 * 60 * 1000;

/** Cap on the receiver's seen-nonce set so it can't grow unbounded. */
const SEEN_NONCE_CAP = 10_000;

/** Compute a deterministic 64-char hex HMAC-SHA-256 over the envelope's
 *  canonical signable payload. */
export function signEnvelope<T>(
  envelope: FederationEnvelope<T>,
  secret: string,
): string {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("signEnvelope: secret must be a non-empty string");
  }
  const payload = canonicalSignablePayload(envelope);
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export interface VerifyOptions {
  /** Freshness window. Envelopes older than this are rejected.
   *  Defaults to 5 minutes. */
  readonly nonceWindowMs?: number;
  /** Optional clock-skew offset (ms) to *add* to the freshness
   *  window (e.g. for poorly-synced peers). Defaults to 0. */
  readonly clockSkewMs?: number;
  /** Optional explicit timestamp for deterministic tests. */
  readonly now?: number;
}

export type VerifyOutcome =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "signature_mismatch"
        | "nonce_replay"
        | "envelope_expired"
        | "envelope_from_future"
        | "invalid_signature_format";
    };

/** Pure verifier — no shared state. The caller owns the seen-nonce
 *  cache (see `NonceCache` below) and passes it in via `seen`. */
export function verifySignature<T>(
  envelope: FederationEnvelope<T>,
  secret: string,
  seen: ReadonlySet<string>,
  opts: VerifyOptions = {},
): VerifyOutcome {
  if (typeof secret !== "string" || secret.length === 0) {
    return { ok: false, reason: "invalid_signature_format" };
  }
  if (typeof envelope.hmacSignature !== "string" || envelope.hmacSignature.length === 0) {
    return { ok: false, reason: "invalid_signature_format" };
  }

  // Freshness — reject before we touch the HMAC code path so we
  // don't burn cycles on ancient replays.
  const now = opts.now ?? Date.now();
  const ts = new Date(envelope.timestamp).getTime();
  if (!Number.isFinite(ts)) return { ok: false, reason: "envelope_expired" };
  const ageMs = now - ts;
  const window = (opts.nonceWindowMs ?? DEFAULT_NONCE_WINDOW_MS) + (opts.clockSkewMs ?? 0);
  if (ageMs > window) return { ok: false, reason: "envelope_expired" };
  if (ageMs < -window) return { ok: false, reason: "envelope_from_future" };

  // Nonce replay — checked AFTER freshness so a delayed-but-unique
  // envelope doesn't get falsely fingerprinted as a replay.
  if (seen.has(envelope.nonce)) return { ok: false, reason: "nonce_replay" };

  // Constant-time signature compare. Both buffers must be the same
  // length for timingSafeEqual; if lengths differ, signature_mismatch.
  const expected = signEnvelope(envelope, secret);
  const a = Buffer.from(expected, "hex");
  let b: Buffer;
  try {
    b = Buffer.from(envelope.hmacSignature, "hex");
  } catch {
    return { ok: false, reason: "invalid_signature_format" };
  }
  if (a.length !== b.length) return { ok: false, reason: "signature_mismatch" };
  if (!timingSafeEqual(a, b)) return { ok: false, reason: "signature_mismatch" };

  return { ok: true };
}

/** Mutable nonce cache with TTL eviction + hard cap. The receiver
 *  keeps one per remote node (or a single global one for the skeleton). */
export class NonceCache {
  private readonly seen = new Map<string, number>(); // nonce → expiryMs
  private readonly windowMs: number;

  constructor(windowMs: number = DEFAULT_NONCE_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  /** True if the nonce is fresh (not seen in windowMs). Adds it
   *  to the cache as a side effect. */
  check(nonce: string, now: number = Date.now()): boolean {
    this.evict(now);
    if (this.seen.has(nonce)) return false;
    if (this.seen.size >= SEEN_NONCE_CAP) {
      // Hard cap — evict the oldest entry to make room.
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.set(nonce, now + this.windowMs);
    return true;
  }

  /** True if the nonce is in the cache (read-only). */
  has(nonce: string): boolean {
    return this.seen.has(nonce);
  }

  size(): number {
    return this.seen.size;
  }

  clear(): void {
    this.seen.clear();
  }

  private evict(now: number): void {
    for (const [nonce, expiry] of this.seen) {
      if (expiry <= now) this.seen.delete(nonce);
    }
  }
}

/** Helper — produce a fresh nonce via `crypto.randomUUID()`. */
export function freshNonce(): string {
  return randomUUID();
}