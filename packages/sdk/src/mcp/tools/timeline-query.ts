/**
 * mcp/tools/timeline-query.ts
 *
 * F-042 — `timeline_query` MCP tool. Lets a Claude Code agent ask
 * "what just happened?" before it acts. Returns recent TimelineEvents
 * matching the caller's filters, plus a short prose summary the
 * model can read directly.
 *
 * Lookup order:
 *   1. HTTP loopback to the dashboard at
 *      `http://127.0.0.1:4321/api/timeline?...` (5s timeout).
 *   2. Fallback: read `~/.config/bizar/timeline.jsonl` directly and
 *      filter in-process. Same filter semantics.
 *
 * The fallback matters for headless / `claude --bg` sessions where the
 * dashboard isn't running but the JSONL ring already has the history
 * the agent needs.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const HOME = homedir();
const TIMELINE_DIR = join(HOME, ".config", "bizar");
const TIMELINE_FILE = join(TIMELINE_DIR, "timeline.jsonl");
const TIMELINE_ROTATIONS = [TIMELINE_FILE];
for (let i = 1; i <= 5; i++) TIMELINE_ROTATIONS.push(`${TIMELINE_FILE}.${i}`);

const DEFAULT_DASHBOARD_URL = process.env.BIZAR_DASHBOARD_URL || "http://127.0.0.1:4321";
const HTTP_TIMEOUT_MS = 5_000;

export type TimelineQueryArgs = {
  projectPath?: string;
  since?: string;
  until?: string;
  type?: string;
  file?: string;
  agentName?: string;
  taskId?: string;
  goalId?: string;
  sessionId?: string;
  commitSha?: string;
  text?: string;
  limit?: number;
};

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}
function err(text: string) {
  return { content: [{ type: "text" as const, text: `error: ${text}` }] };
}

function clampLimit(raw: unknown): number {
  let n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) n = 50;
  return Math.min(Math.max(Math.floor(n), 1), 500);
}

function defaultSince(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

function httpGetJson(url: string, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? httpsRequest : httpRequest;
    const req = lib(
      {
        method: "GET",
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        timeout: timeoutMs,
        headers: { Accept: "application/json" },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => { body += c; });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try { resolve(JSON.parse(body)); }
            catch (e) { reject(new Error(`bad JSON: ${String(e)}`)); }
          } else {
            reject(new Error(`http ${res.statusCode}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end();
  });
}

type TimelineEvent = Record<string, unknown> & {
  id: string;
  ts: string;
  type: string;
  subType?: string;
  summary?: string;
  detail?: string | null;
  refs?: Record<string, unknown>;
  actor?: { kind?: string; name?: string | null };
  source?: string;
};

function filterLocal(events: TimelineEvent[], args: TimelineQueryArgs): TimelineEvent[] {
  const since = args.since || defaultSince();
  const until = args.until || null;
  const types = args.type && args.type !== "all"
    ? String(args.type).split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  return events.filter((e) => {
    if ((e.ts || "") < since) return false;
    if (until && (e.ts || "") > until) return false;
    if (types && !types.includes(e.type)) return false;
    if (args.file) {
      const f = String(args.file);
      const refsFile = String(e.refs?.file || "");
      if (!refsFile.includes(f)) return false;
    }
    if (args.agentName) {
      const want = String(args.agentName);
      const got = String(e.refs?.agentName || e.actor?.name || "");
      if (got !== want) return false;
    }
    if (args.taskId && String(e.refs?.taskId || "") !== args.taskId) return false;
    if (args.goalId && String(e.refs?.goalId || "") !== args.goalId) return false;
    if (args.sessionId && String(e.refs?.sessionId || "") !== args.sessionId) return false;
    if (args.commitSha && String(e.refs?.commitSha || "") !== args.commitSha) return false;
    if (args.text) {
      const t = String(args.text).toLowerCase();
      const summary = String(e.summary || "").toLowerCase();
      const detail = String(e.detail || "").toLowerCase();
      if (!summary.includes(t) && !detail.includes(t)) return false;
    }
    return true;
  });
}

function readLocalTimeline(fileOverride?: string): TimelineEvent[] {
  const files = fileOverride
    ? [fileOverride, ...TIMELINE_ROTATIONS.slice(1).map((f) => f.replace(TIMELINE_FILE, fileOverride))]
    : TIMELINE_ROTATIONS;
  const out: TimelineEvent[] = [];
  for (const fp of files) {
    if (!existsSync(fp)) continue;
    let st: import("node:fs").Stats;
    try { st = statSync(fp); } catch { continue; }
    if (st.size === 0) continue;
    let text: string;
    try { text = readFileSync(fp, "utf8"); } catch { continue; }
    for (const raw of text.split("\n")) {
      if (!raw) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { continue; }
      if (parsed && typeof parsed === "object") out.push(parsed as TimelineEvent);
    }
  }
  out.sort((a, b) => (a.ts || "").localeCompare(b.ts || ""));
  return out;
}

function buildQueryString(args: TimelineQueryArgs, limit: number): string {
  const params = new URLSearchParams();
  if (args.since) params.set("since", args.since);
  if (args.until) params.set("until", args.until);
  if (args.type) params.set("type", args.type);
  if (args.file) params.set("file", args.file);
  if (args.agentName) params.set("agentName", args.agentName);
  if (args.taskId) params.set("taskId", args.taskId);
  if (args.goalId) params.set("goalId", args.goalId);
  if (args.sessionId) params.set("sessionId", args.sessionId);
  if (args.commitSha) params.set("commitSha", args.commitSha);
  if (args.text) params.set("text", args.text);
  params.set("limit", String(limit));
  return params.toString();
}

function buildSummary(events: TimelineEvent[], maxWords = 200): string {
  if (events.length === 0) return "No matching timeline events.";
  const lines: string[] = [];
  lines.push(`${events.length} events:`);
  const byType: Record<string, number> = {};
  for (const e of events) byType[e.type] = (byType[e.type] || 0) + 1;
  for (const [k, v] of Object.entries(byType).sort()) lines.push(`- ${k}: ${v}`);
  lines.push("");
  lines.push("Most recent:");
  for (const e of events.slice(-5)) {
    lines.push(`- [${e.ts}] (${e.type}/${e.subType || ""}) ${e.summary || ""}`);
  }
  return lines.join("\n").split(/\s+/).slice(0, maxWords).join(" ");
}

export async function handleTimelineQuery(
  args: TimelineQueryArgs,
  deps: {
    dashboardUrl?: string;
    httpGetJson?: (u: string, t: number) => Promise<unknown>;
    /** Override the file the fallback reads from (test seam). */
    timelineFile?: string;
  } = {},
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const limit = clampLimit(args.limit);
  const since = args.since || defaultSince();
  const urlBase = deps.dashboardUrl || DEFAULT_DASHBOARD_URL;
  const getJson = deps.httpGetJson || httpGetJson;
  const fallbackFile = deps.timelineFile || TIMELINE_FILE;

  // 1) Try the dashboard loopback.
  try {
    const qs = buildQueryString({ ...args, since }, limit);
    const data = await getJson(`${urlBase}/api/timeline?${qs}`, HTTP_TIMEOUT_MS);
    if (data && typeof data === "object" && Array.isArray((data as { events?: unknown[] }).events)) {
      const events = (data as { events: TimelineEvent[] }).events;
      const summary = buildSummary(events);
      const payload = {
        source: "dashboard",
        total: (data as { total?: number }).total ?? events.length,
        limit,
        since,
        events,
        summary,
      };
      return ok(JSON.stringify(payload, null, 2));
    }
  } catch {
    /* fall through to JSONL fallback */
  }

  // 2) Fallback: read the JSONL ring directly.
  try {
    const rotationSet = [fallbackFile, ...TIMELINE_ROTATIONS.slice(1).map((f) => f.replace(TIMELINE_FILE, fallbackFile))];
    if (!rotationSet.some((f) => existsSync(f))) {
      return ok(JSON.stringify({
        source: "local",
        total: 0,
        limit,
        since,
        events: [],
        summary: "No timeline.jsonl found. The dashboard must run at least once to seed the file.",
      }, null, 2));
    }
    const all = readLocalTimeline(fallbackFile);
    const filtered = filterLocal(all, { ...args, since })
      .sort((a, b) => (b.ts || "").localeCompare(a.ts || ""))
      .slice(0, limit);
    const summary = buildSummary(filtered);
    return ok(JSON.stringify({
      source: "local",
      total: filtered.length,
      limit,
      since,
      events: filtered,
      summary,
    }, null, 2));
  } catch (e) {
    return err(`timeline_query fallback failed: ${String(e)}`);
  }
}

export const __testHelpers = {
  buildQueryString,
  buildSummary,
  filterLocal,
  readLocalTimeline,
  TIMELINE_FILE,
  TIMELINE_ROTATIONS,
  clampLimit,
  defaultSince,
};
