/**
 * src/server/yaml.mjs
 *
 * Hand-rolled line-oriented YAML parser for Markdown frontmatter.
 * Supports a safe subset of YAML: scalars (strings, integers, floats,
 * booleans, dates), inline lists, block lists, comments, and multi-line
 * literal blocks. No external dependencies.
 */

/**
 * Parse a frontmatter block (the text between the opening `---` and
 * closing `---`). Returns { frontmatter: object, body: string }.
 *
 * @param {string} raw — raw file contents
 * @returns {{ frontmatter: Record<string, unknown>, body: string }}
 */
export function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { frontmatter: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { frontmatter: {}, body: raw };
  const fmBlock = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\n+/, '');
  const frontmatter = parseBlock(fmBlock);
  return { frontmatter, body };
}

/**
 * Serialize a frontmatter object to a YAML string (without the surrounding
 * `---` fences). Used to build the frontmatter portion of a markdown file.
 *
 * @param {Record<string, unknown>} fm
 * @returns {string}
 */
export function serializeFrontmatter(fm) {
  return serializeBlock(fm);
}

/**
 * Parse a single YAML block string (no document markers). Returns a plain
 * object of parsed key-value pairs.
 *
 * @param {string} text — raw YAML block (no --- delimiters)
 * @returns {Record<string, unknown>}
 */
export function parseBlock(text) {
  const result = {};
  if (!text) return result;

  // Strip comments (lines that are ONLY a comment)
  const lines = text.split('\n').filter((l) => !/^\s*#/.test(l));

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Blank / empty line
    if (/^\s*$/.test(line)) { i++; continue; }

    // Inline list: `key: [a, b, c]`
    const inlineListMatch = line.match(/^([A-Za-z0-9_-]+)\s*:\s*\[(.*?)\]\s*$/);
    if (inlineListMatch) {
      result[inlineListMatch[1]] = inlineListMatch[2]
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
      i++;
      continue;
    }

    // Block list key start: `key:`
    const blockListKeyMatch = line.match(/^([A-Za-z0-9_-]+)\s*:\s*$/);
    if (blockListKeyMatch) {
      const key = blockListKeyMatch[1];
      const items = [];
      i++;
      while (i < lines.length && /^\s+-\s*/.test(lines[i])) {
        const item = lines[i].replace(/^\s+-\s*/, '').trim();
        items.push(item);
        i++;
      }
      result[key] = items;
      continue;
    }

    // Multi-line literal block scalar: `body: |` or `body: |+` or `body: |-`
    const literalMatch = line.match(/^([A-Za-z0-9_-]+)\s*:\s*\|[+-]?\s*$/);
    if (literalMatch) {
      const key = literalMatch[1];
      const lines2 = [];
      i++;
      // First content line determines the common indent to strip
      let firstContentIdx = i;
      let baseIndent = null;
      while (i < lines.length) {
        const l = lines[i];
        if (l === undefined) break;
        // Stop at the next top-level key (no indent)
        if (/^[A-Za-z0-9_-]+\s*:/.test(l) && !l.startsWith(' ')) break;
        if (l.trim() === '') { lines2.push(''); i++; continue; }
        if (baseIndent === null && l.trim() !== '') {
          baseIndent = l.match(/^(\s*)/)[1].length;
        }
        if (baseIndent !== null) {
          const stripped = l.length > baseIndent ? l.slice(baseIndent) : l;
          lines2.push(stripped);
        } else {
          lines2.push(l);
        }
        i++;
      }
      result[key] = lines2.join('\n');
      continue;
    }

    // Regular key-value: `key: value`
    const kvMatch = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const rawVal = kvMatch[2].trim();
      result[key] = parseScalar(rawVal);
      i++;
      continue;
    }

    // Continuation of a multi-line value (indented, no key)
    // Only handle bare continuation lines (simple unquoted strings)
    if (/^\s+\S/.test(line) && !/^\s+-\s*/.test(line)) {
      // Fold continuation as part of last array item or string
      const lastKey = Object.keys(result).at(-1);
      if (lastKey !== undefined) {
        const lastVal = result[lastKey];
        if (typeof lastVal === 'string') {
          result[lastKey] = lastVal + '\n' + line.trim();
        }
      }
      i++;
      continue;
    }

    // Unknown line — skip
    i++;
  }

  return result;
}

/**
 * Serialize a plain object to a YAML block string (no --- markers).
 *
 * @param {Record<string, unknown>} obj
 * @returns {string}
 */
export function serializeBlock(obj) {
  const lines = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
      } else if (v.every((item) => typeof item === 'string' && !item.includes('\n') && !item.includes(',') && !item.includes('[') && !item.includes(']'))) {
        // Inline list
        lines.push(`${k}: [${v.map((item) => scalarToString(item)).join(', ')}]`);
      } else {
        // Block list
        lines.push(`${k}:`);
        for (const item of v) {
          lines.push(`  - ${item}`);
        }
      }
    } else if (typeof v === 'object') {
      // Nested object — skip (not supported in frontmatter)
      continue;
    } else if (typeof v === 'string' && (v.includes('\n') || v.length > 80)) {
      // Multi-line literal block
      const escaped = v.replace(/\n$/, '') + '\n';
      lines.push(`${k}: |`);
      for (const ln of escaped.split('\n')) {
        lines.push(`  ${ln}`);
      }
    } else {
      lines.push(`${k}: ${scalarToString(v)}`);
    }
  }
  return lines.join('\n');
}

/**
 * Parse a scalar value string into a native JS value.
 *
 * @param {string} s
 * @returns {unknown}
 */
function parseScalar(s) {
  // Quoted strings
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }

  // Boolean
  if (s === 'true' || s === 'yes') return true;
  if (s === 'false' || s === 'no') return false;

  // Null
  if (s === 'null' || s === '~') return null;

  // Integer
  if (/^-?[0-9]+$/.test(s)) return parseInt(s, 10);

  // Float
  if (/^-?[0-9]+\.[0-9]+$/.test(s)) return parseFloat(s);

  // ISO-8601 date — keep as string
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?(Z|[+-]\d{2}:\d{2})?)?$/.test(s)) {
    return s;
  }

  return s;
}

/**
 * Convert a JS value to a YAML scalar string.
 *
 * @param {unknown} v
 * @returns {string}
 */
function scalarToString(v) {
  if (typeof v === 'string') {
    if (v.includes(':') || v.includes('#') || v.includes('"') || v.includes("'") || /^\s/.test(v) || /\s$/.test(v)) {
      return `"${v.replace(/"/g, '\\"')}"`;
    }
    return v;
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return String(v);
  if (v === null || v === undefined) return 'null';
  return String(v);
}
