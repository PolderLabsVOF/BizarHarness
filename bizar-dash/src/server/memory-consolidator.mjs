/**
 * memory-consolidator.mjs — thin wrapper around `memory-distillation.mjs`.
 *
 * v6.4.0 — ported from ruflo ADR-174. The consolidator reads from the
 * dashboard's `memory-store.mjs`, runs the RETRIEVE → JUDGE → DISTILL
 * → CONSOLIDATE pipeline, and writes promoted patterns back to the
 * vault as new entries of `kind: 'pattern'`.
 *
 * Idempotency: a second run with the same input produces the same
 * patterns. The write-back is deduped by `pattern.id` (file stem
 * `pat_<hash>.md`); already-existing pattern files are skipped, not
 * overwritten. This honours the ADR-174 invariant:
 *   "memory_entries source preservation — row count + content
 *    unchanged after a run; promoted patterns are additive"
 *
 * Public surface:
 *   - runConsolidation({ projectRoot, since }) → { distilled, promoted, byTier, written }
 *   - runConsolidationInMemory(entries)       → same shape minus `written`
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { listNotes, writeNote } from "./memory-store.mjs";
// F-041 follow-up: import the BUILT SDK memory module from `dist/`,
// not the TS source at `src/`. The src/ directory only ships the
// .ts files; the dashboard runs against the compiled .js output in
// dist/. v7.0.0 shipped with the src/ path, which makes the dashboard
// crash with `Cannot find module .../src/memory/index.js` on startup.
// Pointing at `dist/` matches what the SDK's package.json `exports`
// map already advertises.
import { resolveVaultRoot } from "../../../packages/sdk/dist/memory/index.js";
import { runDistillation } from "./memory-distillation.mjs";

/**
 * Where the dashboard-side machine-readable distill log is written.
 * `.bizar/distilled-patterns.json` lives at the repo root so that the
 * dashboard UI, the Odin prompt primer, and the verification scripts
 * can all reach it without dipping into the vault. Format is
 * ADR-174-compliant:
 *
 *   {
 *     "version": 1,
 *     "generatedAt": "<iso8601>",
 *     "byTier": { "oracle:test-exec": N, "proxy:structural": N, "judge:fable": N },
 *     "patterns": [
 *       { "id", "kind", "summary", "uses": [...], "evidence": [...],
 *         "provenance_tier", "promoted", "score", "forgettingRate" },
 *       ...
 *     ]
 *   }
 */
export const DISTILLED_PATTERNS_FILE = ".bizar/distilled-patterns.json";

/**
 * In-memory variant — pure function over the entries you pass in.
 * Exposed for unit tests and the `memory_distill` MCP tool.
 *
 * @param {Array<Record<string, unknown>>} entries
 */
export function runConsolidationInMemory(entries) {
  const result = runDistillation(entries);
  return {
    distilled: result.patterns.length,
    promoted: result.promoted.map((p) => p.id),
    patterns: result.patterns,
    byTier: result.byTier,
  };
}

/**
 * Vault-backed variant — reads notes from the dashboard vault, runs
 * the pipeline, and writes promoted patterns back.
 *
 * @param {{ projectRoot?: string, since?: string }} [opts]
 */
