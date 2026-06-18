/**
 * bizar plan-templates.mjs
 *
 * Built-in template library for the visual planner v2.
 *
 * Templates are stored in two places:
 *   1. JS-embedded defaults (so the CLI works without filesystem reads)
 *   2. templates/plan/library/*.mdx (so users can edit/add templates)
 *
 * At lookup time we prefer the on-disk .mdx file (if present) and fall
 * back to the embedded string. The "blank" template is special: it
 * delegates to the existing plan.mdx.template file via the CLI caller.
 *
 * Exports:
 *   - getTemplate(name)   → { name, description, content } | null
 *   - getTemplateNames()  → string[] (sorted)
 *   - listTemplates()     → [{ name, description, source }, ...]
 *   - printTemplates()    → writes a friendly CLI listing to stdout
 *
 * The names "blank", "feature-design", "bug-investigation", and
 * "decision-record" are reserved (case-insensitive).
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');
const TEMPLATES_DIR = join(PROJECT_ROOT, 'templates', 'plan');
const LIBRARY_DIR = join(TEMPLATES_DIR, 'library');

// ─── Embedded defaults ──────────────────────────────────────────────────────
//
// These are kept in sync with templates/plan/library/*.mdx. If the
// library directory is missing a file, the embedded version is used.
// To change a built-in template, edit BOTH (or just the .mdx file if
// the file is present — the loader prefers files).

const BUILT_IN_TEMPLATES = {
  'blank': {
    description: 'Empty starter — the same template the v1 planner used',
    content: null, // signals: caller should use plan.mdx.template
  },
  'feature-design': {
    description: 'For designing a new feature (problem, goals, design, tradeoffs)',
    content: `# Feature: {{title}}

**Status:** \`[STATUS:draft]\` · **Author:** {{author}} · **Created:** {{created}}

> [!INFO]
> This is a v2 plan with the **feature-design** template. It uses callouts
> (\`> [!INFO]\`, \`> [!WARNING]\`, etc.), status badges, and GFM task lists.

## Problem

_What problem are we solving? Why now? What happens if we don't?_

## Goals

- [ ] Goal 1 — a concrete, measurable outcome
- [ ] Goal 2 — another concrete, measurable outcome
- [ ] Goal 3 — and one more for good measure

## Non-goals

- This feature does NOT do X (deferred to a future plan)
- This feature does NOT cover Y (out of scope for this iteration)

## Design

The proposed approach. Walk through the high-level shape, then drill into specifics.

### Architecture

\`\`\`mermaid
graph LR
  Client --> API --> DB
  API --> Cache
\`\`\`

### Data model

Tables, schemas, types. Show diffs or new shapes.

### API

_Endpoints, request/response shapes, error handling._

### Edge cases

- What if X is empty?
- What if Y is malformed?
- What if the user is offline?

## Tradeoffs

| Option | Pros | Cons |
|--------|------|------|
| A      | Simple, easy to roll back | Limited to use case 1 |
| B      | Handles more cases       | More complex, more tests |

## Files affected

- \`path/to/file.ts\` — what changes and why
- \`path/to/other.ts\` — what changes and why
- \`path/to/migration.sql\` — schema changes

## Open questions

1. Question 1?
2. Question 2?
3. Question 3?

## Test plan

- [ ] Unit tests for the new module
- [ ] Integration tests for the API surface
- [ ] E2E test for the user flow
- [ ] Manual QA in staging

## Rollout

- [ ] Dev
- [ ] Staging
- [ ] Production (% rollout)

## Decision

> [!TIP]
> Pick option **A** or **B** and state the rationale here. Reference the
> Tradeoffs table above. Link to relevant docs / RFCs.

## References

- [Design doc](https://example.com/design)
- [Related plan](#)
`,
  },
  'bug-investigation': {
    description: 'For investigating a bug (repro, root cause, fix, regression test)',
    content: `# Bug: {{title}}

**Status:** \`[STATUS:draft]\` · **Author:** {{author}} · **Created:** {{created}}

> [!DANGER]
> Severity: <high/medium/low> · Reported: <date> · Reporter: <name>

## Summary

_One-paragraph description of the bug._

## Reproduction

Steps to reproduce:
1. Step 1
2. Step 2
3. ...

## Expected vs Actual

**Expected:** What should happen.

**Actual:** What actually happens.

## Environment

- App version: <version>
- OS: <os>
- Browser: <browser>
- Account: <test-account-id> (if reproducible only on certain accounts)

## Investigation

> [!NOTE]
> Document the timeline of what you tried, what you found, and what
> you ruled out. Link to relevant logs, traces, or screenshots.

### What we tried

- Tried X — found Y
- Tried A — ruled out B

### What we found

- Observation 1
- Observation 2

## Root cause

> [!WARNING]
> State the underlying cause clearly. If the cause is unknown, say so
> and list the most likely candidates.

_The underlying issue._

## Fix

> [!TIP]
> Describe the proposed fix. Include a code diff or a sketch of the
> change. Note any follow-up work that's needed but out of scope here.

_The proposed fix._

## Test plan

- [ ] Test that the bug is fixed (regression test on the failing case)
- [ ] Test that the fix doesn't break anything (existing tests still pass)
- [ ] Add a regression test to the suite
- [ ] Manual verification in staging

## Rollback plan

_How do we revert if the fix makes things worse?_

## References

- [PR #X](https://example.com/pr/X)
- [Slack thread](https://example.com/slack)
- [Related incidents](#)
`,
  },
  'decision-record': {
    description: 'Architecture Decision Record (ADR) — context, options, decision, consequences',
    content: `# Decision: {{title}}

**Status:** \`[STATUS:draft]\` · **Author:** {{author}} · **Date:** {{created}}

> [!INFO]
> This is an **Architecture Decision Record (ADR)**. It captures a
> significant decision, the context that led to it, and the consequences
> that follow. Once accepted, ADRs are immutable — create a new ADR to
> supersede this one.

## Context

_What is the situation? What forces are at play? What problem are we
trying to solve? What constraints do we have?_

## Options considered

### Option A: <name>

_Brief description._

- Pros: …
- Cons: …

### Option B: <name>

_Brief description._

- Pros: …
- Cons: …

### Option C: <name>

_Brief description._

- Pros: …
- Cons: …

## Decision

> [!TIP]
> State the chosen option and the rationale. Quote relevant constraints
> from the Context section. Note any dissent.

We chose **Option X** because…

## Consequences

### Positive

- …

### Negative

- …

### Neutral

- …

## Follow-ups

- [ ] Follow-up 1
- [ ] Follow-up 2
- [ ] Follow-up 3

## References

- [Doc 1](https://example.com/doc-1)
- [Doc 2](https://example.com/doc-2)
- [Related ADRs](#)
`,
  },
};

// ─── File loader ─────────────────────────────────────────────────────────────

/**
 * Read a .mdx file from the library directory if it exists.
 * Returns null if the file is absent or unreadable.
 */
