/**
 * federation/pii.ts — PII redaction pipeline with 4 compliance modes.
 *
 * F-038 — ported from ruflo
 * `v3/@claude-flow/plugin-agent-federation/src/domain/services/pii-pipeline-service.ts`
 * but simplified per spec ("For v1, focus on redact (regex-based:
 * emails, SSNs, credit cards, IPs)") while keeping the same
 * 4-mode surface (`soc2 | gdpr | hipaa | permissive`).
 *
 * Compliance modes map to the detection + action matrix:
 *
 *   soc2       — strict; redact emails, IPs, SSNs, credit cards.
 *   gdpr       — strict; redact emails, IPs, names, addresses.
 *   hipaa      — strictest; redact everything we recognise (incl. SSN).
 *   permissive — only block the most damaging (credit cards, JWTs,
 *                AWS keys, private keys, GitHub tokens); pass through
 *                emails / IPs / phone numbers.
 *
 * The transforms are PURE: no I/O, no clocks (other than explicit
 * `now` injection). `apply()` returns a transformed string + the
 * list of detections + a `blocked` flag (true if a hard-blocked
 * PII was found — the caller decides whether to drop the message).
 *
 * No native deps.
 */

/** 4 supported compliance modes for the skeleton. */
export type PiiMode = "soc2" | "gdpr" | "hipaa" | "permissive";

export const PII_MODES: readonly PiiMode[] = ["soc2", "gdpr", "hipaa", "permissive"] as const;

export function isPiiMode(m: unknown): m is PiiMode {
  return typeof m === "string" && (PII_MODES as readonly string[]).includes(m);
}

export type PiiAction = "redact" | "hash" | "pass" | "block";

/** Internal PII categories — finer-grained than the modes. */
export type PiiCategory =
  | "email"
  | "ssn"
  | "credit_card"
  | "ip_address"
  | "phone"
  | "name"
  | "address"
  | "jwt"
  | "aws_key"
  | "private_key"
  | "github_token";

export interface PiiDetection {
  readonly category: PiiCategory;
  readonly value: string;
  readonly offset: number;
  readonly confidence: number;
}

export interface PiiResult {
  readonly transformed: string;
  readonly detections: readonly PiiDetection[];
  readonly actionsApplied: readonly { category: PiiCategory; action: PiiAction }[];
  readonly blocked: boolean;
  readonly mode: PiiMode;
}

interface RegexEntry {
  readonly category: PiiCategory;
  readonly pattern: RegExp;
  readonly confidence: number;
}

/** Detection table — order matters: more-specific patterns come first
 *  so we don't double-match. */
const PATTERNS: readonly RegexEntry[] = [
  // secrets/keys — block in every mode except permissive (which still blocks them)
  { category: "aws_key",       pattern: /\bAKIA[0-9A-Z]{16}\b/g,                         confidence: 0.99 },
  { category: "private_key",   pattern: /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+)?PRIVATE\s+KEY-----/g, confidence: 0.99 },
  { category: "github_token",  pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}\b/g, confidence: 0.97 },
  { category: "jwt",           pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, confidence: 0.95 },
  { category: "credit_card",   pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,                  confidence: 0.94 },
  { category: "ssn",           pattern: /\b\d{3}-\d{2}-\d{4}\b/g,                          confidence: 0.93 },
  { category: "email",         pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, confidence: 0.9 },
  { category: "ip_address",    pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,                  confidence: 0.85 },
  { category: "phone",         pattern: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, confidence: 0.8 },
  { category: "name",          pattern: /\b(?:Mr\.|Mrs\.|Ms\.|Dr\.)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g, confidence: 0.7 },
  { category: "address",       pattern: /\b\d{1,5}\s+(?:[A-Z][a-z]+\s+){1,3}(?:St|Ave|Blvd|Dr|Ln|Rd|Way|Ct)\b/g, confidence: 0.7 },
];

/** Per-mode action policy. `block` means the envelope is rejected
 *  outright (caller drops it); `redact` replaces with
 *  `[REDACTED:<category>]`; `hash` replaces with
 *  `[HASH:<8-char-prefix>]`; `pass` lets it through unchanged. */