export function runConsolidation(opts = {}) {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const since = opts.since ? new Date(opts.since) : null;

  // Read every note. `listNotes` is gitignore-aware and skips .obsidian/.
  const notes = listNotes(projectRoot, { limit: 10000 });

  // Adapter: dashboard's `listNotes` returns the SDK `MemoryNote`
  // shape; the distiller wants the Bizar memory schema. We bridge by
  // aliasing frontmatter fields the distiller reads.
  const entries = notes
    .filter((n) => !since || since <= parseCreatedAt(n))
    .map((n) => ({
      memory_id: n.relPath,
      path: n.relPath,
      relPath: n.relPath,
      frontmatter: n.frontmatter ?? {},
      body: n.body ?? "",
      kind: n.frontmatter?.kind ?? n.frontmatter?.type,
      created: n.frontmatter?.createdAt ?? n.frontmatter?.created,
      createdAt: n.frontmatter?.createdAt,
      updatedAt: n.frontmatter?.updatedAt,
      tags: n.frontmatter?.tags,
    }));

  const result = runDistillation(entries);

  // Write promoted patterns back. Idempotent: skip if already exists
  // (a prior run produced the same pattern file).
  const written = [];
  for (const p of result.promoted) {
    const fm = {
      kind: "pattern",
      promoted: true,
      provenance_tier: p.provenance_tier,
      uses: p.uses.length,
      score: p.score,
      createdAt: new Date().toISOString(),
      tags: ["pattern", "distilled"],
    };
    const body = [
      `# ${p.summary}`,
      "",
      `_provenance_tier: ${p.provenance_tier}_`,
      `_promoted: yes_`,
      `_uses: ${p.uses.length}_`,
      "",
      "## Evidence",
      "",
      ...p.evidence,
    ].join("\n");

    const relPath = `patterns/${p.id}.md`;
    // If the file already exists, leave it alone (idempotent).
    const existing = notes.find((n) => n.relPath === relPath);
    if (existing) continue;

    try {
      const out = writeNote(projectRoot, relPath, { frontmatter: fm, body });
      written.push(out.relPath);
    } catch {
      // Best-effort writes — a vault with read-only test vault
      // shouldn't crash the distillation.
    }
  }

  return {
    distilled: result.patterns.length,
    promoted: result.promoted.map((p) => p.id),
    patterns: result.patterns,
    byTier: result.byTier,
    written,
  };
}

/**
 * Write the on-disk distill log (`.bizar/distilled-patterns.json`).
 * Idempotent and best-effort — does NOT throw. Returns the absolute
 * (or relative-to-projectRoot) path of the file written, or `null`
 * if the write was skipped (e.g. directory not writable).
 *
 * Decorates each pattern with:
 *   - `forgettingRate`: 0.0–1.0 (smaller = more durable). Computed
 *     as `1 / (1 + uses.length)` per ADR-174 §"CONSOLIDATE".
 *   - `promoted`: copied from the distiller.
 *   - `provenance_tier`: copied verbatim.
 *
 * @param {ReturnType<typeof runConsolidation>} consolidation
 * @param {{ projectRoot?: string, filePath?: string }} [opts]
 * @returns {string | null}
 */
export function writeDistilledPatternsFile(consolidation, opts = {}) {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const fp = opts.filePath
    ? (opts.filePath.startsWith("/") ? opts.filePath : join(projectRoot, opts.filePath))
    : join(projectRoot, DISTILLED_PATTERNS_FILE);

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    byTier: consolidation.byTier ?? {
      "oracle:test-exec": 0,
      "proxy:structural": 0,
      "judge:fable": 0,
    },
    distilled: consolidation.distilled ?? 0,
    promoted: consolidation.promoted ?? [],
    patterns: (consolidation.patterns ?? []).map((p) => ({
      id: p.id,
      kind: p.kind ?? "pattern",
      summary: p.summary ?? "",
      uses: p.uses ?? [],
      evidence: p.evidence ?? [],
      provenance_tier: p.provenance_tier ?? "proxy:structural",
      promoted: Boolean(p.promoted),
      score: typeof p.score === "number" ? p.score : 0.5,
      forgettingRate: forgettingRate(p.uses ?? []),
    })),
  };

  try {
    mkdirSync(dirname(fp), { recursive: true });
    writeFileSync(fp, JSON.stringify(payload, null, 2), "utf-8");
    return fp;
  } catch {
    return null;
  }
}

/**
 * Forgetfulness score (ADR-174 §"forgetting curve"). Patterns with
 * more `uses` are more durable; a brand-new pattern is 1.0 (fully
 * forgettable); a pattern with 4 uses settles at 0.2.
 */
function forgettingRate(uses) {
  const n = Array.isArray(uses) ? uses.length : 0;
  return 1 / (1 + n);
}

function parseCreatedAt(note) {
  const t = note?.frontmatter?.createdAt ?? note?.frontmatter?.created;
  if (!t) return new Date(0);
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? new Date(0) : d;
}

/** Re-export so the dashboard server can `import { resolveVaultRoot }
 *  from './memory-consolidator.mjs'` when wiring the MCP tool. */
export { resolveVaultRoot };
