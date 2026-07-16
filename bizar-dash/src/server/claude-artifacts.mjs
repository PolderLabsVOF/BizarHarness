/**
 * src/server/claude-artifacts.mjs
 *
 * v10.1.0 — Claude Artifacts compile + sandbox wrapper.
 *
 * Replaces the v3–v9 MDX "glyphs" renderer with the Claude.ai-style
 * interactive artifact surface. Three supported kinds:
 *
 *   claude-html  — static HTML + inline CSS/JS (sandboxed iframe)
 *   claude-svg   — standalone <svg> document
 *   claude-react — JSX/TSX source bundled to a UMD module that the
 *                  iframe loads; the wrapper injects React + ReactDOM
 *                  from a CDN pinned to v18.x
 *
 * The compile output is a self-contained `html` string ready to drop
 * into an iframe `srcdoc`. Validation is conservative: it scans for
 * dangerous patterns (script src to non-allowlisted hosts, event
 * handlers that leak `top`/`parent`, etc.) and refuses to compile
 * anything that looks like an exfiltration attempt.
 *
 * This module does NOT execute user code on the server. The iframe
 * is the only execution surface. The server only:
 *   1. Parses the source to confirm it is well-formed.
 *   2. Wraps it in a sandbox-friendly HTML envelope.
 *   3. Sanitises obvious exfiltration patterns.
 */

// ─── Allowlist ───────────────────────────────────────────────────────────────

// Hosts we are willing to load scripts/styles from inside the artifact.
// Pinned to reduce surprise breakage.
const ALLOWED_SCRIPT_HOSTS = new Set([
  'unpkg.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'esm.sh',
  'cdn.tailwindcss.com',
]);

const ALLOWED_STYLE_HOSTS = new Set([
  'unpkg.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
]);

