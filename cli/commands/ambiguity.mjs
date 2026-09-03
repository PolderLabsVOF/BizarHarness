#!/usr/bin/env node
/**
 * cli/commands/ambiguity.mjs
 *
 * `bizar ambiguity` — Phase 3 OMX adoption operator surface
 * (docs/plans/2026-09-03-omx-features.md §1).
 *
 * Thin wrapper over the SDK ambiguity module
 * (`packages/sdk/src/ambiguity/score.ts`) that loads a deep-interview
 * spec artifact from `docs/specs/deep-interview-<slug>.md`, extracts
 * the embedded `## Ambiguity breakdown` section, re-computes the score
 * via `computeAmbiguity`, and prints the result.
 *
 * CLI shape (matches the spec-list / bench thin-wrapper pattern):
 *
 *   bizar ambiguity                              default: most recent
 *                                                 docs/specs/deep-interview-*.md
 *   bizar ambiguity <path>                      load a specific spec file
 *   bizar ambiguity --format json               machine-readable output
 *   bizar ambiguity --breakdown                 show per-dimension contributions
 *   bizar ambiguity --allow-high                permit score > 0.10 (operator override)
 *   bizar ambiguity --kind greenfield|brownfield override the inferred kind
 *   bizar ambiguity --help                      usage banner
 *
 * Exit codes:
 *   0 — score ≤ 0.10 (closure threshold per deep-interview skill)
 *   1 — score > 0.10 AND --allow-high not set
 *   2 — usage / input error (bad path, missing breakdown, etc.)
 *
 * DEC-022 compliance: the command is **read-only** with respect to
 * `docs/specs/`. The deep-interview skill owns writes to that
 * directory; this command only reads and reports.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';

import {
  AMBIGUITY_SCHEMA_VERSION,
  AMBIGUITY_WEIGHTS,
  computeAmbiguity,
} from '../../packages/sdk/dist/ambiguity/index.js';

const REPO_ROOT = process.cwd();
const CLOSURE_THRESHOLD = 0.10;
const DEFAULT_SPECS_DIR = 'docs/specs';

/**
 * Default depth profile. The plan calls out `greenfield` (six
 * dimensions) and `brownfield` (five). When the spec does not
 * declare its kind, default to `greenfield` so callers see the
 * strictest dimension set first; operators can override with `--kind`.
 */
const DEFAULT_KIND = 'greenfield';

/**
 * Find the most-recently-modified `deep-interview-*.md` file under
 * `docs/specs/`. Returns an absolute path or `null` when the
 * directory is missing / empty.
 *
 * "Most recent" is defined by mtime — the spec-list / deep-interview
 * skill uses atomic temp-file rename, so mtime order matches
 * closure-order in practice.
 */
