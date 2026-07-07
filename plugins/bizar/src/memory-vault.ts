/**
 * memory-vault.ts
 *
 * v6.0.0 — In-process Bizar Memory vault reader/writer. The plugin can
 * read and write memory notes directly from disk, without going through
 * the dashboard's HTTP API.
 *
 * Vault location: $BIZAR_MEMORY_VAULT or ~/.bizar_memory/ (default).
 * Legacy: ~/.local/share/bizar/memory/ (still readable if it exists).
 *
 * Note format: Obsidian-compatible markdown with YAML frontmatter.
 *
 *   ---
 *   key: value
 *   ---
 *   # Body
 *
 * This is a focused subset of the dashboard's full MarkdownMemoryStore
 * (which includes git, schema validation, secrets scanning, semantic
 * search via lightrag). The plugin needs read/write/list/search; for
 * the heavier features, the dashboard is the source of truth.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { homedir } from "node:os";

const HOME = homedir();

export const DEFAULT_MEMORY_VAULT = join(HOME, ".bizar_memory");
export const LEGACY_MEMORY_VAULT = join(HOME, ".local", "share", "bizar", "memory");

export function resolveVaultRoot(): string {
  return process.env.BIZAR_MEMORY_VAULT || DEFAULT_MEMORY_VAULT;
}

export interface MemoryNote {
  relPath: string;
  frontmatter: Record<string, unknown>;
  body: string;
  raw: string;
  mtime: number;
  size: number;
}

/** Parse YAML frontmatter from a markdown note. Minimal parser — no nested
 *  structures, no multi-line values, no comments. Sufficient for the
 *  tags / type / title / createdAt metadata that the dashboard writes. */
export function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---")) return { frontmatter: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { frontmatter: {}, body: raw };
  const fmBlock = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\n/, "");
  const frontmatter: Record<string, unknown> = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1] as string;
    let value: string | string[] = m[2] as string;
    value = value.trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      // YAML flow sequence: [a, b, c]
      value = value.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean);
    } else if (value === "true") value = "true";
    else if (value === "false") value = "false";
    frontmatter[key] = value;
  }
  return { frontmatter, body };
}

/** Serialize frontmatter back to markdown. */
export function serializeFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  const lines = ["---"];
  for (const [k, v] of Object.entries(frontmatter)) {
    if (Array.isArray(v)) lines.push(`${k}: [${v.join(", ")}]`);
    else lines.push(`${k}: ${String(v)}`);
  }
  lines.push("---", "", body.startsWith("\n") ? body : body);
  return lines.join("\n");
}

/** Read a single note. Returns null if not found. */
export function readNote(vaultRoot: string, relPath: string): MemoryNote | null {
  // Path safety: reject .. and absolute
  const safe = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (safe.includes("..") || safe.startsWith(".")) return null;
  const fp = join(vaultRoot, safe);
  if (!existsSync(fp)) return null;
  const raw = readFileSync(fp, "utf-8");
  const st = statSync(fp);
  const { frontmatter, body } = parseFrontmatter(raw);
  return { relPath: safe, frontmatter, body, raw, mtime: st.mtimeMs, size: st.size };
}

/** Write a note. Creates the parent directory if needed. */
export function writeNote(
  vaultRoot: string,
  relPath: string,
  frontmatter: Record<string, unknown>,
  body: string,
): MemoryNote {
  const safe = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (safe.includes("..") || safe.startsWith(".")) {
    throw new Error(`invalid_path: ${relPath}`);
  }
  const fp = join(vaultRoot, safe);
  mkdirSync(join(fp, ".."), { recursive: true });
  const raw = serializeFrontmatter(frontmatter, body);
  writeFileSync(fp, raw, "utf-8");
  const st = statSync(fp);
  return { relPath: safe, frontmatter, body, raw, mtime: st.mtimeMs, size: st.size };
}

/** List notes matching a prefix. */
export function listNotes(vaultRoot: string, prefix: string = "", limit: number = 100): MemoryNote[] {
  if (!existsSync(vaultRoot)) return [];
  const out: MemoryNote[] = [];
  walk(vaultRoot, vaultRoot, out, limit, prefix);
  return out;
}

function walk(root: string, dir: string, out: MemoryNote[], limit: number, prefix: string): void {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (out.length >= limit) return;
    const fp = join(dir, name);
    let st;
    try { st = statSync(fp); } catch { continue; }
    if (st.isDirectory()) {
      if (name === ".obsidian" || name === ".git") continue;
      walk(root, fp, out, limit, prefix);
    } else if (name.endsWith(".md")) {
      const rel = relative(root, fp).split(sep).join("/");
      if (prefix && !rel.startsWith(prefix)) continue;
      const note = readNote(root, rel);
      if (note) out.push(note);
    }
  }
}

/** Full-text search over note bodies + frontmatter. */
export function searchNotes(vaultRoot: string, query: string, limit: number = 20): MemoryNote[] {
  const q = query.toLowerCase();
  const notes = listNotes(vaultRoot, "", 1000);
  const out: { note: MemoryNote; score: number }[] = [];
  for (const note of notes) {
    const haystack = (note.body + "\n" + Object.values(note.frontmatter).join(" ")).toLowerCase();
    const score = countOccurrences(haystack, q);
    if (score > 0) out.push({ note, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit).map((o) => o.note);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) >= 0) { count += 1; idx += needle.length; }
  return count;
}
