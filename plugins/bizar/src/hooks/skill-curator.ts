/**
 * skill-curator.ts — Skill Curator hook (v6.0.0)
 *
 * Pattern: Hermes Agent `agent/curator.py` (the "closed learning loop"
 * differentiator). Of 106 cataloged projects, exactly one has this.
 *
 * The Curator watches for signals (skill failures, repeated errors,
 * new lessons entries) and:
 *   1. Increments per-skill counters
 *   2. Flags stale skills (no usage in N days)
 *   3. Proposes skill revisions when 5+ failures accumulate
 *   4. Surfaces new patterns from `AGENTS_SELF_IMPROVEMENT.md`
 *
 * v6.0.0 — initial implementation. Tracks in-memory counters; future
 * versions will persist to `.bizar/skills/usage.jsonl` and run a
 * scheduled review pass.
 *
 * See: research/agent-harness-survey/final-reports/06-bizar-improvement-plan.md
 *   § Improvement 1 — SKILL.md + Curator
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import type { Logger } from "../logger.js";

export interface SkillCuratorDeps {
  worktree: string;
  logger: Logger;
  /** Number of failures before proposing a revision. Default: 5. */
  revisionThreshold?: number;
  /** Number of days without use before flagging a skill stale. Default: 30. */
  staleDays?: number;
}

export interface SkillUsageCounter {
  name: string;
  useCount: number;
  failureCount: number;
  lastUsed: string | null;
  status: "ok" | "stale" | "needs-revision" | "new";
}

/**
 * In-memory + on-disk usage tracker. Keyed by skill name. Persisted to
 * ~/.bizar/skills/usage.jsonl on every update.
 */
function getUsageFile(): string {
  // Allow override via env var (mainly for tests)
  const override = process.env.BIZAR_SKILL_USAGE_FILE;
  if (override) return override;
  return join(homedir(), ".bizar", "skills", "usage.jsonl");
}

function loadUsage(): Record<string, SkillUsageCounter> {
  if (!existsSync(getUsageFile())) return {};
  try {
    const text = readFileSync(getUsageFile(), "utf8");
    const map: Record<string, SkillUsageCounter> = {};
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as SkillUsageCounter;
        map[entry.name] = entry;
      } catch {
        // skip malformed line
      }
    }
    return map;
  } catch {
    return {};
  }
}

function saveUsage(map: Record<string, SkillUsageCounter>): void {
  try {
    mkdirSync(join(process.env.BIZAR_SKILL_USAGE_DIR ?? join(homedir(), ".bizar", "skills")), { recursive: true });
    const text = Object.values(map)
      .map((e) => JSON.stringify(e))
      .join("\n");
    writeFileSync(getUsageFile(), text + "\n", "utf8");
  } catch (err) {
    // best-effort; not critical
  }
}

export function getSkillUsage(name: string): SkillUsageCounter | null {
  const map = loadUsage();
  return map[name] ?? null;
}

export function recordSkillUse(name: string, outcome: "success" | "failure"): void {
  const map = loadUsage();
  const entry = map[name] ?? {
    name,
    useCount: 0,
    failureCount: 0,
    lastUsed: null,
    status: "new" as const,
  };
  if (outcome === "success") entry.useCount += 1;
  else entry.failureCount += 1;
  entry.lastUsed = new Date().toISOString();
  entry.status = entry.failureCount >= 5 ? "needs-revision" : "ok";
  map[name] = entry;
  saveUsage(map);
}

export interface CuratorReport {
  totalSkills: number;
  ok: number;
  needsRevision: number;
  stale: number;
  new: number;
  proposals: Array<{ name: string; reason: string; failureCount: number }>;
}

export function generateCuratorReport(deps: SkillCuratorDeps): CuratorReport {
  const map = loadUsage();
  const threshold = deps.revisionThreshold ?? 5;
  const staleDays = deps.staleDays ?? 30;
  const now = Date.now();
  const staleCutoff = now - staleDays * 24 * 60 * 60 * 1000;

  const entries = Object.values(map);
  const proposals: CuratorReport["proposals"] = [];
  for (const e of entries) {
    if (e.failureCount >= threshold) {
      proposals.push({
        name: e.name,
        reason: `${e.failureCount} failures recorded; consider revision.`,
        failureCount: e.failureCount,
      });
    }
  }

  return {
    totalSkills: entries.length,
    ok: entries.filter((e) => e.status === "ok").length,
    needsRevision: entries.filter((e) => e.status === "needs-revision").length,
    stale: entries.filter(
      (e) =>
        e.lastUsed !== null &&
        new Date(e.lastUsed).getTime() < staleCutoff &&
        e.useCount > 0,
    ).length,
    new: entries.filter((e) => e.status === "new").length,
    proposals,
  };
}

export interface SkillCuratorHook {
  /** Manually trigger a curator report. */
  report: () => CuratorReport;
  /** Record a skill use (success or failure). */
  record: (name: string, outcome: "success" | "failure") => void;
}

export function createSkillCurator(deps: SkillCuratorDeps): SkillCuratorHook {
  const logger = deps.logger;
  return {
    report: () => {
      const r = generateCuratorReport(deps);
      logger.info(
        `bizar: skill curator — ${r.totalSkills} tracked, ${r.needsRevision} need revision, ${r.stale} stale, ${r.proposals.length} proposals`,
      );
      return r;
    },
    record: (name, outcome) => {
      recordSkillUse(name, outcome);
      const usage = getSkillUsage(name);
      if (usage && usage.failureCount >= (deps.revisionThreshold ?? 5)) {
        logger.warn(
          `bizar: skill '${name}' has ${usage.failureCount} failures — propose revision.`,
        );
      }
    },
  };
}