export function findMostRecentSpec({ cwd = REPO_ROOT, specsDir = DEFAULT_SPECS_DIR } = {}) {
  const absDir = isAbsolute(specsDir) ? specsDir : join(cwd, specsDir);
  if (!existsSync(absDir)) return null;
  const entries = readdirSync(absDir)
    .filter((name) => name.startsWith('deep-interview-') && name.endsWith('.md'))
    .map((name) => {
      const abs = join(absDir, name);
      return { name, abs, mtime: statSync(abs).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  return entries.length > 0 ? entries[0].abs : null;
}

/**
 * Resolve the spec path from CLI arguments. Accepts an explicit
 * positional path; otherwise falls back to the most recent
 * `docs/specs/deep-interview-*.md`. Throws a `TypeError` with a
 * clear message when no spec can be located.
 */
export function resolveSpecPath(args, { cwd = REPO_ROOT } = {}) {
  // Skip flag tokens; the first non-flag positional wins.
  const positional = args.find((a) => !a.startsWith('--'));
  if (positional) {
    const abs = isAbsolute(positional) ? positional : resolve(cwd, positional);
    if (!existsSync(abs)) {
      throw new TypeError(`ambiguity: spec file not found: ${abs}`);
    }
    return abs;
  }
  const recent = findMostRecentSpec({ cwd });
  if (!recent) {
    throw new TypeError(
      `ambiguity: no positional path supplied and no ${DEFAULT_SPECS_DIR}/deep-interview-*.md files found under ${cwd}`,
    );
  }
  return recent;
}

/**
 * Parse the CLI flags. Recognises:
 *   --format <json|human>     output format (default: human)
 *   --breakdown               show per-dimension contributions
 *   --allow-high              permit score > 0.10 (override closure gate)
 *   --kind <greenfield|brownfield>
 *                             override the inferred kind
 *   --help, -h                show usage banner
 */
export function parseFlags(args) {
  /** @type {Record<string, string | boolean>} */
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
      continue;
    }
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

/**
 * Parse a markdown spec and extract the `## Ambiguity breakdown`
 * section. Returns:
 *   {
 *     clarityBreakdown: { [dimension]: number },
 *     kind: 'greenfield' | 'brownfield',
 *     explicitScore?: number,    // only when the spec embeds one
 *     sectionText: string,       // raw section text for debug
 *   }
 *
 * Two embedded formats are supported:
 *
 *   1. JSON code block (preferred — round-trips the SDK object):
 *      ```json
 *      {
 *        "kind": "greenfield",
 *        "clarityBreakdown": { "intent": 0.95, "outcome": 0.92, ... },
 *        "score": 0.08
 *      }
 *      ```
 *
 *   2. Markdown table with a parallel dimension / clarity column:
 *      | Dimension | Clarity | ... |
 *      |---|---|---|
 *      | intent | 0.95 | ... |
 *
 * Throws `TypeError` with a precise message on malformed input.
 */
export function parseAmbiguitySection(specText) {
  const headingRe = /^#{1,6}\s*Ambiguity breakdown\s*$/im;
  const headingMatch = specText.match(headingRe);
  if (!headingMatch) {
    throw new TypeError(
      'parseAmbiguitySection: no "## Ambiguity breakdown" heading found in spec',
    );
  }
  const sectionStart = headingMatch.index + headingMatch[0].length;
  // Section ends at the next heading of any level.
  const restOfDoc = specText.slice(sectionStart);
  const nextHeading = restOfDoc.match(/^#{1,6}\s/m);
  const sectionText = nextHeading ? restOfDoc.slice(0, nextHeading.index) : restOfDoc;

  // ── Format 1: JSON code block ─────────────────────────────────────────
  const jsonMatch = sectionText.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[1]);
    } catch (err) {
      throw new TypeError(`parseAmbiguitySection: malformed JSON block: ${err.message}`);
    }
    if (parsed == null || typeof parsed !== 'object') {
      throw new TypeError('parseAmbiguitySection: JSON block must be an object');
    }
    // Accept either {kind, clarityBreakdown} or a full {kind, score, breakdown}.
    let clarityBreakdown;
    if (parsed.clarityBreakdown && typeof parsed.clarityBreakdown === 'object') {
      clarityBreakdown = parsed.clarityBreakdown;
    } else if (parsed.breakdown && typeof parsed.breakdown === 'object') {
      // `breakdown` is the contribution map (Σ w_i · c_i). Recover the
      // raw clarity values by dividing each contribution by its weight.
      clarityBreakdown = {};
      const weights = AMBIGUITY_WEIGHTS[parsed.kind ?? DEFAULT_KIND];
      for (const [dim, contribution] of Object.entries(parsed.breakdown)) {
        const w = weights[dim];
        if (typeof w !== 'number' || w === 0) {
          throw new TypeError(
            `parseAmbiguitySection: cannot invert breakdown for dimension "${dim}" (missing weight)`,
          );
        }
        clarityBreakdown[dim] = contribution / w;
      }
    } else {
      throw new TypeError(
        'parseAmbiguitySection: JSON block must contain either "clarityBreakdown" or "breakdown"',
      );
    }
    return {
      clarityBreakdown,
      kind: parsed.kind ?? DEFAULT_KIND,
      explicitScore: typeof parsed.score === 'number' ? parsed.score : undefined,
      sectionText,
    };
  }

  // ── Format 2: markdown table ──────────────────────────────────────────
  const tableRows = [];
  for (const line of sectionText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = trimmed
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
    if (cells.length < 2) continue;
    // Skip the header row and the dashed separator row.
    if (/^-+$/.test(cells[0])) continue;
    const dim = cells[0].toLowerCase();
    const clarityRaw = cells[1];
    if (dim === 'dimension' || dim === '') continue;
    if (!/^[a-z]+$/.test(dim)) continue;
    const clarity = Number(clarityRaw);
    if (!Number.isFinite(clarity)) continue;
    tableRows.push([dim, clarity]);
  }
  if (tableRows.length === 0) {
    throw new TypeError(
      'parseAmbiguitySection: no JSON block and no markdown table found in section',
    );
  }
  const clarityBreakdown = Object.fromEntries(tableRows);
  // Look for an explicit `**Kind:**` line anywhere in the section.
  const kindMatch = sectionText.match(/\*\*Kind:\*\*\s*`?([a-z]+)`?/i);
  const scoreMatch = sectionText.match(/\*\*AmbiguityScore:\*\*\s*([0-9.]+)/i);
  return {
    clarityBreakdown,
    kind: kindMatch ? kindMatch[1].toLowerCase() : DEFAULT_KIND,
    explicitScore: scoreMatch ? Number(scoreMatch[1]) : undefined,
    sectionText,
  };
}

/**
 * Validate the parsed breakdown against the chosen kind's weight set.
 * Throws `TypeError` when a required dimension is missing or out of
 * range; the SDK would catch this too but we want a CLI-friendly error
 * before the SDK call so the operator sees a precise message.
 */
export function validateBreakdown(clarityBreakdown, kind) {
  const weights = AMBIGUITY_WEIGHTS[kind];
  if (!weights) {
    throw new TypeError(`validateBreakdown: unknown kind "${kind}"`);
  }
  for (const [dim, weight] of Object.entries(weights)) {
    const value = clarityBreakdown[dim];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
      throw new TypeError(
        `validateBreakdown: dimension "${dim}" must be a finite number in [0, 1] (got ${String(value)})`,
      );
    }
    if (typeof weight !== 'number' || weight <= 0) {
      throw new TypeError(
        `validateBreakdown: weight for "${dim}" must be a positive number (got ${String(weight)})`,
      );
    }
  }
}

