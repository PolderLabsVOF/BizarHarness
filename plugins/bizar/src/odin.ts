/**
 * plugins/bizar/src/odin.ts
 *
 * v6.0.0 — Odin orchestrator module.
 *
 * Odin is the top-level user-facing agent in the Bizar Norse pantheon. It
 * receives a user prompt, decomposes it into 2–6 subtasks, and dispatches
 * them to teammates via the existing `bizar_spawn_team` tool.
 *
 * Decomposition is rule-based for v1 — pattern matches on task keywords
 * to suggest a team composition (researcher + implementer + reviewer, etc.).
 * v2 can replace this with an LLM-driven decomposer.
 *
 * Public API:
 *   decomposeTask(task) -> { subtasks[], roles[], estimatedAgents }
 *   buildOdinPrompt(task, decomposition) -> string
 */

export interface OdinSubtask {
  /** Short verb-led action description (e.g. "research auth libraries"). */
  title: string;
  /** Detailed prompt for the subtask agent. */
  prompt: string;
  /** Suggested agent role (odin, mimir, thor, heimdall, vidarr, forseti). */
  role: string;
  /** If true, this subtask blocks downstream subtasks. */
  blocking?: boolean;
}

export interface OdinDecomposition {
  subtasks: OdinSubtask[];
  /** Total agent count (lead + subtask teammates). */
  estimatedAgents: number;
  /** Reasoning summary for the decomposition. */
  rationale: string;
}

interface RoleTemplate {
  role: string;
  keywords: RegExp[];
  description: string;
}

const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    role: "mimir",
    keywords: [/\bresearch\b/i, /\binvestigate\b/i, /\bexplore\b/i, /\bsurvey\b/i, /\banalyze\b/i, /\bunderstand\b/i, /\bdocs?\b/i],
    description: "Research & knowledge synthesis",
  },
  {
    role: "heimdall",
    keywords: [/\bquick\b/i, /\bsimple\b/i, /\bsmall\b/i, /\btweak\b/i, /\bfix\b/i, /\btypo\b/i, /\brename\b/i],
    description: "Small mechanical changes",
  },
  {
    role: "thor",
    keywords: [/\bimplement\b/i, /\bbuild\b/i, /\bcode\b/i, /\bfunction\b/i, /\bclass\b/i, /\bapi\b/i, /\bservice\b/i, /\bfeature\b/i],
    description: "Implementation & coding",
  },
  {
    role: "forseti",
    keywords: [/\btest\b/i, /\bverify\b/i, /\bvalidate\b/i, /\bspec\b/i, /\bcoverage\b/i, /\bassert/i, /\bcheck\b/i],
    description: "Verification & testing",
  },
  {
    role: "vidarr",
    keywords: [/\brefactor\b/i, /\barchitect\b/i, /\bdesign\b/i, /\bbig\b/i, /\bsystem\b/i, /\bcross.cutting\b/i, /\bperformance\b/i, /\bscale\b/i],
    description: "Architecture & deep refactors",
  },
  {
    role: "tyr",
    keywords: [/\bdebug\b/i, /\bbug\b/i, /\bfix\b/i, /\binvestigate\b/i, /\broot cause\b/i],
    description: "Hardest debugging tasks",
  },
  {
    role: "frigg",
    keywords: [/\bdocument\b/i, /\bwrite up\b/i, /\bREADME\b/i, /\bcomment\b/i, /\bguide\b/i],
    description: "Documentation",
  },
  {
    role: "baldr",
    keywords: [/\bui\b/i, /\bdesign\b/i, /\bvisual\b/i, /\bstyle\b/i, /\bcss\b/i, /\banimation\b/i, /\bux\b/i, /\bfrontend\b/i],
    description: "Frontend & UI work",
  },
];

const DEFAULT_MAX_SUBTASKS = 4;
const MIN_SUBTASKS = 2;

/**
 * Heuristic sentence splitter — splits on `. `, `! `, `? `, `\n`, or `; `.
 * Filters out sentences shorter than 8 chars.
 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n|;\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
}

/**
 * Pick the best role for a sentence based on keyword matches.
 */
