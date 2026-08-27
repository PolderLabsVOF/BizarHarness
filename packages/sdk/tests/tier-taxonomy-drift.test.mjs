/**
 * IMP-015 acceptance test — Canonical tier taxonomy drift guard.
 *
 * Scans `packages/sdk/src/` for any leftover 3-tier vocabulary
 * (`ModelTier`, `flash`, `expensive`) that would re-introduce the
 * canonical-taxonomy mismatch. The 6-tier vocabulary is the source of
 * truth (`packages/sdk/src/router/agent-model-registry.ts#BizarTier`):
 *   premium | high | mid-design | default | mid | budget
 *
 * The mapping for callers migrating from the legacy vocabulary:
 *   flash     -> budget
 *   mid       -> mid
 *   expensive -> premium
 *
 * Run via: vitest run packages/sdk/tests/tier-taxonomy-drift.test.mjs
 */

import { describe, test, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const SDK_ROOT = join(here, "..", "..", "..");
const SDK_SRC = join(here, "..", "src");
const MODEL_ROUTER = join(SDK_SRC, "router", "model-router.ts");
const ROUTER_INDEX = join(SDK_SRC, "router", "index.ts");

/** Recursively collect every file under `dir`. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const fp = join(dir, entry);
    const st = statSync(fp);
    if (st.isDirectory()) out.push(...walk(fp));
    else out.push(fp);
  }
  return out;
}

/**
 * Format a list of {file, line, snippet} hits into a human-readable
 * failure message. Used by every assertion below.
 */
function formatHits(label, hits) {
  const lines = hits.map((h) => {
    const rel = relative(SDK_ROOT, h.file).split(sep).join("/");
    return `  ${rel}:${h.line}  ${h.snippet}`;
  });
  return `${label} found ${hits.length} occurrence(s):\n${lines.join("\n")}`;
}

/**
 * Search `file` for `pattern` and collect every match with a 1-based
 * line number and the trimmed source line. Multi-line matches are
 * skipped — only single-line occurrences are reported.
 */
function findLines(file, pattern) {
  const text = readFileSync(file, "utf-8");
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (pattern.test(line)) {
      hits.push({ file, line: i + 1, snippet: line.trim() });
    }
  }
  return hits;
}

describe("tier taxonomy drift guard (IMP-015)", () => {
  test("model-router.ts does NOT declare or reference the legacy ModelTier alias", () => {
    const file = MODEL_ROUTER;
    // Match every shape of ModelTier usage: declaration, type-annotation,
    // generic param, array suffix, cast, or re-export.
    const modelTierHits = [
      ...findLines(file, /\btype\s+ModelTier\b/),
      ...findLines(file, /\bModelTier\s*=/),
      ...findLines(file, /:\s*ModelTier\b/),
      ...findLines(file, /<ModelTier\s*,/),
      ...findLines(file, /\bModelTier\[\]/),
      ...findLines(file, /\bas\s+ModelTier\b/),
      ...findLines(file, /\bModelTier\b/), // any remaining bare identifier
    ];
    expect(modelTierHits, formatHits("model-router.ts ModelTier", modelTierHits)).toEqual([]);
  });

  test("router/index.ts does NOT re-export or annotate the legacy ModelTier alias", () => {
    const file = ROUTER_INDEX;
    const modelTierHits = [
      ...findLines(file, /\btype\s+ModelTier\b/),
      ...findLines(file, /\bModelTier\s*=/),
      ...findLines(file, /:\s*ModelTier\b/),
      ...findLines(file, /\bModelTier\b/),
    ];
    expect(modelTierHits, formatHits("router/index.ts ModelTier", modelTierHits)).toEqual([]);
  });

  test("packages/sdk/src contains NO quoted \"flash\" or \"expensive\" string literals", () => {
    const files = walk(SDK_SRC).filter((fp) => fp.endsWith(".ts") || fp.endsWith(".mjs"));
    const flashHits = [];
    const expensiveHits = [];
    // Match either single- or double-quoted forms. Spec excludes regex
    // literals and identifiers — only string-literal drift counts.
    const flashPattern = /(['"])flash\1/;
    const expensivePattern = /(['"])expensive\1/;
    for (const fp of files) {
      flashHits.push(...findLines(fp, flashPattern));
      expensiveHits.push(...findLines(fp, expensivePattern));
    }
    const all = [...flashHits, ...expensiveHits];
    expect(
      all,
      formatHits('"flash" or "expensive" literal', all),
    ).toEqual([]);
  });

  test("packages/sdk/src contains NO TypeScript identifier ModelTier", () => {
    const files = walk(SDK_SRC).filter((fp) =>
      fp.endsWith(".ts") || fp.endsWith(".tsx") || fp.endsWith(".mts"),
    );
    const hits = [];
    const idPattern = /\bModelTier\b/;
    for (const fp of files) {
      hits.push(...findLines(fp, idPattern));
    }
    expect(hits, formatHits("ModelTier identifier", hits)).toEqual([]);
  });
});