export const USAGE = `
  bizar ambiguity — score a deep-interview spec's clarity breakdown

  Usage:
    bizar ambiguity [<spec-path>] [--format=json|human] [--breakdown]
                     [--allow-high] [--kind greenfield|brownfield]

  Arguments:
    <spec-path>              Path to a deep-interview spec. Defaults to the
                             most recent docs/specs/deep-interview-*.md.

  Flags:
    --format <fmt>           Output format. 'human' (default) prints a clean
                             aligned table; 'json' emits the raw score object.
    --breakdown              Include per-dimension contributions in human
                             output and JSON.
    --allow-high             Permit AmbiguityScore > 0.10 without exiting
                             non-zero. Required for the closure threshold
                             gate when a high score is intentional.
    --kind <kind>            Override the inferred weight preset
                             (greenfield | brownfield). Default: greenfield.
    --help, -h               Show this help banner.

  Exit codes:
    0   score ≤ 0.10 (closure threshold met)
    1   score > 0.10 and --allow-high was NOT supplied
    2   usage error / malformed spec

  Notes:
    Per DEC-022, this command NEVER writes to docs/specs/. The
    deep-interview skill owns the artifact writes; this command is
    read-only and reports the score.
`;

/** Format a number for the human table — clamp at 4 decimal places. */
function fmt(value, width = 7) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a'.padStart(width);
  return value.toFixed(4).padStart(width);
}

