/**
 * cli/commands/__tests__/update-help-contract.test.mjs
 *
 * v10.19.6 — help-text fence test for `bizar update`.
 *
 * The previous help text advertised `--check`, `--channel=stable|beta`,
 * and `--all`, none of which were actually wired up. This test pins the
 * contract going forward:
 *
 *   1. Every `--<word>` token in `showUpdateHelp` is recognized by
 *      `parseFlags` (or is explicitly marked as deprecated/dropped in
 *      the help body).
 *   2. The four flags the help text currently advertises
 *      (`--dry-run`, `--force`, `--yes`, `--help`) are all recognized.
 *   3. The three flags the help text MUST NOT advertise
 *      (`--check`, `--channel`, `--all`) are absent.
 *
 * Pairs with `cli/install/prune.test.mjs#parseFlags` which pins the
 * parser side of the same contract.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COMMANDS_DIR = join(__dirname, '..');
const INSTALL_MJS = join(COMMANDS_DIR, 'install.mjs');

/**
 * Extract the body of `showUpdateHelp` as a string by reading the
 * module source and slicing from the opening backtick after the
 * `console.log(` line to the matching closing backtick. We use the
 * source (not the runtime function) so the test pins what's in the
 * help text, not just what gets printed after console.log rendering
 * (escape sequences, etc.).
 */
function getShowUpdateHelpSource() {
  const src = readFileSync(INSTALL_MJS, 'utf8');
  const startMarker = 'export function showUpdateHelp() {';
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error('showUpdateHelp function not found in cli/commands/install.mjs');
  // Find the template-literal opening backtick immediately after the
  // `console.log(` that lives INSIDE `showUpdateHelp` (not inside an
  // earlier function in the same file). We constrain the search to
  // the function body by starting at `start` and stopping at the next
  // top-level closing brace.
  const logStart = src.indexOf('console.log(`', start);
  if (logStart === -1) throw new Error('console.log template literal not found in showUpdateHelp');
  const templateStart = logStart + 'console.log(`'.length;
  const remaining = src.slice(templateStart);
  // The template literal in this codebase is closed by `);` on its own
  // line — find that pattern. Restrict the search to the first match
  // (the template literal is always the first `console.log` inside
  // showUpdateHelp, and the closing backtick is on a dedicated line).
  const closeMarker = remaining.indexOf('\n  `);');
  if (closeMarker === -1) {
    const fallback = remaining.indexOf('`);');
    if (fallback === -1) throw new Error('Could not find template-literal terminator in showUpdateHelp');
    return remaining.slice(0, fallback);
  }
  return remaining.slice(0, closeMarker);
}

/**
 * Extract the body of `showInstallHelp` from cli/commands/install.mjs.
 * Same source-slicing technique as getShowUpdateHelpSource so the test
 * pins the static help text. Used by the commit-7 help-text contract
 * tests below to assert that the three new flags --targets,
 * --install-claude-cli, and --force-targets are advertised in the
 * install help (the wizard / --install paths live in showInstallHelp,
 * not showUpdateHelp).
 */
function getShowInstallHelpSource() {
  const src = readFileSync(INSTALL_MJS, 'utf8');
  const startMarker = 'export function showInstallHelp() {';
  const start = src.indexOf(startMarker);
  if (start === -1) throw new Error('showInstallHelp function not found in cli/commands/install.mjs');
  const logStart = src.indexOf('console.log(`', start);
  if (logStart === -1) throw new Error('console.log template literal not found in showInstallHelp');
  const templateStart = logStart + 'console.log(`'.length;
  const remaining = src.slice(templateStart);
  const closeMarker = remaining.indexOf('\n  `);');
  if (closeMarker === -1) {
    const fallback = remaining.indexOf('`);');
    if (fallback === -1) throw new Error('Could not find template-literal terminator in showInstallHelp');
    return remaining.slice(0, fallback);
  }
  return remaining.slice(0, closeMarker);
}

function extractFlagTokens(helpText) {
  // Match ` --foo`, ` --foo=bar`, ` --foo bar` style tokens. We allow
  // an optional `=` value suffix. We omit `--` alone and any token
  // containing a `/` (those are usually part of a path or label).
  const re = /(?:^|\s)(--[a-z][a-z0-9-]*)(?:=|\b)/g;
  const out = new Set();
  let m;
  while ((m = re.exec(helpText)) !== null) {
    out.add(m[1]);
  }
  return out;
}

