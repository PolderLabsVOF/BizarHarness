/**
 * heads-up.mjs — `bizar heads-up` subcommand.
 *
 * Reads and manages .bizar/PRE_PUSH_NOTES.md — a per-project file for
 * tracking gotchas, risks, and things-to-verify before pushing/publishing.
 *
 * Subcommands:
 *   list         Print active heads-up entries
 *   check        Exit code 0 (no blockers) or 1 (blockers found); batches
 *                with warnings printed to stderr
 *   archive      Move all active entries to the Resolved section
 */

import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Entry parsing
// ---------------------------------------------------------------------------

/**
 * Parse entries from the "Active heads-ups" section of a PRE_PUSH_NOTES.md.
 * Returns an array of { title, severity, area, affected, description,
 * mitigation, verified, lines } objects.
 */
function parseActiveEntries(content) {
  const entries = [];

  // Find the Active heads-ups section. We stop at the next h2 that starts
  // with an uppercase letter (section header like "## Resolved") but NOT
  // at entry titles that start with a date bracket "## [YYYY-MM-DD]".
  const activeMatch = content.match(/## Active heads-ups\n([\s\S]*?)(?=\n## [A-Z]|$)/);
  if (!activeMatch) return entries;

  const section = activeMatch[1];

  // Each entry starts with "## [YYYY-MM-DD] ..."
  const entryBlocks = section.split(/(?=^## \[)/m);
  for (const block of entryBlocks) {
    const trimmed = block.trim();
    if (!trimmed || trimmed.startsWith('<!--')) continue;

    const titleMatch = trimmed.match(/^##\s+(\[.+?\]\s*.+)$/m);
    if (!titleMatch) continue;

    const severityMatch = trimmed.match(/^Severity:\s*(\S+)/m);
    const areaMatch = trimmed.match(/^Area:\s*(.+)$/m);
    const affectedMatch = trimmed.match(/^Affected versions:\s*(.+)$/m);
    const descMatch = trimmed.match(/^Description:\s*(.+)$/m);
    const mitigMatch = trimmed.match(/^Mitigation:\s*(.+)$/m);
    const verifiedMatch = trimmed.match(/^Verified:\s*(.+)$/m);

    entries.push({
      title: titleMatch[1].trim(),
      severity: severityMatch ? severityMatch[1].trim().toLowerCase() : 'info',
      area: areaMatch ? areaMatch[1].trim() : null,
      affected: affectedMatch ? affectedMatch[1].trim() : null,
      description: descMatch ? descMatch[1].trim() : null,
      mitigation: mitigMatch ? mitigMatch[1].trim() : null,
      verified: verifiedMatch ? verifiedMatch[1].trim() : '☐',
      lines: trimmed,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function readPrePushNotes(bizarDir) {
  const file = join(bizarDir, 'PRE_PUSH_NOTES.md');
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8');
}

function findBizarDir(cwd) {
  // Walk up from cwd looking for .bizar/
  let dir = cwd;
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, '.bizar');
    if (existsSync(candidate)) return candidate;
    const parent = join(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Severity label helpers
// ---------------------------------------------------------------------------

function severityLabel(severity) {
  switch (severity) {
    case 'blocker': return chalk.bold.red('blocker');
    case 'warning': return chalk.bold.yellow('warning');
    case 'info':    return chalk.bold.blue('info');
    default:        return severity;
  }
}

// ---------------------------------------------------------------------------
// Subcommands
// ---------------------------------------------------------------------------

/**
 * `bizar heads-up list` — print active entries.
 */
async function listHeadsUps(bizarDir) {
  const content = readPrePushNotes(bizarDir);
  if (!content) {
    console.log(chalk.yellow('  No .bizar/PRE_PUSH_NOTES.md found. Run `bizar init` first.'));
    return;
  }

  const entries = parseActiveEntries(content);
  if (entries.length === 0) {
    console.log(chalk.green('  ✓ No active heads-ups.'));
    return;
  }

  console.log(chalk.bold('\n  ⚠  Active heads-ups:\n'));
  for (const entry of entries) {
    console.log(`  ${chalk.bold(entry.title)}  ${severityLabel(entry.severity)}`);
    if (entry.area)      console.log(`    Area:       ${entry.area}`);
    if (entry.affected)  console.log(`    Affects:    ${entry.affected}`);
    if (entry.description) console.log(`    ${chalk.dim(entry.description)}`);
    if (entry.mitigation)  console.log(`    Mitigation: ${chalk.cyan(entry.mitigation)}`);
    console.log(`    Verified:   ${entry.verified === '☑' ? chalk.green('☑') : chalk.dim('☐')}`);
    console.log('');
  }
}

/**
 * `bizar heads-up check` — exit 0 if clear, 1 if blockers.
 * Used by update/publish flows as a pre-flight gate.
 */
async function checkHeadsUps(bizarDir) {
  const content = readPrePushNotes(bizarDir);
  if (!content) {
    // No file = no pre-push notes = clear
    return { ok: true, blockerCount: 0, warningCount: 0, entries: [] };
  }

  const entries = parseActiveEntries(content);
  const blockers = entries.filter((e) => e.severity === 'blocker');
  const warnings = entries.filter((e) => e.severity === 'warning');

  if (blockers.length > 0) {
    console.error(chalk.bold.red(`\n  ✗ ${blockers.length} blocker(s) in active heads-ups:\n`));
    for (const b of blockers) {
      console.error(chalk.red(`    • ${b.title}`));
      if (b.description) console.error(chalk.dim(`      ${b.description}`));
      if (b.mitigation)  console.error(chalk.cyan(`      Fix: ${b.mitigation}`));
      console.error('');
    }
  }
  if (warnings.length > 0) {
    console.error(chalk.yellow(`\n  ⚠ ${warnings.length} warning(s) in active heads-ups:\n`));
    for (const w of warnings) {
      console.error(chalk.yellow(`    • ${w.title}`));
      if (w.description) console.error(chalk.dim(`      ${w.description}`));
      console.error('');
    }
  }

  return {
    ok: blockers.length === 0,
    blockerCount: blockers.length,
    warningCount: warnings.length,
    entries,
  };
}

/**
 * `bizar heads-up archive` — move all active entries to the Resolved section.
 */
async function archiveHeadsUps(bizarDir) {
  const file = join(bizarDir, 'PRE_PUSH_NOTES.md');
  const content = readPrePushNotes(bizarDir);
  if (!content) {
    console.log(chalk.yellow('  No .bizar/PRE_PUSH_NOTES.md found. Nothing to archive.'));
    return;
  }

  const entries = parseActiveEntries(content);
  if (entries.length === 0) {
    console.log(chalk.dim('  No active entries to archive.'));
    return;
  }

  // Build resolved entries block (with indented detail lines for readability)
  const today = new Date().toISOString().slice(0, 10);
  const newResolvedEntries = entries
    .map((e) => {
      const lines = e.lines.split('\n');
      const header = lines[0];
      const body = lines.slice(1).map((l) => `  ${l}`).join('\n');
      return `${header}\n${body}`;
    })
    .join('\n\n');

  // Clean the Active section — strip entries, keep header + comment
  const cleanActive = '## Active heads-ups\n\n<!--\n  Entries archived. See "Resolved" below.\n-->\n';

  let newContent;

  // Check if a "## Resolved" section already exists
  const resolvedMatch = content.match(/## Resolved[\s\S]*$/);
  if (resolvedMatch) {
    // Remove active entries from the Active section
    newContent = content.replace(/## Active heads-ups[\s\S]*?(?=\n## Resolved|$)/, cleanActive);

    // Prepend new resolved entries into the existing Resolved section,
    // right after the header (first line "## Resolved").
    const oldResolved = resolvedMatch[0];
    const firstNewlineAfterHeader = oldResolved.indexOf('\n');
    const prefix = oldResolved.slice(0, firstNewlineAfterHeader + 1); // "## Resolved\n"
    const suffix = oldResolved.slice(firstNewlineAfterHeader + 1);    // everything after

    const updatedResolved = `${prefix}<!-- Resolved on ${today} -->\n\n${newResolvedEntries}\n\n${suffix.trimStart()}\n`;

    newContent = newContent.replace(resolvedMatch[0], updatedResolved);
  } else {
    // No existing Resolved section — replace Active section and append Resolved
    newContent = content.replace(/## Active heads-ups[\s\S]*?(?=\n## |$)/, cleanActive);
    const resolvedSection = `## Resolved\n\n<!-- Resolved on ${today} -->\n\n${newResolvedEntries}\n`;
    newContent = `${newContent.trim()}\n\n${resolvedSection}\n`;
  }

  writeFileSync(file, newContent);
  console.log(chalk.green(`  ✓ Archived ${entries.length} heads-up(s) to Resolved section.`));
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

function showHeadsUpHelp() {
  console.log(`
  bizar heads-up — Manage pre-push / pre-release heads-ups

  Usage:
    bizar heads-up list       Show active heads-up entries
    bizar heads-up check      Exit 0 if no blockers, 1 if blockers exist
    bizar heads-up archive    Move all active entries to Resolved

  Description:
    Reads .bizar/PRE_PUSH_NOTES.md in the current (or nearest parent)
    project. The file is created automatically by \`bizar init\`.

    Add entries as agent-discovered gotchas before pushing or publishing.
    The \`check\` subcommand is invoked automatically by \`bizar update\`
    to gate pushes when unresolved blockers exist.
  `);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runHeadsUp(sub, args = []) {
  const bizarDir = findBizarDir(process.cwd());

  if (!sub || sub === '--help' || sub === '-h') {
    showHeadsUpHelp();
    return;
  }

  if (!bizarDir) {
    console.log(chalk.yellow('  No .bizar/ directory found in this project.'));
    console.log(chalk.dim('  Run `bizar init` to create one.'));
    process.exit(1);
  }

  if (sub === 'list') {
    await listHeadsUps(bizarDir);
  } else if (sub === 'check') {
    const result = await checkHeadsUps(bizarDir);
    if (!result.ok) process.exit(1);
    console.log(chalk.green('  ✓ No active blocker heads-ups.'));
  } else if (sub === 'archive') {
    await archiveHeadsUps(bizarDir);
  } else {
    console.error(chalk.red(`  ✗ Unknown heads-up subcommand: ${sub}`));
    showHeadsUpHelp();
    process.exit(1);
  }
}

// Also export utilities so update.mjs and other commands can import them
export { checkHeadsUps, parseActiveEntries, findBizarDir, readPrePushNotes };
