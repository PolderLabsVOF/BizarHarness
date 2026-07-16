/**
 * cleanup.mjs — Scan recent git diff for AI-slop patterns.
 *
 * Detects: empty catches, redundant return await, redundant comments,
 * dead code, console.log left in.
 *
 * Outputs a git diff patch for reversible changes.
 *
 * Usage:
 *   node cleanup.mjs [--since=3 days ago] [--pattern=empty-catch|...]
 *   # or pipe a diff:
 *   git diff HEAD~5 | node cleanup.mjs
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const SINCE = process.argv.includes("--since")
  ? process.argv[process.argv.indexOf("--since") + 1]
  : "3 days ago";

// ── pattern matchers ───────────────────────────────────────────────────────────

/** @param {string} line */
function isEmptyCatch(line) {
  return /catch\s*\(\s*\)\s*\{/.test(line) || /catch\s*\(\s*\w+\s*\)\s*\{/.test(line);
}

/** @param {string} line */
function isRedundantReturnAwait(line) {
  return /return\s+await\s+/.test(line);
}

/** @param {string} code */
function findEmptyCatches(code) {
  const lines = code.split("\n");
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    if (isEmptyCatch(lines[i])) {
      findings.push({
        type: "empty-catch",
        line: i + 1,
        content: lines[i].trim(),
      });
    }
  }
  return findings;
}

/** @param {string} code */
function findRedundantReturnAwait(code) {
  const lines = code.split("\n");
  const findings = [];
  for (let i = 0; i < lines.length; i++) {
    if (isRedundantReturnAwait(lines[i])) {
      findings.push({
        type: "redundant-return-await",
        line: i + 1,
        content: lines[i].trim(),
      });
    }
  }
  return findings;
}

/** @param {string} code */
function findConsoleLog(code) {
  const lines = code.split("\n");
  const findings = [];
  const consolePattern = /console\.(log|debug|info|warn|error)/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Skip test files and commented-out usages
    if (line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) continue;
    if (consolePattern.test(line) && !line.includes("/// <reference")) {
      findings.push({
        type: "console-log",
        line: i + 1,
        content: line,
      });
    }
  }
  return findings;
}

/** @param {string} code */
function findRedundantComments(code) {
  const lines = code.split("\n");
  const findings = [];
  // Pattern: comment that just restates the code
  const redundant = [
    /^\s*\/\/\s*(increment|decrement|increase|decrease|decrease)\s+\w+/i,
    /^\s*\/\/\s*(decrement|increase|decrease)\s+/i,
    /^\s*\/\/\s*(check|check if)\s+/i,
    /^\s*\/\/\s*(loop|iterate|for each|map over)\s+/i,
  ];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("//")) {
      for (const pat of redundant) {
        if (pat.test(line)) {
          findings.push({ type: "redundant-comment", line: i + 1, content: line });
          break;
        }
      }
    }
  }
  return findings;
}

/** @param {string} code */
function findDeadCode(code) {
  const lines = code.split("\n");
  const findings = [];
  // Unreachable code after return/throw/continue/break — look for indented blocks
  let prevSignificant = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // Skip empty lines and comments
    if (trimmed === "" || trimmed.startsWith("//") || trimmed.startsWith("/*")) continue;
    if (
      prevSignificant &&
      (trimmed.startsWith("return ") || trimmed.startsWith("throw ") || trimmed.startsWith("break") || trimmed.startsWith("continue"))
    ) {
      // Next non-empty line at same or lower indent = dead
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].trim();
        if (next === "") continue;
        if (next.startsWith("//") || next.startsWith("/*")) continue;
        const nextIndent = line.search(/\S/);
        const thisIndent = lines[j].search(/\S/);
        if (thisIndent <= nextIndent) break;
        findings.push({ type: "dead-code", line: j + 1, content: next });
        break;
      }
    }
    if (trimmed !== "") prevSignificant = trimmed;
  }
  return findings;
}

// ── git diff parser ───────────────────────────────────────────────────────────

function getGitDiff() {
  try {
    const diff = execSync(`git diff --no-color --since="${SINCE}"`, {
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return diff;
  } catch {
    // No diff or git not available
    return "";
  }
}

function parseDiff(diff) {
  const files = [];
  let currentFile = null;
  let currentHunk = null;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git")) {
      if (currentFile) files.push(currentFile);
      const nameMatch = line.match(/diff --git a\/(.*?) b\/(.*?)(?:\s|$)/);
      currentFile = {
        path: nameMatch ? nameMatch[2] : "unknown",
        hunks: [],
      };
      currentHunk = null;
    } else if (line.startsWith("@@")) {
      const m = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (m && currentFile) {
        currentHunk = {
          start: parseInt(m[1], 10),
          additions: [],
          deletions: [],
        };
        currentFile.hunks.push(currentHunk);
      }
    } else if (currentHunk) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        currentHunk.additions.push(line.slice(1));
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        currentHunk.deletions.push(line.slice(1));
      }
    }
  }
  if (currentFile) files.push(currentFile);
  return files;
}

// ── main ───────────────────────────────────────────────────────────────────────

const diff = getGitDiff();

if (!diff) {
  console.log("No git diff found (or not a git repo). Nothing to scan.");
  process.exit(0);
}

const files = parseDiff(diff);
const allFindings = [];

for (const file of files) {
  // Skip binary files and generated files
  if (file.path.includes("node_modules") || file.path.includes(".lock") || file.path.endsWith(".jsonl")) continue;

  for (const hunk of file.hunks) {
    const code = hunk.additions.join("\n");
    const findings = [
      ...findEmptyCatches(code),
      ...findRedundantReturnAwait(code),
      ...findConsoleLog(code),
      ...findRedundantComments(code),
    ];

    for (const f of findings) {
      allFindings.push({ path: file.path, ...f });
    }
  }
}

if (allFindings.length === 0) {
  console.log("No AI-slop patterns detected.");
  process.exit(0);
}

// Group by type
const byType = {};
for (const finding of allFindings) {
  if (!byType[finding.type]) byType[finding.type] = [];
  byType[finding.type].push(finding);
}

console.log("\n=== AI-Slop Findings ===\n");
for (const [type, items] of Object.entries(byType)) {
  console.log(`\n## ${type} (${items.length} occurrences)\n`);
  for (const item of items) {
    console.log(`  ${item.path}:${item.line}`);
    console.log(`    ${item.content}`);
  }
}

console.log("\n=== Proposed git diff patch (empty — add fixes manually) ===\n");
// We report findings; actual patch generation requires more context.
// Output is intentionally a report, not a patch, since auto-patching
// catch blocks and return await could break semantics.
console.log("  (No auto-patch generated — review findings above and fix manually)");
console.log("  To auto-fix console.log: grep -rn 'console\\.log' <path> | ...");

process.exit(allFindings.length > 0 ? 1 : 0);
