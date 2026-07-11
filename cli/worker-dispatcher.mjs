#!/usr/bin/env node
/**
 * cli/worker-dispatcher.mjs
 *
 * Bizar Background Workers — trigger-pattern dispatcher.
 *
 * Reads `config/trigger-patterns.json` (cached for the lifetime of the
 * process) and matches user prompts against each worker's `regex` array.
 * Returns up to `opts.maxSuggestions` (default 3) weighted matches, sorted
 * by weight desc.
 *
 * The hook at `.claude/hooks/worker-suggest.mjs` calls `dispatch()` on
 * every `UserPromptSubmit` event. Pure JS, no external deps; safe to
 * import from either Node or Bun.
 *
 * Public API
 * ──────────
 *   dispatch(text, { maxSuggestions }?) -> Array<{
 *     workerId: string,
 *     weight: number,
 *     skill: string | null,
 *     agent: string | null,
 *     description: string | undefined,
 *     matchedPattern: string,        // the literal regex string that hit
 *     matchedIndex: number           // the prompt char-offset of the match
 *   }>
 *
 *   listWorkers() -> string[]        // all worker ids (even with no regex)
 *
 *   resetCache() -> void             // force re-read of the JSON on next dispatch
 *
 *   loadPatterns({ configPath? }?) -> object   // explicit loader for tests
 *
 * Honesty note: ruflo's equivalent worker bodies are stubs
 * (`await new Promise(r => setTimeout(r, …))`); this port is just a
 * dispatcher — actual work happens in Bizar skills/agents invoked
 * separately by the model.
 */
'use strict';

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config path resolution ──────────────────────────────────────────────────

/**
 * Locate `config/trigger-patterns.json`. Resolution order:
 *   1. opts.configPath (explicit, used by tests)
 *   2. BIZAR_TRIGGER_PATTERNS env var
 *   3. <projectRoot>/config/trigger-patterns.json   (projectRoot = parent of cli/)
 */
export function defaultConfigPath() {
  if (process.env.BIZAR_TRIGGER_PATTERNS) {
    return process.env.BIZAR_TRIGGER_PATTERNS;
  }
  const projectRoot = resolve(__dirname, '..');
  return join(projectRoot, 'config', 'trigger-patterns.json');
}

// ── Cached patterns + pre-compiled regexes ──────────────────────────────────

/** @type {Array<CompiledWorker> | null} */
let _cache = null;
/** @type {string | null} */
let _cachePath = null;

/**
 * @typedef CompiledWorker
 * @property {string} id
 * @property {number} weight
 * @property {string|null} skill
 * @property {string|null} agent
 * @property {string|undefined} description
 * @property {Array<{ pattern: string, regex: RegExp }>} compiled
 */

/**
 * Load + compile the patterns file. Cached on first call.
 * @param {{ configPath?: string }=} opts
 * @returns {Array<CompiledWorker>}
 */
export function loadPatterns(opts = {}) {
  const path = opts.configPath || defaultConfigPath();
  if (_cache && _cachePath === path) return _cache;

  if (!existsSync(path)) {
    // Empty dispatcher — no patterns means no suggestions, but the API
    // remains available (so a missing config never throws at the hook).
    _cache = [];
    _cachePath = path;
    return _cache;
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    // Invalid JSON is a config bug, not a runtime bug — log + fall back
    // to an empty dispatcher so the hook still exits 0.
    process.stderr.write(
      `[bizar.workers] WARN: failed to parse ${path}: ${
        err && err.message ? err.message : String(err)
      }\n`,
    );
    _cache = [];
    _cachePath = path;
    return _cache;
  }

  const workers = Array.isArray(raw && raw.workers) ? raw.workers : [];

  /** @type {Array<CompiledWorker>} */
  const compiled = [];
  for (const w of workers) {
    if (!w || typeof w.id !== 'string') continue;
    const regexSources = Array.isArray(w.regex) ? w.regex : [];
    /** @type {Array<{ pattern: string, regex: RegExp }>} */
    const compiled_ = [];
    for (const src of regexSources) {
      if (typeof src !== 'string' || src.length === 0) continue;
      try {
        compiled_.push({ pattern: src, regex: new RegExp(src, 'i') });
      } catch {
        // Skip invalid regex sources; never throw from the hook path.
      }
    }
    compiled.push({
      id: w.id,
      weight: typeof w.weight === 'number' ? w.weight : 0.5,
      skill: typeof w.skill === 'string' ? w.skill : null,
      agent: typeof w.agent === 'string' ? w.agent : null,
      description: typeof w.description === 'string' ? w.description : undefined,
      compiled: compiled_,
    });
  }

  _cache = compiled;
  _cachePath = path;
  return _cache;
}

