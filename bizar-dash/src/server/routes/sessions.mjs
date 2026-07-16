/**
 * src/server/routes/sessions.mjs
 *
 * Pillar A — Session heartbeat list + stop.
 *
 * GET  /api/sessions        — list live sessions from .harness/traces/heartbeat.jsonl
 * POST /api/sessions/:id/stop — mark a session as done
 */

import { Router } from "express";
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { wrap } from "./_shared.mjs";

const HEARTBEAT_FILE = ".harness/traces/heartbeat.jsonl";

function resolveHeartbeatPath(repoRoot) {
  return join(repoRoot ?? process.cwd(), HEARTBEAT_FILE);
}

/**
 * @param {string} repoRoot
 * @returns {Array<{session_id: string, started_at: string, last_heartbeat_at: string, status: string}>}
 */
function readSessions(repoRoot) {
  const fp = resolveHeartbeatPath(repoRoot);
  if (!existsSync(fp)) return [];
  try {
    const raw = readFileSync(fp, "utf-8");
    const lines = raw.split("\n").filter(Boolean);
    // Deduplicate by session_id, keeping the last record per session
    const map = new Map();
    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        if (rec?.session_id) map.set(rec.session_id, rec);
      } catch {
        // skip malformed lines
      }
    }
    return Array.from(map.values());
  } catch {
    return [];
  }
}

export function createSessionsRouter({ projectRoot = process.cwd() } = {}) {
  const router = Router();

  // GET /api/sessions
  router.get("/sessions", wrap(async (_req, res) => {
    const sessions = readSessions(projectRoot);
    res.json({ sessions });
  }));

  // POST /api/sessions/:id/stop
  router.post("/sessions/:id/stop", wrap(async (req, res) => {
    const id = String(req.params?.id ?? "").trim();
    if (!id) {
      res.status(400).json({ error: "bad_request", message: "session id is required" });
      return;
    }
    const fp = resolveHeartbeatPath(projectRoot);
    // Ensure parent dir exists
    const dir = join(fp, "..");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const record = {
      session_id: id,
      started_at: new Date().toISOString(),
      last_heartbeat_at: new Date().toISOString(),
      status: "done",
    };
    appendFileSync(fp, JSON.stringify(record) + "\n", "utf-8");
    res.json({ session_id: id, status: "done" });
  }));

  return router;
}