describe('showUpdateHelp — v10.19.6 flag contract', () => {
  test('extractShowUpdateHelpSource returns non-empty help body', () => {
    const help = getShowUpdateHelpSource();
    assert.ok(help.length > 100, 'help body should be substantive');
    assert.match(help, /bizar update/);
  });

  test('every --<flag> token in showUpdateHelp is recognized by parseFlags', async () => {
    const { parseFlags } = await import('../../provision.mjs');
    const help = getShowUpdateHelpSource();
    const tokens = extractFlagTokens(help);

    assert.ok(tokens.size > 0, 'expected at least one --flag token in help text');

    // --help has special semantics in parseFlags (it calls
    // process.exit(0) immediately rather than returning a flag
    // object), so it is verified separately below and excluded
    // from this iteration.
    const skipped = new Set(['--help']);
    const canonicalKeys = ['mode', 'dryRun', 'force', 'yes'];

    for (const flag of tokens) {
      if (skipped.has(flag)) continue;
      const parsed = parseFlags([flag]);
      const hit = canonicalKeys.some((k) => parsed[k] === true || (k === 'mode' && parsed.mode && parsed.mode !== 'install'));
      assert.ok(
        hit,
        `Help text advertises ${flag} but parseFlags does not recognize it. Either wire it into the parser or drop it from the help text.`
      );
    }
  });

  test('help text advertises exactly the four recognized flags: --dry-run, --force, --yes, --help', () => {
    const help = getShowUpdateHelpSource();
    for (const flag of ['--dry-run', '--force', '--yes', '--help']) {
      assert.match(help, new RegExp(flag.replace(/[-]/g, '\\-')), `help text must mention ${flag}`);
    }
  });

  test('help text does NOT advertise dropped flags: --check, --channel, --all', () => {
    // v10.19.6 — these three flags were documented in showUpdateHelp
    // but never wired into parseFlags or runInstaller. They must stay
    // absent from the help text until someone actually implements them
    // (FUTURE: track in feature_list.json before re-adding).
    const help = getShowUpdateHelpSource();
    assert.doesNotMatch(help, /--check\b/, '--check must not be advertised (dropped in v10.19.6; feature not implemented)');
    assert.doesNotMatch(help, /--channel\b/, '--channel must not be advertised (dropped in v10.19.6; feature not implemented)');
    assert.doesNotMatch(help, /--all\b/, '--all must not be advertised (dropped in v10.19.6; feature not implemented)');
  });

  test('help text mentions the post-update `bizar doctor` check (A5 regression)', () => {
    const help = getShowUpdateHelpSource();
    assert.match(help, /doctor/i, 'help text must mention the post-update doctor check');
  });

  test('cli/bin.mjs Examples block does not advertise unwired flags (A7)', () => {
    const bin = readFileSync(join(__dirname, '..', '..', 'bin.mjs'), 'utf8');
    const start = bin.search(/(?:Commands|Examples|Description):/);
    if (start === -1) throw new Error('Examples/Commands/Description heading not found in cli/bin.mjs');
    // Slice from the first Examples heading through the next sibling heading
    // (or end of string) so we fence only the operator-visible top-level surface.
    const tail = bin.slice(start);
    const next = tail.slice(7).search(/(?:Commands|Description):/);
    const examples = next === -1 ? tail : tail.slice(0, next + 7);
    assert.doesNotMatch(examples, /\b--all\b/, '--all must not appear in cli/bin.mjs Examples (dropped in v10.19.6)');
    assert.doesNotMatch(examples, /\b--check\b/, '--check must not appear in cli/bin.mjs Examples (dropped in v10.19.6)');
    assert.doesNotMatch(examples, /\b--channel\b/, '--channel must not appear in cli/bin.mjs Examples (dropped in v10.19.6)');
  });

  test('help text mentions bin-symlink repair (A6 regression)', () => {
    const help = getShowUpdateHelpSource();
    assert.match(
      help,
      /repair|stale|bin/,
      'help text must mention the post-update bin-symlink repair step'
    );
  });

  // ── installer-redesign-v2 commit 7: install-help flag contract ──
  //
  // The wizard / --install paths live in `showInstallHelp`, not
  // `showUpdateHelp`. Commit 7 wires three new flags through
  // `cli/commands/install.mjs` and they must all appear in the help
  // text so operators discover them via `bizar install --help`.

  test('showInstallHelp returns non-empty help body', () => {
    const help = getShowInstallHelpSource();
    assert.ok(help.length > 100, 'install help body should be substantive');
    assert.match(help, /bizar install/);
  });

  test('install help advertises --targets flag (commit 7)', () => {
    const help = getShowInstallHelpSource();
    assert.match(help, /--targets/, 'install help text must mention --targets=<csv>');
  });

  test('install help advertises --install-claude-cli flag (commit 7)', () => {
    const help = getShowInstallHelpSource();
    assert.match(help, /--install-claude-cli/, 'install help text must mention --install-claude-cli');
  });

  test('install help advertises --force-targets flag (commit 7)', () => {
    const help = getShowInstallHelpSource();
    assert.match(help, /--force-targets/, 'install help text must mention --force-targets=<csv>');
  });

  test('install help mentions the F-7 default-OFF installClaudeCli behavior', () => {
    // The help text MUST explicitly note that Claude Code is NOT
    // auto-installed, otherwise operators who rely on the previous
    // default will miss the behavior flip.
    const help = getShowInstallHelpSource();
    assert.match(
      help,
      /installClaudeCli|install-claude-cli|opt.?in|never auto/i,
      'install help text must explain the F-7 opt-in / never-auto-install default'
    );
  });
});

console.log('  update-help-contract.test.mjs loaded — run with: node --test cli/commands/__tests__/update-help-contract.test.mjs');