/** Force re-read of the patterns JSON on the next `dispatch()` call. */
export function resetCache() {
  _cache = null;
  _cachePath = null;
}

// ── Public API ──────────────────────────────────────────────────────────────

const DEFAULT_MAX_SUGGESTIONS = 3;

/**
 * Match a prompt against all worker patterns and return ranked suggestions.
 *
 * @param {string} text
 * @param {{ maxSuggestions?: number, configPath?: string }=} opts
 * @returns {Array<{
 *   workerId: string,
 *   weight: number,
 *   skill: string|null,
 *   agent: string|null,
 *   description: string|undefined,
 *   matchedPattern: string,
 *   matchedIndex: number
 * }>}
 */
export function dispatch(text, opts = {}) {
  const out = [];
  const source = typeof text === 'string' ? text : '';
  if (source.length === 0) return out;

  const workers = loadPatterns(
    opts.configPath ? { configPath: opts.configPath } : {},
  );
  if (workers.length === 0) return out;

  const max = Number.isInteger(opts.maxSuggestions)
    ? Math.max(0, opts.maxSuggestions)
    : DEFAULT_MAX_SUGGESTIONS;

  for (const w of workers) {
    let bestIndex = -1;
    let bestPattern = null;
    for (const c of w.compiled) {
      const m = c.regex.exec(source);
      if (m && m.index >= 0) {
        if (bestIndex === -1 || m.index < bestIndex) {
          bestIndex = m.index;
          bestPattern = c.pattern;
        }
      }
    }
    if (bestPattern !== null) {
      out.push({
        workerId: w.id,
        weight: w.weight,
        skill: w.skill,
        agent: w.agent,
        description: w.description,
        matchedPattern: bestPattern,
        matchedIndex: bestIndex,
      });
    }
  }

  out.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    // Tie-break deterministically by workerId so the output is stable
    // across runs (useful for tests + logs).
    return a.workerId.localeCompare(b.workerId);
  });

  return max === 0 ? [] : out.slice(0, max);
}

/**
 * Return all worker ids declared in the patterns file. Workers with no
 * regex are returned too — they simply never surface as suggestions.
 *
 * @param {{ configPath?: string }=} opts
 * @returns {string[]}
 */
export function listWorkers(opts = {}) {
  const workers = loadPatterns(
    opts.configPath ? { configPath: opts.configPath } : {},
  );
  return workers.map((w) => w.id);
}

// Direct CLI entrypoint for dry-runs / debugging.
//   node cli/worker-dispatcher.mjs "your prompt here" [--max N] [--list]
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1]
) {
  const argv = process.argv.slice(2);
  const wantList = argv.includes('--list');
  const maxIdx = argv.indexOf('--max');
  const maxVal =
    maxIdx >= 0 && argv[maxIdx + 1] ? Number.parseInt(argv[maxIdx + 1], 10) : undefined;

  if (wantList) {
    const ids = listWorkers();
    process.stdout.write(JSON.stringify(ids, null, 2) + '\n');
    process.exit(0);
  }

  // Build the prompt by dropping only `--max` and the value that follows it
  // (and only when `--max` was actually present).
  const prompt = argv
    .filter((a, i) => !(maxIdx >= 0 && (i === maxIdx || i === maxIdx + 1)))
    .join(' ');
  const result = dispatch(prompt, { maxSuggestions: maxVal });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(0);
}