const MODE_POLICY: Record<PiiMode, Record<PiiCategory, PiiAction>> = {
  soc2: {
    email: "redact", ssn: "redact", credit_card: "block", ip_address: "redact",
    phone: "redact", name: "pass", address: "pass",
    jwt: "block", aws_key: "block", private_key: "block", github_token: "block",
  },
  gdpr: {
    email: "redact", ssn: "redact", credit_card: "block", ip_address: "redact",
    phone: "redact", name: "redact", address: "redact",
    jwt: "block", aws_key: "block", private_key: "block", github_token: "block",
  },
  hipaa: {
    email: "redact", ssn: "redact", credit_card: "block", ip_address: "redact",
    phone: "redact", name: "redact", address: "redact",
    jwt: "block", aws_key: "block", private_key: "block", github_token: "block",
  },
  permissive: {
    email: "pass", ssn: "redact", credit_card: "block", ip_address: "pass",
    phone: "pass", name: "pass", address: "pass",
    jwt: "block", aws_key: "block", private_key: "block", github_token: "block",
  },
};

const REDACT_TOKEN = (cat: PiiCategory) => `[REDACTED:${cat}]`;
const HASH_PREFIX = 8;

function deterministicHash(value: string, salt: string): string {
  // Lightweight, no-native-dep hash: FNV-1a 32-bit, hex-encoded, then
  // salted + first-N chars. The skeleton doesn't need crypto-grade
  // hashing here — the HMAC envelope signature already provides
  // integrity. This is purely for irreversible string replacement.
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const salted = `${salt}:${h.toString(16).padStart(8, "0")}`;
  let h2 = 0x811c9dc5;
  for (let i = 0; i < salted.length; i++) {
    h2 ^= salted.charCodeAt(i);
    h2 = Math.imul(h2, 0x01000193) >>> 0;
  }
  return h2.toString(16).padStart(8, "0");
}

export interface ApplyOptions {
  /** Salt for hash() actions. Defaults to "bizar". */
  readonly salt?: string;
}

/** Pure-function PII pipeline. Walks the regex table, decides an
 *  action per category under the chosen mode, applies the
 *  replacement. Returns enough metadata for the audit service to
 *  log what was stripped. */
export function apply(
  text: string,
  mode: PiiMode,
  opts: ApplyOptions = {},
): PiiResult {
  if (!isPiiMode(mode)) {
    throw new Error(`apply: unknown mode '${String(mode)}'`);
  }
  const salt = opts.salt ?? "bizar";
  const policy = MODE_POLICY[mode];
  const detections: PiiDetection[] = [];
  const actionsApplied: { category: PiiCategory; action: PiiAction }[] = [];
  let blocked = false;
  let transformed = text;

  // Two-phase: (1) collect ALL detections across ALL categories first,
  // (2) apply per-category actions in reverse-offset order so a
  // `block` on one category doesn't hide detections in later ones.
  for (const entry of PATTERNS) {
    const regex = new RegExp(entry.pattern.source, entry.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = regex.exec(transformed)) !== null) {
      detections.push({
        category: entry.category,
        value: m[0],
        offset: m.index,
        confidence: entry.confidence,
      });
    }
  }

  // Now compute actions per category. `block` short-circuits the
  // whole transform but we still report every detection.
  for (const entry of PATTERNS) {
    const inCategory = detections.filter((d) => d.category === entry.category);
    if (inCategory.length === 0) continue;

    const action = policy[entry.category];
    actionsApplied.push({ category: entry.category, action });
    if (action === "block") {
      blocked = true;
      continue;
    }
    if (action === "pass") continue;

    // Apply right-to-left so earlier offsets remain valid.
    for (const hit of inCategory.reverse()) {
      const replacement =
        action === "redact"
          ? REDACT_TOKEN(entry.category)
          : `[HASH:${deterministicHash(hit.value, salt).slice(0, HASH_PREFIX)}]`;
      transformed =
        transformed.slice(0, hit.offset) +
        replacement +
        transformed.slice(hit.offset + hit.value.length);
    }
  }

  if (blocked) transformed = "";

  return {
    transformed,
    detections,
    actionsApplied,
    blocked,
    mode,
  };
}

/** PiiPipeline — class wrapper for parity with ruflo's
 *  PIIPipelineService shape. Holds a default mode + salt, exposes
 *  `process(text)` and `setMode(mode)`. */
export class PiiPipeline {
  private mode: PiiMode;
  private readonly salt: string;

  constructor(opts: { mode?: PiiMode; salt?: string } = {}) {
    this.mode = opts.mode ?? "soc2";
    this.salt = opts.salt ?? "bizar";
  }

  setMode(mode: PiiMode): void {
    if (!isPiiMode(mode)) throw new Error(`PiiPipeline: unknown mode '${mode}'`);
    this.mode = mode;
  }

  getMode(): PiiMode {
    return this.mode;
  }

  process(text: string): PiiResult {
    return apply(text, this.mode, { salt: this.salt });
  }
}