function readLibraryFile(slug) {
  const path = join(LIBRARY_DIR, `${slug}.mdx`);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Discover user-added templates in the library directory that are not
 * already in BUILT_IN_TEMPLATES. Any *.mdx file whose basename (without
 * extension) isn't a reserved built-in name becomes a "custom" entry.
 */
function discoverCustomTemplates() {
  if (!existsSync(LIBRARY_DIR)) return [];
  const reserved = new Set(Object.keys(BUILT_IN_TEMPLATES));
  const out = [];
  for (const name of readdirSync(LIBRARY_DIR)) {
    if (!name.endsWith('.mdx')) continue;
    const slug = name.slice(0, -'.mdx'.length);
    if (reserved.has(slug)) continue;
    const path = join(LIBRARY_DIR, name);
    try {
      const content = readFileSync(path, 'utf-8');
      out.push({
        name: slug,
        description: 'Custom template',
        content,
        source: 'library',
      });
    } catch {
      // skip unreadable
    }
  }
  return out;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Return the template record for a given name (case-insensitive).
 * For the "blank" template, content is null — the caller should use
 * plan.mdx.template as the source.
 *
 * @param {string} name
 * @returns {{ name: string, description: string, content: string|null, source: 'built-in'|'library' } | null}
 */
export function getTemplate(name) {
  if (!name) return null;
  const normalized = String(name).toLowerCase().trim();
  if (!BUILT_IN_TEMPLATES[normalized]) return null;

  // "blank" is special: caller should use the standard plan.mdx.template
  if (normalized === 'blank') {
    return {
      name: 'blank',
      description: BUILT_IN_TEMPLATES.blank.description,
      content: null,
      source: 'built-in',
    };
  }

  // Try the on-disk library file first; fall back to the JS-embedded copy.
  const fileContent = readLibraryFile(normalized);
  if (fileContent != null) {
    return {
      name: normalized,
      description: BUILT_IN_TEMPLATES[normalized].description,
      content: fileContent,
      source: 'library',
    };
  }

  return {
    name: normalized,
    description: BUILT_IN_TEMPLATES[normalized].description,
    content: BUILT_IN_TEMPLATES[normalized].content,
    source: 'built-in',
  };
}

/**
 * @returns {string[]} Sorted list of built-in template names.
 */
export function getTemplateNames() {
  return Object.keys(BUILT_IN_TEMPLATES).sort();
}

/**
 * List all templates, including user-added ones in the library directory.
 * @returns {Array<{ name: string, description: string, source: string }>}
 */
export function listTemplates() {
  const builtIn = Object.keys(BUILT_IN_TEMPLATES).sort().map((name) => ({
    name,
    description: BUILT_IN_TEMPLATES[name].description,
    source: name === 'blank' ? 'built-in' : (readLibraryFile(name) != null ? 'library' : 'built-in'),
  }));
  return [...builtIn, ...discoverCustomTemplates()];
}

/**
 * Print a friendly CLI listing of all available templates.
 */
export function printTemplates() {
  const all = listTemplates();
  console.log('  Built-in templates:');
  const nameWidth = Math.max(...all.map((t) => t.name.length), 8);
  for (const t of all) {
    const tag = t.source === 'library' ? ' (override)' : '';
    console.log(`    ${t.name.padEnd(nameWidth)}  ${t.description}${tag}`);
  }
  console.log();
  console.log('  Use: bizar plan new <slug> --template <name>');
  console.log('  Built-in: ' + Object.keys(BUILT_IN_TEMPLATES).join(', '));
}

// ─── Variable substitution ───────────────────────────────────────────────────

/**
 * Substitute {{key}} placeholders in template content. Mirrors the
 * behavior of the existing plan.mjs replaceTemplate — kept here so
 * the templates module is self-contained.
 *
 * @param {string} content
 * @param {Record<string,string>} vars
 */
export function substitute(content, vars) {
  let out = content;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
  }
  return out;
}

/**
 * Build the standard variable set used to render a template.
 *
 * @param {{ slug: string, title?: string }} opts
 */
export function buildVars({ slug, title }) {
  const now = new Date().toISOString();
  return {
    title: title || slug,
    slug,
    author: process.env.USER || 'unknown',
    created: now,
    lastEdited: now,
  };
}

// ─── CLI helpers (for `plan template save/list/delete`) ──────────────────────
//
// These are minimal — the spec for v2 calls for full user-saved templates
// in ~/.config/bizar/plan-templates/. v2.0 ships a stub for
// library-directory operations; the user-templates dir is deferred to
// a follow-up.

const USER_TEMPLATES_DIR = join(
  process.env.HOME || process.env.USERPROFILE || '~',
  '.config',
  'bizar',
  'plan-templates',
);

/**
 * Save the content of an existing plan as a library template.
 * If a name is given, the file is written to templates/plan/library/.
 * The plan is read from plans/<planSlug>/plan.mdx.
 *
 * @param {string} name        template name (becomes the filename)
 * @param {string} planSlug    source plan to read content from
 * @returns {string} absolute path to the saved file
 */
export function saveTemplate(name, planSlug) {
  if (!name || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) {
    throw new Error(`Invalid template name "${name}". Use lowercase letters, digits, and hyphens.`);
  }
  if (!planSlug || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(planSlug)) {
    throw new Error(`Invalid plan slug "${planSlug}".`);
  }
  const sourcePath = join(PROJECT_ROOT, 'plans', planSlug, 'plan.mdx');
  if (!existsSync(sourcePath)) {
    throw new Error(`Plan "${planSlug}" not found at ${sourcePath}`);
  }
  const content = readFileSync(sourcePath, 'utf-8');
  mkdirSync(LIBRARY_DIR, { recursive: true });
  const target = join(LIBRARY_DIR, `${name}.mdx`);
  writeFileSync(target, content, 'utf-8');
  return target;
}

/**
 * Delete a user-added template from the library directory.
 * Refuses to delete built-in templates.
 *
 * @param {string} name
 */
export function deleteTemplate(name) {
  const normalized = String(name || '').toLowerCase();
  if (BUILT_IN_TEMPLATES[normalized]) {
    throw new Error(`"${name}" is a built-in template and cannot be deleted.`);
  }
  const path = join(LIBRARY_DIR, `${normalized}.mdx`);
  if (!existsSync(path)) {
    throw new Error(`Template "${name}" not found in library.`);
  }
  unlinkSync(path);
  return path;
}

// ─── Constants export (for tests) ────────────────────────────────────────────

export const BUILT_IN_TEMPLATE_NAMES = Object.keys(BUILT_IN_TEMPLATES);
export const LIBRARY_DIR_PATH = LIBRARY_DIR;
export const USER_TEMPLATES_DIR_PATH = USER_TEMPLATES_DIR;
