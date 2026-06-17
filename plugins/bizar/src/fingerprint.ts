/**
 * fingerprint.ts
 *
 * Stable hash of (tool, args) for loop detection.
 * Uses canonical key ordering and path normalization per §5.3.
 */

import { createHash } from "node:crypto";
import path from "node:path";

/**
 * Recursively sort object keys into canonical (alphabetical) order
 * and return a stable string representation.
 */
function canonicalStringify(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "boolean") return String(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return JSON.stringify(value);

  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(",")}]`;
  }

  if (typeof value === "object") {
    const sorted = Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (value as Record<string, unknown>)[key];
        return acc;
      }, {});

    const pairs = Object.entries(sorted)
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalStringify(v)}`)
      .join(",");
    return `{${pairs}}`;
  }

  // functions, symbols, etc. — stringify as a tag
  return Object.prototype.toString.call(value);
}

/**
 * Normalize a value for fingerprinting:
 * - Strip noise fields (timestamps, IDs, nonces, cwd)
 * - Resolve paths: in-worktree → relative, out-of-worktree → per-path hash
 */
/**
 * Normalize a string value that may be a path.
 * Returns worktree-relative for in-worktree paths, per-path hash for outside paths.
 */
function normalizePath(v: string, worktree: string): string {
  if (!path.isAbsolute(v)) return v;
  const rel = path.relative(worktree, v);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    return rel;
  }
  // outside worktree — per-path stable hash
  const h = createHash("sha256").update(v).digest("hex");
  return `path:${h.slice(0, 16)}`;
}

function normalize(value: unknown, worktree: string): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    // Path normalization for strings that are absolute paths
    return normalizePath(value, worktree);
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalize(item, worktree));
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    // Per §5.3: strip fields whose name contains time/stamp/created/updated/timestamp
    const SKIP_TIME_FIELDS =
      /(^|_)time($|_)|stamp|created|updated|timestamp/i;

    // Per §5.3: strip ID/nonce fields by exact name
    const SKIP_FIELDS = /^(id|uuid|nonce|requestId|traceId)$/i;

    for (const [k, v] of Object.entries(obj)) {
      // strip cwd field entirely per §5.3
      if (k === "cwd") continue;
      // strip ID/nonce fields per §5.3
      if (SKIP_FIELDS.test(k)) continue;
      // strip timestamp fields per §5.3
      if (SKIP_TIME_FIELDS.test(k) && (typeof v === "number" || typeof v === "string")) continue;

      // normalize (includes path normalization for strings via normalizePath)
      result[k] = normalize(v, worktree);
    }

    return result;
  }

  return value;
}

/**
 * Compute a stable fingerprint for a (tool, args) pair.
 *
 * Canonical key order is guaranteed by sorting keys before stringify.
 * Paths are normalized per §5.3: in-worktree → relative, out-of-worktree → per-path hash.
 *
 * @param tool  Tool name (e.g. "read", "bash")
 * @param args  Raw tool arguments
 * @param worktree  Absolute path to the worktree root (used for path normalization)
 */
export function fingerprint(tool: string, args: unknown, worktree: string): string {
  const normalized = normalize(args, worktree);
  const stable = canonicalStringify({ tool, args: normalized });
  return createHash("sha256").update(stable, "utf8").digest("hex");
}