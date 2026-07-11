/**
 * memory-distillation.mjs — RETRIEVE → JUDGE → DISTILL → CONSOLIDATE
 * (ADR-174) applied to an in-memory array of Bizar memory entries.
 *
 * v6.4.0 — ported from ruflo `@claude-flow/neural/src/reasoning-bank.ts`
 * (the 4-step pipeline) + ADR-174 (provenance-tiered promote gate).
 *
 * This is the deterministic, $0 default path. It does NOT call any
 * LLM. Provenance is inferred from the entry's frontmatter: entries
 * flagged with `kind: feedback` or executing a test result become
 * `oracle:test-exec`; everything else becomes `proxy:structural`.
 * (`judge:fable` is reserved for the cost-bounded LLM-judge path
 * enabled by `BIZAR_DISTILL_BUDGET_USD > 0` — out of scope here.)
 *
 * Returned `Pattern` objects carry a `provenance_tier` and a
 * `promoted` flag. Only `oracle:test-exec` (and `judge:fable`)
 * patterns can be promoted; `proxy:structural` patterns stay
 * searchable but never earn the `promoted` boolean.
 *
 * Pure function — no I/O. Idempotent: same input → same output.
 */

/** Allowed provenance_tier values per ADR-174. */
export const PROVENANCE_TIERS = /** @type {const} */ ([
  "oracle:test-exec",
  "proxy:structural",
  "judge:fable",
]);

/** Default complexity bucket thresholds (length-based, retrofitted with
 *  a code-block bonus). Matches ADR-174 §"RETRIEVE" cost = $0 default. */
const COMPLEXITY_BOUNDS = {
  /** longest body length considered "simple". */
  simpleMax: 600,
  /** longest body length considered "moderate". */
  moderateMax: 2400,
};

/**
 * @typedef {Object} MemoryEntry
 * @property {string} [memory_id]
 * @property {string} [id]
 * @property {string} [path]
 * @property {string} [relPath]
 * @property {Record<string, unknown>} [frontmatter]
 * @property {string} [body]
 * @property {string} [kind]            — One of: coding_convention | bug_pattern | task_summary | session_summary | feedback | …
 * @property {string} [type]
 * @property {string} [created]
 * @property {string} [createdAt]
 * @property {string} [updatedAt]
 * @property {string[]} [tags]
 */

/**
 * @typedef {Object} Pattern
 * @property {string} id            — "pat_<hash>"
 * @property {string} kind          — "pattern"
 * @property {string} summary       — short headline
 * @property {string[]} uses        — entry ids that contributed
 * @property {string[]} evidence    — excerpt lines cited as evidence
 * @property {"oracle:test-exec"|"proxy:structural"|"judge:fable"} provenance_tier
 * @property {boolean} promoted     — promote gate
 * @property {number} score         — heuristic quality
 */

/**
 * RETRIEVE → tag each entry with a complexity bucket.
 * Simple: short body, no code block, no test_exec tag.
 * Complex: long body OR has a code block.
 * @param {MemoryEntry} entry
 */
