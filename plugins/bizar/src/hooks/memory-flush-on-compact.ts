/**
 * memory-flush-on-compact.ts — Pre-compaction memory flush hook (v6.0.0)
 *
 * Pattern: OpenClaw `flush-plan.ts:27-34` (close the durability gap
 * where compaction drops context before it's persisted to memory).
 *
 * The hook fires when `shouldCompact()` returns true. It writes any
 * pending context to the memory vault BEFORE the conversation is
 * summarized by the host.
 *
 * Trigger: `onEvent('session.usage.update', ...)` when usage ratio
 * crosses the compaction threshold. The hook is non-blocking —
 * it queues a write but doesn't await the host's summarizer.
 *
 * v6.0.0 — initial implementation. The flush writes a "pre-compact
 * snapshot" note to the vault with the recent message digest. After
 * the host's summarizer runs, the memory-write-on-end hook can
 * reference this snapshot for context continuity.
 *
 * See: research/agent-harness-survey/round-9-memory/bizar-memory-redesign.md
 *   § C.1 — Tier 1 Working Memory: pre-compaction flush
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { writeFileSync, mkdirSync } from "node:fs";

import type { Logger } from "../logger.js";
import { shouldCompact } from "../compaction.mjs";

export interface MemoryFlushOnCompactDeps {
  worktree: string;
  logger: Logger;
  enabled: boolean;
  /** Override vault root for the snapshot. Default: ~/.bizar_memory. */
  vaultRoot?: string;
}

export interface FlushOnCompactEvent {
  sessionId: string;
  usage: { total: number; input?: number; output?: number; cached?: number };
  maxContext: number;
  /** Last N messages, for the snapshot. */
  recentMessages?: Array<{ role: string; content: string }>;
}

const SNAPSHOTS_DIR = "compaction-snapshots";

function resolveVaultRoot(custom?: string): string {
  if (custom) return custom;
  const fromEnv = process.env.BIZAR_MEMORY_VAULT;
  if (fromEnv) return fromEnv;
  return join(homedir(), ".bizar_memory");
}

function timestampSlug(d = new Date()): string {
  return d.toISOString().replace(/[:.]/g, "-");
}

export interface MemoryFlushOnCompactHook {
  /** Check + flush if over threshold. Returns true if a snapshot was written. */
  maybeFlush: (event: FlushOnCompactEvent) => Promise<boolean>;
}

export function createMemoryFlushOnCompact(
  deps: MemoryFlushOnCompactDeps,
): MemoryFlushOnCompactHook {
  const logger = deps.logger;
  const vaultRoot = resolveVaultRoot(deps.vaultRoot);
  return {
    maybeFlush: async (event) => {
      if (!deps.enabled) return false;
      if (!shouldCompact(event.usage, event.maxContext)) return false;
      const ratio = event.maxContext > 0 ? event.usage.total / event.maxContext : 0;
      const ts = timestampSlug();
      const slug = `${ts}-${event.sessionId.slice(0, 8)}`;
      const dir = join(vaultRoot, "projects", "BizarHarness", SNAPSHOTS_DIR);
      const path = join(dir, `${slug}.md`);
      try {
        mkdirSync(dir, { recursive: true });
        const lines: string[] = [];
        lines.push("---");
        lines.push("kind: pre-compact-snapshot");
        lines.push(`session_id: ${event.sessionId}`);
        lines.push(`timestamp: ${ts}`);
        lines.push(`usage_total: ${event.usage.total}`);
        lines.push(`max_context: ${event.maxContext}`);
        lines.push(`usage_ratio: ${ratio.toFixed(3)}`);
        lines.push("tags: [snapshot, compaction]");
        lines.push("---");
        lines.push("");
        lines.push(`# Pre-compaction snapshot — ${ts}`);
        lines.push("");
        lines.push(`Session \`${event.sessionId}\` crossed the compaction threshold ` +
          `(${ratio.toFixed(1)}% of ${event.maxContext} tokens). This note captures the ` +
          `recent context so it can be retrieved after summarization.`);
        lines.push("");
        if (event.recentMessages && event.recentMessages.length > 0) {
          lines.push("## Recent messages");
          lines.push("");
          for (const m of event.recentMessages) {
            const content = m.content.length > 500
              ? m.content.slice(0, 500) + "…"
              : m.content;
            lines.push(`### ${m.role}`);
            lines.push("");
            lines.push(content);
            lines.push("");
          }
        }
        writeFileSync(path, lines.join("\n"), "utf8");
        logger.info(
          `bizar: pre-compact snapshot written to ${path} (ratio=${ratio.toFixed(2)})`,
        );
        return true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`bizar: pre-compact snapshot failed: ${msg}`);
        return false;
      }
    },
  };
}