/** Render the score as an aligned human table. */
export function renderHuman({ specPath, kind, score, breakdown, explicitScore, showBreakdown }) {
  const lines = [];
  lines.push(`bizar ambiguity — ${basename(specPath)}`);
  lines.push('');
  lines.push(`  kind:                ${kind}`);
  if (typeof explicitScore === 'number') {
    lines.push(`  spec-stored score:   ${explicitScore.toFixed(4)}`);
  }
  lines.push(`  computed score:      ${fmt(score)}`);
  lines.push(`  closure threshold:   ${CLOSURE_THRESHOLD.toFixed(2)}  (${score <= CLOSURE_THRESHOLD ? 'PASS' : 'ABOVE'})`);
  if (showBreakdown) {
    lines.push('');
    lines.push(`  ${'dimension'.padEnd(14)}${'weight'.padStart(8)}${'clarity'.padStart(10)}${'contribution'.padStart(15)}`);
    const weights = AMBIGUITY_WEIGHTS[kind];
    for (const dim of Object.keys(weights)) {
      const w = weights[dim];
      const c = breakdown[dim] ?? 0;
      const contrib = (breakdown[dim] ?? 0) * w;
      lines.push(`  ${dim.padEnd(14)}${fmt(w, 8)}${fmt(c, 10)}${fmt(contrib, 15)}`);
    }
  }
  lines.push('');
  lines.push(`  schema:              ${AMBIGUITY_SCHEMA_VERSION}`);
  return lines.join('\n');
}

/** Render the score as JSON (always includes breakdown). */
export function renderJson({ specPath, kind, score, breakdown, explicitScore, showBreakdown }) {
  const out = {
    spec: specPath,
    kind,
    score,
    schemaVersion: AMBIGUITY_SCHEMA_VERSION,
    closureThreshold: CLOSURE_THRESHOLD,
    pass: score <= CLOSURE_THRESHOLD,
  };
  if (typeof explicitScore === 'number') {
    out.specScore = explicitScore;
    out.scoreMatchesSpec = Math.abs(explicitScore - score) < 1e-3;
  }
  if (showBreakdown) {
    out.breakdown = { ...breakdown };
  } else {
    // Always include a slim breakdown so callers can render a table
    // without recomputing the contributions.
    out.breakdown = { ...breakdown };
  }
  return out;
}

/**
 * Run the ambiguity command.
 *
 * @param {string[]} subargs   remaining CLI tokens after `binar ambiguity`
 * @returns {Promise<number>}  process exit code (0, 1, or 2)
 */
export async function run(subargs) {
  const flags = parseFlags(subargs);
  if (flags.help) {
    console.log(USAGE);
    return 0;
  }

  const format = String(flags.format ?? 'human');
  if (format !== 'human' && format !== 'json') {
    console.error(`ambiguity: --format must be 'human' or 'json' (got '${format}')`);
    return 2;
  }
  const allowHigh = Boolean(flags['allow-high']);
  const showBreakdown = Boolean(flags.breakdown);
  const kindOverride = flags.kind ? String(flags.kind) : null;

  let specPath;
  try {
    specPath = resolveSpecPath(subargs);
  } catch (err) {
    console.error(`ambiguity: ${err.message}`);
    return 2;
  }

  let parsed;
  try {
    const specText = readFileSync(specPath, 'utf8');
    parsed = parseAmbiguitySection(specText);
  } catch (err) {
    console.error(`ambiguity: ${err.message}`);
    return 2;
  }

  const kind = kindOverride ?? parsed.kind;
  try {
    validateBreakdown(parsed.clarityBreakdown, kind);
  } catch (err) {
    console.error(`ambiguity: ${err.message}`);
    return 2;
  }

  const computed = computeAmbiguity(parsed.clarityBreakdown, kind);

  if (format === 'json') {
    console.log(
      JSON.stringify(
        renderJson({
          specPath,
          kind,
          score: computed.score,
          breakdown: computed.breakdown,
          explicitScore: parsed.explicitScore,
          showBreakdown,
        }),
        null,
        2,
      ),
    );
  } else {
    console.log(
      renderHuman({
        specPath,
        kind,
        score: computed.score,
        breakdown: computed.breakdown,
        explicitScore: parsed.explicitScore,
        showBreakdown,
      }),
    );
  }

  if (computed.score > CLOSURE_THRESHOLD && !allowHigh) {
    console.error(
      `ambiguity: score ${computed.score.toFixed(4)} exceeds closure threshold ${CLOSURE_THRESHOLD.toFixed(2)}; pass --allow-high to override`,
    );
    return 1;
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).then((code) => process.exit(code));
}
