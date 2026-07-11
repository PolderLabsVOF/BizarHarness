/**
 * router/memory-distillation.ts — RETRIEVE → JUDGE → DISTILL →
 * CONSOLIDATE (ADR-174) as a pure TypeScript module.
 *
 * v6.4.0 — ported from ruflo `@claude-flow/neural/src/reasoning-bank.ts`
 * (the 4-step pipeline) + ADR-174 (provenance-tiered promote gate).
 *
 * This is the $0 default path — deterministic, no LLM, no I/O.
 * Living inside the SDK (rather than the dashboard .mjs files) so
 * the `memory_distill` MCP tool can call it via a static TypeScript
 * import without crossing the ESM/CJS boundary at runtime.
 *
 * The dashboard's `bizar-dash/src/server/memory-{distillation,
 * consolidator}.mjs` re-export the same semantics and add the
 * vault I/O (read notes, write promoted patterns back). Both paths
 * agree on the `Pattern` shape so the schema is one-of.
 */

export const PROVENANCE_TIERS = [
  "oracle:test-exec",
  "proxy:structural",
  "judge:fable",
] as const;

export type ProvenanceTier = (typeof PROVENANCE_TIERS)[number];

export interface MemoryEntryLike {
  memory_id?: string;
  id?: string;
  path?: string;
  relPath?: string;
  frontmatter?: Record<string, unknown>;
  body?: string;
  kind?: string;
  type?: string;
  created?: string;
  createdAt?: string;
  tags?: unknown;
}

export interface Retrieval {
  complexity: "simple" | "moderate" | "complex";
  testExec: boolean;
  hasCodeBlock: boolean;
  length: number;
}

export interface Pattern {
  id: string;
  kind: "pattern";
  summary: string;
  uses: string[];
  evidence: string[];
  provenance_tier: ProvenanceTier;
  promoted: boolean;
  score: number;
}

export interface DistillationResult {
  patterns: Pattern[];
  promoted: Pattern[];
  byTier: Record<ProvenanceTier, number>;
}

const COMPLEXITY_SIMPLE_MAX = 600;
const COMPLEXITY_MODERATE_MAX = 2400;

function firstLine(s: string): string {
  if (!s) return "";
  const i = s.indexOf("\n");
  return (i < 0 ? s : s.slice(0, i)).trim();
}

function snippet(body: string): string {
  const cleaned = body.replace(/\s+/g, " ").trim();
  return cleaned.length <= 200 ? cleaned : cleaned.slice(0, 200) + "…";
}

function shorten(s: string): string {
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36).slice(0, 10);
}

function wordSet(s: string): Set<string> {
  const out = new Set<string>();
  const norm = (s || "").toLowerCase().replace(/[^a-z0-9\s]+/g, " ");
  for (const w of norm.split(/\s+/)) {
    if (w.length > 2) out.add(w);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function dedupe<T>(arr: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const x of arr) if (!seen.has(x)) { seen.add(x); out.push(x); }
  return out;
}

export function retrieve(entry: MemoryEntryLike): Retrieval {
  const body = String(entry?.body ?? "");
  const fm = entry?.frontmatter ?? {};
  const hasCodeBlock = /```/.test(body);
  const tagsArr = Array.isArray(fm.tags) ? fm.tags : [];
  const testExec =
    Boolean(fm.test_exec) ||
    Boolean(fm.testExec) ||
    tagsArr.some((t) => String(t).includes("test-exec")) ||
    String(fm.kind ?? "") === "feedback";
  const len = body.length;
  let complexity: Retrieval["complexity"];
  if (hasCodeBlock || len > COMPLEXITY_MODERATE_MAX) complexity = "complex";
  else if (len > COMPLEXITY_SIMPLE_MAX) complexity = "moderate";
  else complexity = "simple";
  return { complexity, testExec, hasCodeBlock, length: len };
}

export function judge(_entry: MemoryEntryLike, retrieval: Retrieval): ProvenanceTier {
  if (retrieval.testExec) return "oracle:test-exec";
  return "proxy:structural";
}

export function distill(entry: MemoryEntryLike): Omit<Pattern, "provenance_tier" | "promoted" | "score"> | null {
  const fm = entry?.frontmatter ?? {};
  const body = String(entry?.body ?? "").trim();
  const id = String(entry?.memory_id ?? entry?.id ?? entry?.path ?? entry?.relPath ?? "");
  const kindRaw = String(fm.kind ?? entry?.kind ?? entry?.type ?? "").toLowerCase();

  if (kindRaw === "coding_convention" || kindRaw === "bug_pattern") {
    return {
      id: `pat_${shorten(id || body.slice(0, 24))}`,
      kind: "pattern",
      summary: firstLine(body) || "(empty)",
      uses: id ? [id] : [],
      evidence: [snippet(body)],
    };
  }

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
 * Distillation candidates carry their tier separately; we shift it on
 * to `provenance_tier` here and set the `promoted` flag.
 */
interface Candidate {
  id: string;
  kind: "pattern";
  summary: string;
  uses: string[];
  evidence: string[];
  _tier: ProvenanceTier;
}

export function runDistillation(entries: MemoryEntryLike[]): DistillationResult {
  const empty = {
    patterns: [] as Pattern[],
    promoted: [] as Pattern[],
    byTier: { "oracle:test-exec": 0, "proxy:structural": 0, "judge:fable": 0 } as Record<ProvenanceTier, number>,
  };
  if (!Array.isArray(entries) || entries.length === 0) return empty;

  const candidates: Candidate[] = [];
  for (const entry of entries) {
    const retrieval = retrieve(entry);
    const tier = judge(entry, retrieval);
    const pattern = distill(entry);
    if (!pattern) continue;
    candidates.push({ ...pattern, _tier: tier });
  }

  // Cluster by Jaccard similarity ≥ 0.5 over (summary + evidence).
  const groups: { rep: Candidate; members: Candidate[] }[] = [];
  for (const c of candidates) {
    const ws = wordSet(c.summary + " " + c.evidence.join(" "));
    let placed = false;
    for (const g of groups) {
      const gs = wordSet(g.rep.summary + " " + g.rep.evidence.join(" "));
      if (jaccard(ws, gs) >= 0.5) {
        g.members.push(c);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push({ rep: c, members: [c] });
  }

  const byTier: Record<ProvenanceTier, number> = {
    "oracle:test-exec": 0,
    "proxy:structural": 0,
    "judge:fable": 0,
  };
  const patterns: Pattern[] = [];
  for (const g of groups) {
    const usesSet = new Set<string>();
    const evidence: string[] = [];
    for (const m of g.members) {
      for (const u of m.uses ?? []) usesSet.add(u);
      for (const e of m.evidence ?? []) evidence.push(e);
    }
    const tiers = g.members.map((m) => m._tier);
    let tier: ProvenanceTier = "proxy:structural";
    if (tiers.includes("oracle:test-exec")) tier = "oracle:test-exec";
    else if (tiers.includes("judge:fable")) tier = "judge:fable";

    const promoted = usesSet.size >= 1 && (tier === "oracle:test-exec" || tier === "judge:fable");
    const pattern: Pattern = {
      id: g.rep.id,
      kind: "pattern",
      summary: g.rep.summary,
      uses: Array.from(usesSet),
      evidence: dedupe(evidence).slice(0, 5),
      provenance_tier: tier,
      promoted,
      score: 0.5 + usesSet.size * 0.1,
    };
    patterns.push(pattern);
    byTier[tier] += 1;
  }

  const promoted = patterns.filter((p) => p.promoted);
  return { patterns, promoted, byTier };
}
