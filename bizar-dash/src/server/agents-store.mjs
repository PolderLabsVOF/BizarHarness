/**
 * src/server/agents-store.mjs
 *
 * v3.0.0 — Editable agents.
 *
 * Each agent is a markdown file with frontmatter at:
 *   ~/.config/opencode/agents/<name>.md
 *
 * The store reads / writes these files. The format is:
 *   ---
 *   description: ...
 *   model: ...
 *   mode: ...
 *   color: ...
 *   tools: ["bash","read","edit"]
 *   permissions: {...}
 *   ---
 *   <prompt body>
 */
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const AGENTS_DIR = join(HOME, '.config', 'opencode', 'agents');

function safeReadText(file, fallback = '') {
  try {
    if (!existsSync(file)) return fallback;
    return readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { frontmatter: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: raw };
  const fmBlock = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\s+/, '');
  const frontmatter = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    frontmatter[key] = val;
  }
  return { frontmatter, body };
}

/** Serialize a frontmatter key — string is bare, value with special chars gets quoted. */
function fmVal(v) {
  if (typeof v !== 'string') return JSON.stringify(v);
  if (v === '') return '""';
  if (/[:#\-?{}[\],&*!|>'"%@`]/.test(v) || v.includes(' ')) {
    return JSON.stringify(v);
  }
  return v;
}

function serializeFrontmatter(fm) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fm)) {
    if (v == null) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map((x) => (typeof x === 'string' ? JSON.stringify(x) : x)).join(', ')}]`);
    } else if (typeof v === 'object') {
      lines.push(`${k}:`);
      for (const [k2, v2] of Object.entries(v)) {
        lines.push(`  ${k2}: ${fmVal(String(v2))}`);
      }
    } else {
      lines.push(`${k}: ${fmVal(String(v))}`);
    }
  }
  lines.push('---');
  return lines.join('\n') + '\n';
}

function readAgent(name) {
  const file = join(AGENTS_DIR, `${name}.md`);
  if (!existsSync(file)) return null;
  const raw = safeReadText(file);
  const { frontmatter, body } = parseFrontmatter(raw);
  const st = statSync(file);
  return {
    name,
    description: frontmatter.description || '',
    model: frontmatter.model || '',
    mode: frontmatter.mode || 'subagent',
    color: frontmatter.color || '',
    tools: typeof frontmatter.tools === 'string'
      ? frontmatter.tools.split(',').map((s) => s.trim()).filter(Boolean)
      : Array.isArray(frontmatter.tools) ? frontmatter.tools : [],
    permissions: frontmatter.permissions || null,
    prompt: body.trim(),
    file,
    path: file,
    mtime: st.mtimeMs,
  };
}

export const agentsStore = {
  AGENTS_DIR,

  ensure() {
    mkdirSync(AGENTS_DIR, { recursive: true });
  },

  list() {
    this.ensure();
    const out = [];
    for (const f of readdirSync(AGENTS_DIR)) {
      if (!f.endsWith('.md')) continue;
      const name = basename(f, '.md');
      const agent = readAgent(name);
      if (agent) out.push(agent);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  },

  get(name) {
    return readAgent(name);
  },

  create(input) {
    if (!input || typeof input !== 'object') throw new Error('agent input required');
    if (!input.name || !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(input.name)) {
      throw new Error('invalid agent name');
    }
    const file = join(AGENTS_DIR, `${input.name}.md`);
    if (existsSync(file)) {
      throw new Error(`agent "${input.name}" already exists`);
    }
    const data = {
      name: input.name,
      description: input.description || '',
      model: input.model || '',
      mode: input.mode || 'subagent',
      color: input.color || '',
      tools: Array.isArray(input.tools) ? input.tools : [],
      permissions: input.permissions || null,
      prompt: input.prompt || '',
    };
    this.ensure();
    writeFileSync(file, serializeFrontmatter(data) + '\n' + data.prompt, 'utf8');
    return readAgent(input.name);
  },

  update(name, patch) {
    if (!patch || typeof patch !== 'object') throw new Error('agent patch required');
    const cur = readAgent(name);
    if (!cur) throw new Error(`agent "${name}" not found`);
    const data = {
      description: patch.description ?? cur.description,
      model: patch.model ?? cur.model,
      mode: patch.mode ?? cur.mode,
      color: patch.color ?? cur.color,
      tools: Array.isArray(patch.tools) ? patch.tools : cur.tools,
      permissions: patch.permissions ?? cur.permissions,
      prompt: patch.prompt ?? cur.prompt,
    };
    writeFileSync(cur.file, serializeFrontmatter(data) + '\n' + data.prompt, 'utf8');
    return readAgent(name);
  },

  delete(name) {
    const file = join(AGENTS_DIR, `${name}.md`);
    if (!existsSync(file)) return false;
    unlinkSync(file);
    return true;
  },
};
