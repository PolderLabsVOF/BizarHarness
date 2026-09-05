#!/usr/bin/env bash
# Persist a bounded checkpoint before compaction. Claude Code supplies event JSON
# on stdin; keep this hook deterministic and avoid copying the full transcript.
set -euo pipefail
CHECKPOINT_DIR=${BIZAR_COMPACTION_DIR:-"${BIZAR_HOME:-${HOME:-.}/.config/bizar}/compaction"}
mkdir -p "$CHECKPOINT_DIR"
CHECKPOINT_DIR="$CHECKPOINT_DIR" node --input-type=module -e '
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
let input = {}; try { input = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch {}
const text = (v, fallback = "") => typeof v === "string" ? v : fallback;
const session = text(input.session_id, "unknown-session").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
const clip = (v, max) => text(v).slice(0, max);
const cwd = clip(input.cwd, 2048) || process.cwd();
const bounded = (path, max) => { try { return existsSync(path) ? readFileSync(path, "utf8").slice(-max) : ""; } catch { return ""; } };
const customInstructions = text(input.custom_instructions);
const payload = { schema: "bizar.compaction-checkpoint.v1", createdAt: new Date().toISOString(), sessionId: clip(input.session_id, 120) || null, trigger: clip(input.trigger, 80) || "unknown", customInstructionsHash: customInstructions ? createHash("sha256").update(customInstructions).digest("hex") : null, customInstructionsBytes: Buffer.byteLength(customInstructions), cwd, transcriptPath: clip(input.transcript_path, 2048) || null, decisions: bounded(join(cwd, "DECISIONS.md"), 16000), openKanIndex: bounded(join(cwd, ".ok", "index.json"), 24000) };
payload.contentHash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
const path = join(process.env.CHECKPOINT_DIR, `${session}.json`); const tmp = `${path}.tmp-${process.pid}`;
writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 }); renameSync(tmp, path);
process.stdout.write(JSON.stringify({ path, hash: payload.contentHash, trigger: payload.trigger, sessionId: payload.sessionId }));
' | node --input-type=module -e '
import { readFileSync } from "node:fs";
let raw = ""; try { raw = readFileSync(0, "utf8"); } catch {}
let c = {}; try { c = JSON.parse(raw || "{}"); } catch {}
process.stdout.write(`<priority-preservation-instructions>\nPreserve unanswered questions; confirmed causes and ruled-out hypotheses; exact errors, IDs, paths, commits, decisions, approvals, validation results, and remaining work. Drop filler and duplicated tool output. Durable checkpoint: ${c.path || "unavailable"} (sha256=${c.hash || "unavailable"}). After compaction, read it plus .ok/index.json, the selected .ok task/plan/PRD, and DECISIONS.md before acting.\n</priority-preservation-instructions>`);
'
