/**
 * src/server/progress-parser.mjs
 *
 * Sprint S10 — Parse `.bizar/PROGRESS.md` into a structured goal list
 * for the v8 dashboard.
 *
 * Goals are the `## F-NNN — Title` (or `## Some — Title`) headings.
 * Each goal's status is parsed from the first paragraph:
 *   "Goal is **on-track**" / "**at-risk**" / "**done**" / "**blocked**"
 * Key results are `- [ ] text` / `- [x] text` lines inside the goal block.
 * `Owner:` / `Due:` lines are extracted from the goal header lines.
 *
 * Pure: no I/O. Callers pass the raw text in. Deterministic.
 *
 * Reuses none — there is no existing goal state in the dashboard.
 */

const STATUS_VALUES = new Set([
  'on-track',
  'at-risk',
  'off-track',
  'done',
  'blocked',
  'active',
]);

/**
 * Parse raw PROGRESS.md content into a structured goal list.
 *
 * @param {string} text  raw file content
 * @returns {{
 *   goals: Array<{
 *     id: string,
 *     title: string,
 *     status: string,
 *     description: string,
 *     progress: number,
 *     keyResults: Array<{ id: string, title: string, done: boolean, assignee?: string }>,
 *     due?: string,
 *     owner?: string,
 *     section: 'in-progress' | 'next' | 'recent' | 'backlog' | 'unknown'
 *   }>,
 *   preamble: string,
 *   postamble: string
 * }}
 */
export function parseProgress(text) {
  if (typeof text !== 'string' || !text) {
    return { goals: [], preamble: '', postamble: '' };
  }
  const lines = text.split(/\r?\n/);
  /** @type {ReturnType<typeof parseProgress>['goals']} */
  const goals = [];
  let preamble = '';
  let current = null;
  let currentSection = 'unknown';
  let postambleStart = -1;

  function pushCurrent() {
    if (current) {
      // finalise: derive progress from KRs
      const done = current.keyResults.filter((kr) => kr.done).length;
      current.progress = current.keyResults.length > 0
        ? done / current.keyResults.length
        : current.progress || 0;
      current.section = currentSection;
      goals.push(current);
      current = null;
    }
  }

  let i = 0;
  // preamble — everything before the first `## ` heading.
  while (i < lines.length && !lines[i].startsWith('## ')) {
    preamble += lines[i] + '\n';
    i += 1;
  }
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      pushCurrent();
      const headerText = line.slice(3).trim();
      const { id, title } = parseHeader(headerText);
      current = {
        id,
        title,
        status: 'on-track',
        description: '',
        progress: 0,
        keyResults: [],
        section: currentSection,
      };
      currentSection = inferSection(text, i, headerText);
      i += 1;
      continue;
    }
    if (!current) {
      // Lines between sections — accumulate into preamble/postamble.
      if (goals.length === 0) preamble += line + '\n';
      else { postambleStart = postambleStart === -1 ? i : postambleStart; }
      i += 1;
      continue;
    }
    // Body lines under the current goal.
    const kr = parseKeyResultLine(line);
    if (kr) {
      current.keyResults.push({ id: `kr-${current.id}-${current.keyResults.length + 1}`, ...kr });
      i += 1;
      continue;
    }
    const ownerMatch = /^owner:\s*([^\n]+)/i.exec(line);
    if (ownerMatch) {
      current.owner = ownerMatch[1].trim();
      i += 1;
      continue;
    }
    const dueMatch = /\bdue\s*:?\s*([^\n,;]+)/i.exec(line);
    if (dueMatch && !current.due) {
      current.due = dueMatch[1].trim();
    }
    const statusMatch = /\*\*\s*(on-track|at-risk|off-track|done|blocked|active)\s*\*\*/i.exec(line);
    if (statusMatch && current.status === 'on-track') {
      current.status = statusMatch[1].toLowerCase();
    }
    const pctMatch = /(\d{1,3})\s*%/.exec(line);
    if (pctMatch && current.progress === 0) {
      const pct = Math.max(0, Math.min(100, parseInt(pctMatch[1], 10)));
      current.progress = pct / 100;
    }
    if (line.trim()) current.description = appendLine(current.description, line);
    i += 1;
  }
  pushCurrent();

  const postamble = postambleStart === -1 ? '' : lines.slice(postambleStart).join('\n');
  return { goals, preamble: preamble.trimEnd() + '\n', postamble };
}

/**
 * Parse the header text — `"F-052 — Title"`, `"Some title"`, or
 * `"## Title with — em-dash"`. Returns a stable id derived from the
 * header (or a slug fallback).
 */
function parseHeader(headerText) {
  const m = /^([A-Za-z0-9_-]+)\s*[—\-]\s*(.+)$/.exec(headerText);
  if (m) return { id: m[1], title: m[2].trim() };
  const id = slugify(headerText);
  return { id, title: headerText };
}

function slugify(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'goal';
}

function inferSection(fullText, headerIndex, headerText) {
  // Look back for a section divider (`### In Progress`, etc.).
  const before = fullText.slice(0, fullText.indexOf(headerText));
  if (/In Progress/i.test(before.slice(-200))) return 'in-progress';
  if (/Next Steps?/i.test(before.slice(-200))) return 'next';
  if (/Recent/i.test(before.slice(-200))) return 'recent';
  if (/Backlog|Blockers/i.test(before.slice(-200))) return 'backlog';
  return 'unknown';
}

function parseKeyResultLine(line) {
  const m = /^\s*-\s+\[(x|X| )\]\s+(.+)$/.exec(line);
  if (!m) return null;
  const done = m[1].toLowerCase() === 'x';
  const rest = m[2].trim();
  const assignee = /\(@([a-z0-9_-]+)\)\s*$/.exec(rest);
  return {
    title: assignee ? rest.slice(0, assignee.index).trim() : rest,
    done,
    assignee: assignee ? assignee[1] : undefined,
  };
}

function appendLine(current, line) {
  if (!current) return line.trim();
  return current + '\n' + line.trim();
}

/**
 * Serialise a goal list back to PROGRESS.md-shaped text. Preserves the
 * preamble and postamble so non-goal sections (Current State, etc.)
 * aren't clobbered.
 *
 * @param {ReturnType<typeof parseProgress>} parsed
 * @returns {string}
 */
export function serializeProgress(parsed) {
  const out = [];
  if (parsed.preamble) out.push(parsed.preamble.trimEnd());
  for (const goal of parsed.goals) {
    out.push(`## ${goal.id} — ${goal.title}`);
    if (goal.owner || goal.due) {
      const meta = [];
      if (goal.owner) meta.push(`Owner: ${goal.owner}`);
      if (goal.due) meta.push(`Due: ${goal.due}`);
      out.push(meta.join(' · '));
    }
    out.push(`Goal is **${goal.status}**.`);
    if (goal.description) out.push(goal.description);
    if (goal.keyResults.length) {
      out.push('Key results:');
      for (const kr of goal.keyResults) {
        const assignee = kr.assignee ? ` (@${kr.assignee})` : '';
        out.push(`- [${kr.done ? 'x' : ' '}] ${kr.title}${assignee}`);
      }
    }
    out.push('');
  }
  if (parsed.postamble) out.push(parsed.postamble.trimEnd());
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export const _internals = { STATUS_VALUES };