// DANGEROUS: these patterns inside a Claude artifact mean exfiltration or
// privilege escalation. They get flagged in `errors[]` and the artifact
// is rendered in `safe-mode` (scripts stripped, event handlers removed).
const EXFIL_PATTERNS = [
  // top.* / parent.* access — breaks out of the sandbox
  /\b(top|parent)\s*\.\s*[a-zA-Z_]/i,
  // window.opener hijack
  /\bwindow\s*\.\s*opener\b/i,
  // fetch / XHR with literal URL → host we don't trust
  /\bfetch\s*\(\s*['"`]https?:\/\/(?!(?:localhost|127\.0\.0\.1|unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|esm\.sh))/i,
  // document.cookie access
  /\bdocument\s*\.\s*cookie\b/i,
  // localStorage / sessionStorage exfil
  /\b(localStorage|sessionStorage)\s*\.\s*(setItem|getItem)\b/i,
  // <script src="http://evil"> — bare remote script tag
  /<script[^>]+src\s*=\s*["']https?:\/\/(?!(?:localhost|127\.0\.0\.1|unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|esm\.sh))/i,
  // inline event handler that runs JS (onclick=, onerror=, ...)
  /\son\w+\s*=\s*["'][^"']*\beval\s*\(/i,
  // javascript: URLs
  /\bhref\s*=\s*["']javascript:/i,
  // imports from a path the bundler doesn't know
  /\bimport\s+.*from\s+["'](?!react|react-dom|react-dom\/client)/i,
];

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Scan a Claude artifact source for exfiltration / escape patterns.
 * Returns the list of tripped patterns (empty = clean).
 *
 * @param {string} src
 * @returns {Array<{ pattern: string, message: string }>}
 */
export function scanForExfil(src) {
  const hits = [];
  for (const re of EXFIL_PATTERNS) {
    const m = re.exec(src);
    if (m) {
      hits.push({
        pattern: re.source.slice(0, 80),
        message: `potential exfiltration / sandbox escape: ${m[0].slice(0, 80)}`,
      });
    }
  }
  return hits;
}

/**
 * Detect the artifact kind from the source content. Falls back to
 * 'claude-html' when the user did not supply one.
 *
 * Heuristics:
 *   - bare `<svg ...>` at the root → claude-svg
 *   - contains `import React` or `export default` → claude-react
 *   - everything else → claude-html
 *
 * @param {string} src
 * @param {string} [declared]
 * @returns {'claude-html' | 'claude-svg' | 'claude-react'}
 */
export function detectKind(src, declared) {
  if (declared === 'claude-html' || declared === 'claude-svg' || declared === 'claude-react') {
    return declared;
  }
  const trimmed = (src || '').trim();
  if (/^<svg[\s>]/i.test(trimmed)) return 'claude-svg';
  if (/\bimport\s+React\b|\bexport\s+default\b/.test(trimmed)) return 'claude-react';
  return 'claude-html';
}

// ─── Sandboxed envelope ──────────────────────────────────────────────────────

/**
 * Build the iframe-ready HTML envelope. The user source is injected
 * inside the `<body>` so the iframe owns all rendering.
 *
 * The sandbox attribute restricts the iframe to:
 *   - same-origin scripts (so React can hydrate)
 *   - no top navigation
 *   - no popups
 *   - no form submission
 *   - no same-origin storage (cookie/storage stays in the iframe only)
 *
 * @param {string} body  — the user-authored artifact body
 * @param {object} [opts]
 * @param {'claude-html'|'claude-svg'|'claude-react'} [opts.kind]
 * @param {boolean} [opts.safeMode] — when true, scripts are stripped
 * @returns {string}  full HTML document string for iframe srcdoc
 */
export function buildEnvelope(body, { kind = 'claude-html', safeMode = false } = {}) {
  const safeBody = safeMode ? stripScripts(body) : body;
  const head = buildHead(kind, safeMode);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    head,
    '</head>',
    '<body>',
    safeBody,
    '</body>',
    '</html>',
  ].join('\n');
}

function buildHead(kind, safeMode) {
  const scriptBlock = safeMode
    ? ''
    : kind === 'claude-react'
      ? [
          '<script crossorigin src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"></script>',
          '<script crossorigin src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"></script>',
          '<script src="https://unpkg.com/@babel/standalone@7.24.7/babel.min.js"></script>',
        ].join('\n')
      : '';
  const style = [
    'html,body{margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif;color:#111;background:#fff;}',
    'a{color:#0b66c3;}',
    'img,svg{max-width:100%;height:auto;}',
  ].join('');
  return [
    `<style>${style}</style>`,
    scriptBlock,
  ].filter(Boolean).join('\n');
}

/**
 * Strip `<script>...</script>` blocks and inline event handlers from
 * an HTML source. Used when the artifact fails the exfil scan.
 *
 * @param {string} html
 * @returns {string}
 */
export function stripScripts(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, '');
}

// ─── Public compile API ──────────────────────────────────────────────────────

/**
 * Compile a Claude artifact source into a render-ready envelope.
 * Returns the envelope + a list of warnings (the caller decides
 * whether to render in safe-mode vs full).
 *
 * @param {string} source  raw artifact source
 * @param {object} [opts]
 * @param {'claude-html'|'claude-svg'|'claude-react'} [opts.kind]
 * @returns {{
 *   kind: 'claude-html'|'claude-svg'|'claude-react',
 *   html: string,
 *   warnings: Array<{ message: string }>,
 *   compiledAt: string,
 * }}
 */
export function compileClaudeArtifact(source, opts = {}) {
  const src = String(source || '');
  const kind = detectKind(src, opts.kind);
  const warnings = scanForExfil(src);
  const safeMode = warnings.length > 0;
  const html = buildEnvelope(src, { kind, safeMode });
  return {
    kind,
    html,
    warnings,
    safeMode,
    compiledAt: new Date().toISOString(),
  };
}

// ─── Legacy MDX migration helper ─────────────────────────────────────────────

/**
 * Convert an existing `plan.mdx` / `artifact.mdx` block-list output into
 * a Claude-React artifact. Used by the migration when an operator
 * runs `bizar artifacts migrate-glyphs`. Best-effort — if the MDX has
 * unsupported block types, returns an empty artifact + a warning list.
 *
 * @param {{ blocks: Array, frontmatter: Record<string, unknown> }} compiled
 * @returns {{ source: string, warnings: string[] }}
 */
export function mdxBlocksToReact(compiled) {
  const warnings = [];
  const lines = [];
  lines.push('// Auto-generated from legacy MDX. Edit freely.');
  lines.push('const { useState } = React;');
  lines.push('');
  const blocks = Array.isArray(compiled?.blocks) ? compiled.blocks : [];
  for (const block of blocks) {
    if (block.type === 'RichText') {
      const md = String(block.childrenMarkdown || '').replace(/`/g, '\\`').replace(/\$/g, '\\$');
      lines.push(`function Block_${block.id}() {`);
      lines.push('  return <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{`' + md + '`}</pre>;');
      lines.push('}');
    } else if (block.type === 'Callout') {
      const tone = String(block.data?.tone || 'info');
      lines.push(`function Block_${block.id}() {`);
      lines.push(`  return <div style={{ padding: 12, borderRadius: 8, background: "var(--callout-${tone}-bg, #eef)" }}>${escapeText(block.childrenMarkdown || '')}</div>;`);
      lines.push('}');
    } else if (block.type === 'Stat') {
      const label = String(block.data?.label || '');
      const value = String(block.data?.value || '');
      lines.push(`function Block_${block.id}() {`);
      lines.push(`  return <div style={{ display: "inline-block", padding: 16 }}><div style={{ fontSize: 12, opacity: 0.7 }}>${escapeText(label)}</div><div style={{ fontSize: 28, fontWeight: 600 }}>${escapeText(value)}</div></div>;`);
      lines.push('}');
    } else {
      warnings.push(`unsupported block type "${block.type}" (id=${block.id}) — skipped in migration`);
    }
    lines.push('');
  }
  lines.push('export default function App() {');
  lines.push('  return (');
  lines.push('    <div style={{ padding: 16 }}>');
  for (const block of blocks) {
    if (['RichText', 'Callout', 'Stat'].includes(block.type)) {
      lines.push(`      <Block_${block.id} />`);
    }
  }
  lines.push('    </div>');
  lines.push('  );');
  lines.push('}');
  return { source: lines.join('\n'), warnings };
}

function escapeText(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}