function pickRole(sentence: string): string {
  let bestRole = "thor";
  let bestScore = 0;
  for (const t of ROLE_TEMPLATES) {
    let score = 0;
    for (const re of t.keywords) {
      const m = sentence.match(re);
      if (m) score += m[0].length;
    }
    if (score > bestScore) {
      bestScore = score;
      bestRole = t.role;
    }
  }
  return bestRole;
}

/**
 * Decompose a user task into 2-6 subtasks with assigned roles.
 */
export function decomposeTask(task: string, maxSubtasks: number = DEFAULT_MAX_SUBTASKS): OdinDecomposition {
  const trimmed = task.trim();
  if (!trimmed) {
    return { subtasks: [], estimatedAgents: 0, rationale: "Empty task." };
  }

  let sentences = splitSentences(trimmed);

  // Special case: split on " and " / " then " if it gives us enough parts.
  if (sentences.length < MIN_SUBTASKS) {
    const lower = trimmed.toLowerCase();
    const hasAnd = /\b and \b/i.test(lower) || /,\s*and\b/i.test(lower);
    const hasThen = /\b then \b/i.test(lower);
    if (hasAnd || hasThen) {
      const parts = trimmed.split(/\b(?:and|then)\b/i).map((s) => s.trim()).filter(Boolean);
      if (parts.length >= MIN_SUBTASKS) sentences = parts;
    }
  }

  // Too few → default 2-step plan.
  if (sentences.length < MIN_SUBTASKS) {
    return {
      subtasks: [
        {
          title: "Research the problem space",
          prompt: `Research the following task and report back with findings + a recommended approach:\n\n${trimmed}`,
          role: "mimir",
          blocking: true,
        },
        {
          title: "Implement the solution",
          prompt: `Given the research findings above, implement the requested change:\n\n${trimmed}\n\nApply coding conventions from the existing codebase.`,
          role: "thor",
        },
      ],
      estimatedAgents: 3,
      rationale: "Single-sentence task — defaulted to research + implement.",
    };
  }

  // Too many → cap at maxSubtasks by merging adjacent same-role sentences.
  if (sentences.length > maxSubtasks) {
    const grouped: { role: string; sentences: string[] }[] = [];
    for (const s of sentences) {
      const role = pickRole(s);
      const last = grouped[grouped.length - 1];
      // Merge into the previous group if same role AND we're already at/over
      // the half-way mark (so we don't waste group slots on adjacent same-role
      // pairs early — only consolidate once we have headroom pressure).
      if (last && last.role === role && grouped.length >= Math.ceil(maxSubtasks / 2)) {
        last.sentences.push(s);
      } else {
        grouped.push({ role, sentences: [s] });
      }
    }
    while (grouped.length > maxSubtasks) {
      const dropIdx = Math.floor(grouped.length / 2);
      grouped.splice(dropIdx, 1);
    }
    sentences = grouped.map((g) => `${g.sentences.join(" ")}`);
  }

  const subtasks: OdinSubtask[] = sentences.map((s, i) => {
    const role = pickRole(s);
    return {
      title: s.length > 60 ? `${s.slice(0, 57)}…` : s,
      prompt: `${s}\n\nThis is subtask ${i + 1} of ${sentences.length} of the larger task: ${trimmed}`,
      role,
      blocking: i === 0,
    };
  });

  return {
    subtasks,
    estimatedAgents: subtasks.length + 1,
    rationale: `Decomposed into ${subtasks.length} subtasks. Roles: ${subtasks.map((s) => s.role).join(", ")}.`,
  };
}

/**
 * Build the Odin system prompt for the spawn_team tool call.
 */
export function buildOdinPrompt(task: string, decomposition: OdinDecomposition): string {
  const lines: string[] = [
    "You are Odin, the lead agent of a Bizar agent team.",
    "",
    `## Mission`,
    task,
    "",
    `## Subtasks`,
    ...decomposition.subtasks.map(
      (s, i) => `${i + 1}. **${s.title}** (${s.role}${s.blocking ? ", blocking" : ""})\n   ${s.prompt}`,
    ),
    "",
    `## Coordination`,
    "- Coordinate via TeamSendMessage.",
    "- Wait for blocking subtasks before dispatching downstream ones.",
    "- Aggregate results into a final report when all subtasks complete.",
    "",
    `## Rationale`,
    decomposition.rationale,
  ];
  return lines.join("\n");
}