export function retrieve(entry) {
  const body = String(entry?.body ?? "");
  const fm = entry?.frontmatter ?? {};
  const hasCodeBlock = /```/.test(body);
  const testExec =
    Boolean(fm.test_exec) ||
    Boolean(fm.testExec) ||
    (Array.isArray(fm.tags) && fm.tags.some((t) => String(t).includes("test-exec"))) ||
    (typeof fm.kind === "string" && fm.kind === "feedback");
  const len = body.length;
  let complexity;
  if (hasCodeBlock || len > COMPLEXITY_BOUNDS.moderateMax) complexity = "complex";
  else if (len > COMPLEXITY_BOUNDS.simpleMax) complexity = "moderate";
  else complexity = "simple";
  return { complexity, testExec, hasCodeBlock, length: len };
}

/**
 * JUDGE → assign provenance_tier based on complexity + tags.
 * Oracle tier requires `testExec === true` (execution-observed).
 * @param {MemoryEntry} entry
 * @param {{ complexity: string, testExec: boolean, hasCodeBlock: boolean, length: number }} retrieval
 */
export function judge(entry, retrieval) {
  if (retrieval.testExec) return "oracle:test-exec";
  // `judge:fable` reserved for the cost-bounded LLM path — not set
  // here. Empty / null bodies (e.g. test stubs) get the proxy
  // structural tier; that's correct — no execution observation, no
  // Fable budget spend, so proxy is honest.
  void entry;
  return "proxy:structural";
}

/**
 * DISTILL → produce a Pattern candidate from a memory entry, if the
 * entry is the kind we surface as a "pattern". Coding conventions and
 * bug patterns are surfaced directly (one each); task/session
 * summaries produce a meta-pattern only if their bodies contain
 * structural keys (`use`, `avoid`, `pattern:`).
 * @param {MemoryEntry} entry
 */
export function distill(entry) {
  const fm = entry?.frontmatter ?? {};
  const body = String(entry?.body ?? "").trim();
  const id = String(entry?.memory_id ?? entry?.id ?? entry?.path ?? entry?.relPath ?? "");

  // Surface coding convention / bug pattern entries as 1:1 patterns.
  const kindRaw = (fm.kind ?? entry?.kind ?? entry?.type ?? "").toString().toLowerCase();
  if (kindRaw === "coding_convention" || kindRaw === "bug_pattern") {
    return {
      id: `pat_${shorten(id || body.slice(0, 24))}`,
      kind: "pattern",
      summary: firstLine(body) || "(empty)",
      uses: id ? [id] : [],
      evidence: [snippet(body)],
    };
  }

  // task_summary / session_summary → look for an embedded pattern
  // tag in the body ("use", "avoid", "pattern:").
  const head = firstLine(body).toLowerCase();
  if (
    kindRaw === "task_summary" ||
    kindRaw === "session_summary" ||
    /\bpattern\s*:/.test(head) ||
    /^\s*(use|avoid|do|don't)\s*:/.test(head)
  ) {
    return {
      id: `pat_${shorten(id || head.replace(/\W+/g, " ").slice(0, 24))}`,
      kind: "pattern",
      summary: firstLine(body) || "(empty)",
      uses: id ? [id] : [],
      evidence: [snippet(body)],
    };
  }

  return null;
}

/**
 * CONSOLIDATE — given candidate `Pattern` objects, dedupe by
 * substring overlap, count `uses`, set `provenance_tier` (max tier
 * across the cluster) and `promoted` (only if any contributing entry
 * is oracle or judge).
 * @param {Array<Pattern & { _tier: string }>} candidates
 * @returns {{ patterns: Pattern[], promoted: Pattern[], byTier: Record<string, number> }}
 */
export function consolidate(candidates) {
  // Group near-duplicates by Jaccard-like word-set similarity.
  const groups = [];
  for (const c of candidates) {
    const ws = wordSet(c.summary + " " + c.evidence.join(" "));
    let placed = false;
    for (const g of groups) {
      const gs = wordSet(g.rep.summary + " " + g.rep.evidence.join(" "));
      const sim = jaccard(ws, gs);
      if (sim >= 0.5) {
        g.members.push(c);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push({ rep: c, members: [c] });
  }

  const patterns = [];
  const byTier = { "oracle:test-exec": 0, "proxy:structural": 0, "judge:fable": 0 };
  for (const g of groups) {
    const allUses = new Set();
    const evidence = [];
    for (const m of g.members) {
      for (const u of m.uses ?? []) allUses.add(u);
      for (const e of m.evidence ?? []) evidence.push(e);
    }
    // Promote-tier max: oracle > judge > proxy.
    const tiers = g.members.map((m) => m._tier);
    let tier = "proxy:structural";
    if (tiers.includes("oracle:test-exec")) tier = "oracle:test-exec";
    else if (tiers.includes("judge:fable")) tier = "judge:fable";

    const promoted = usesAllows(allUses.size) && (tier === "oracle:test-exec" || tier === "judge:fable");
    const score = 0.5 + (allUses.size * 0.1);
    const pattern = {
      id: g.rep.id,
      kind: "pattern",
      summary: g.rep.summary,
      uses: Array.from(allUses),
      evidence: dedupe(evidence).slice(0, 5),
      provenance_tier: tier,
      promoted,
      score,
    };
    patterns.push(pattern);
    byTier[tier] += 1;
  }

  const promoted = patterns.filter((p) => p.promoted);
  return { patterns, promoted, byTier };
}

/**
 * Public entry point. Takes an array of memory entries, applies the
 * 4 stages and returns the consolidated pattern set + tier counts.
 * @param {MemoryEntry[]} entries
 */
export function runDistillation(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      patterns: [],
      promoted: [],
      byTier: { "oracle:test-exec": 0, "proxy:structural": 0, "judge:fable": 0 },
    };
  }

  const candidates = [];
  for (const entry of entries) {
    const retrieval = retrieve(entry);
    const tier = judge(entry, retrieval);
    const pattern = distill(entry);
    if (!pattern) continue;
    candidates.push({ ...pattern, _tier: tier });
  }

  return consolidate(candidates);
}

// -----------------------------------------------------------------
// Tiny helpers (private).
// -----------------------------------------------------------------

function firstLine(s) {
  if (!s) return "";
  const i = s.indexOf("\n");
  return (i < 0 ? s : s.slice(0, i)).trim();
}

function snippet(body) {
  const cleaned = body.replace(/\s+/g, " ").trim();
  return cleaned.length <= 200 ? cleaned : cleaned.slice(0, 200) + "…";
}

function shorten(s) {
  // Stable, short id-hash from arbitrary text.
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36).slice(0, 10);
}

function wordSet(s) {
  return new Set(
    String(s)
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function usesAllows(n) {
  // ADR-174 promote gate default: requires N≥1 contributing entry.
  // We tighten to N≥3 in consolidate-callers if they want the
  // 'agenticow substrate' default (ADR-170). Here we keep the
  // public function permissive; callers can filter.
  return n >= 1;
}

function dedupe(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    if (!seen.has(x)) { seen.add(x); out.push(x); }
  }
  return out;
}
