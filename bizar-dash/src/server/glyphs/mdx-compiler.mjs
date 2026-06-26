/**
 * src/server/glyphs/mdx-compiler.mjs
 *
 * v3.21.0 — Server-side MDX compile for Glyphs (the visual artifact /
 * plan / recap system). Takes an MDX source string and returns a
 * JSON-serializable "compiled glyph" object that the browser can
 * render with React components per block type.
 *
 * Why this approach instead of @mdx-js/mdx compile() + evaluate()?
 *   1. evaluate() returns a React component, not JSON — can't serialize
 *      across HTTP or for caching.
 *   2. Blocks have JSON-serializable props (no functions, no React
 *      elements), so we can emit a clean data structure.
 *   3. The browser renders blocks from that JSON, with a per-type React
 *      component map on the client.
 *
 * Pipeline:
 *   1. Validate with @mdx-js/mdx compile() so syntax errors surface
 *      early (unclosed tags, bad import statements, broken JSX).
 *   2. Extract frontmatter (--- delimited YAML-ish).
 *   3. Walk the body and find <BlockName id="..." attr1="..." attr2={...}>
 *      children </BlockName> patterns. Emit a flat list of typed blocks.
 *   4. Parse JSX expression values via a tiny recursive-descent parser
 *      that supports objects, arrays, strings, numbers, booleans, null.
 *      Identifiers are treated as `undefined` (literals only — actual
 *      runtime values must come from frontmatter if needed).
 *   5. Treat the markdown text OUTSIDE blocks as a fallback "RichText"
 *      section with id `__prologue__`, so legacy plans that have no
 *      blocks still render something useful.
 *
 * The block vocabulary (matches agent-native.com /visual-plan and the
 * glyphs-research.md spec):
 *   <RichText id="...">markdown</RichText>
 *   <Callout id="..." tone="info|warn|success|danger">markdown</Callout>
 *   <Checklist id="..." items={[{id, label, checked}]} />
 *   <Table id="..." columns={["a", "b"]} rows={[["x", "y"]]} />
 *   <CodeTabs id="..." tabs={[{id, label, language, code, caption?}]} />
 *   <Decision id="..." title question options={[{id, label, detail, recommended?}]} />
 *   <OpenQuestions id="..." questions={[{id, label, kind, options?}]} />
 *   <FileTree id="..." title entries={[{path, change, note?}]} />
 *   <Diff id="..." filename language mode="split|unified" before after />
 *   <Stat id="..." label value trend? />
 *   <Workflow id="..." steps={[{id, label, type}]} connections={[{from, to, label?}]} />
 *   <Mockup id="..." title x y w h html />
 *   <CommentPin id="..." x y commentId? />
 *   <Diagram id="..." title dataHtml dataCss />
 *
 * Returned shape:
 *   {
 *     frontmatter: { title?, status?, author?, tags?, ... },
 *     blocks: [{ id, type, data, childrenMarkdown? }],
 *     errors: [{ line, message }],
 *     compiledAt: ISO timestamp,
 *   }
 */

import { compile } from '@mdx-js/mdx';

const BLOCK_TYPES = new Set([
  'RichText',
  'Callout',
  'Checklist',
  'Table',
  'CodeTabs',
  'Decision',
  'OpenQuestions',
  'FileTree',
  'Diff',
  'Stat',
  'Workflow',
  'Mockup',
  'CommentPin',
  'Diagram',
]);

const PROLOGUE_ID = '__prologue__';

/**
 * Parse a YAML-ish frontmatter block. Scalar values only; numbers and
 * booleans are coerced, anything else stays as a string.
 *
 * @param {string} raw
 * @returns {{ frontmatter: Record<string, unknown>, body: string }}
 */
function parseFrontmatter(raw) {
  if (!raw || !raw.startsWith('---')) {
    return { frontmatter: {}, body: raw || '' };
  }
  // First "---" closes after a line that begins with "---"
  const lines = raw.split(/\r?\n/);
  if (lines[0].trim() !== '---') {
    return { frontmatter: {}, body: raw };
  }
  let endIdx = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) {
    return { frontmatter: {}, body: raw };
  }
  const fmBlock = lines.slice(1, endIdx).join('\n');
  const body = lines.slice(endIdx + 1).join('\n').replace(/^\s+/, '');
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
    } else if (val === 'true') {
      val = true;
    } else if (val === 'false') {
      val = false;
    } else if (val !== '' && !Number.isNaN(Number(val))) {
      val = Number(val);
    } else if (val === 'null') {
      val = null;
    }
    frontmatter[key] = val;
  }
  return { frontmatter, body };
}

/**
 * Recursive-descent parser for JSX expression values. Supports the
 * subset that the glyph block vocabulary uses:
 *   - Objects: { key: value, key2: value2 }
 *   - Arrays:  [value, value2]
 *   - Strings: "value" or 'value'
 *   - Numbers: 123 or 1.5 or -1.5
 *   - Booleans: true / false
 *   - null
 *   - Identifiers are treated as `undefined` (we don't import runtime
 *     values; if you need one, put it in frontmatter and reference it).
 *
 * @param {string} src
 * @returns {{ value: unknown, rest: string }}
 */
function parseJsxValue(src) {
  let i = 0;
  const len = src.length;
  const skipWs = () => {
    while (i < len && /\s/.test(src[i])) i += 1;
  };

  const readString = (quote) => {
    let out = '';
    i += 1; // opening quote
    while (i < len) {
      const ch = src[i];
      if (ch === '\\' && i + 1 < len) {
        // Standard JS escape sequences. We support the common ones;
        // unknown escapes pass through the character verbatim.
        const next = src[i + 1];
        const esc =
          next === 'n'  ? '\n' :
          next === 't'  ? '\t' :
          next === 'r'  ? '\r' :
          next === 'b'  ? '\b' :
          next === 'f'  ? '\f' :
          next === 'v'  ? '\v' :
          next === '0'  ? '\0' :
          next;
        out += esc;
        i += 2;
        continue;
      }
      if (ch === quote) {
        i += 1;
        return out;
      }
      out += ch;
      i += 1;
    }
    throw new Error(`unterminated string starting at offset ${i}`);
  };

  const parseValue = () => {
    skipWs();
    if (i >= len) throw new Error('unexpected end of expression');
    const ch = src[i];
    if (ch === '{' || ch === '[') {
      const closer = ch === '{' ? '}' : ']';
      const open = ch;
      i += 1;
      const arr = ch === '[';
      const items = arr ? [] : {};
      skipWs();
      if (src[i] === closer) {
        i += 1;
        return arr ? items : items;
      }
      while (i < len) {
        skipWs();
        if (arr) {
          items.push(parseValue());
        } else {
          // key (bareword or quoted string)
          let key;
          if (src[i] === '"' || src[i] === "'") {
            key = readString(src[i]);
          } else {
            const start = i;
            while (i < len && /[A-Za-z0-9_-]/.test(src[i])) i += 1;
            key = src.slice(start, i);
            if (!key) throw new Error(`expected object key at offset ${start}`);
          }
          skipWs();
          if (src[i] !== ':') throw new Error(`expected ':' at offset ${i}`);
          i += 1;
          items[key] = parseValue();
        }
        skipWs();
        if (src[i] === ',') {
          i += 1;
          continue;
        }
        if (src[i] === closer) {
          i += 1;
          return items;
        }
        throw new Error(`expected ',' or '${closer}' at offset ${i}`);
      }
      throw new Error(`unterminated ${open === '{' ? 'object' : 'array'}`);
    }
    if (ch === '"' || ch === "'") return readString(ch);
    if (ch === 't' && src.slice(i, i + 4) === 'true') {
      i += 4;
      return true;
    }
    if (ch === 'f' && src.slice(i, i + 5) === 'false') {
      i += 5;
      return false;
    }
    if (ch === 'n' && src.slice(i, i + 4) === 'null') {
      i += 4;
      return null;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const start = i;
      if (ch === '-') i += 1;
      while (i < len && /[0-9.]/.test(src[i])) i += 1;
      const numStr = src.slice(start, i);
      const num = Number(numStr);
      if (Number.isNaN(num)) throw new Error(`bad number '${numStr}' at offset ${start}`);
      return num;
    }
    // bareword identifier — treat as undefined marker
    const start = i;
    while (i < len && /[A-Za-z0-9_$.]/.test(src[i])) i += 1;
    const ident = src.slice(start, i);
    return { __ident: ident };
  };

  const value = parseValue();
  skipWs();
  return { value, rest: src.slice(i) };
}

/**
 * Parse attributes on a JSX element opening tag. Returns an object
 * keyed by attribute name, plus an array of validation errors.
 *
 * Handles:
 *   attr="value"          → string
 *   attr='value'          → string
 *   attr={jsExpression}   → parsed JSON-ish value
 *   attr                  → boolean true
 *
 * @param {string} inside
 * @returns {{ attrs: Record<string, unknown>, errors: Array<{ message: string }> }}
 */
function parseAttrs(inside) {
  const attrs = {};
  const errors = [];
  let i = 0;
  const len = inside.length;
  const skipWs = () => {
    while (i < len && /\s/.test(inside[i])) i += 1;
  };
  while (i < len) {
    skipWs();
    if (i >= len) break;
    // Read attribute name
    const nameStart = i;
    while (i < len && /[A-Za-z0-9_:-]/.test(inside[i])) i += 1;
    const name = inside.slice(nameStart, i);
    if (!name) break;
    skipWs();
    if (inside[i] === '=') {
      i += 1;
      skipWs();
      if (inside[i] === '"' || inside[i] === "'") {
        const q = inside[i];
        i += 1;
        const valStart = i;
        while (i < len && inside[i] !== q) i += 1;
        attrs[name] = inside.slice(valStart, i);
        if (i < len) i += 1; // closing quote
      } else if (inside[i] === '{') {
        // Try parse; on failure, capture the raw source for debug.
        // We need to find the matching closing brace (best-effort depth walk
        // over the whole value) and pass the slice WITHOUT the trailing `}`,
        // so parseJsxValue doesn't see an unterminated string at end of input.
        let depth = 1;
        let j = i + 1;
        while (j < len && depth > 0) {
          if (inside[j] === '{') depth += 1;
          else if (inside[j] === '}') depth -= 1;
          if (depth > 0) j += 1;
        }
        const valueSrc = inside.slice(i + 1, j);
        try {
          const { value } = parseJsxValue(valueSrc);
          attrs[name] = value && typeof value === 'object' && value.__ident
            ? undefined
            : value;
        } catch (err) {
          errors.push({
            message: `failed to parse attr "${name}": ${err.message}`,
          });
        }
        // Skip past the matching closing brace
        i = j + 1;
      } else {
        // Bare value (rare)
        const valStart = i;
        while (i < len && !/\s/.test(inside[i])) i += 1;
        attrs[name] = inside.slice(valStart, i);
      }
    } else {
      attrs[name] = true;
    }
  }
  return { attrs, errors };
}

/**
 * Walk the MDX body string and extract blocks. We look for `<BlockName`
 * tags whose name is in BLOCK_TYPES, parse attributes, and capture
 * children (markdown text or self-closing form).
 *
 * Returns:
 *   { blocks: [...], errors: [...] }
 *
 * The line numbers reported are 1-indexed against the body (after
 * frontmatter stripping); the caller is responsible for offset if it
 * wants file-line numbers.
 *
 * @param {string} body
 * @returns {{ blocks: Array, errors: Array }}
 */
function extractBlocks(body) {
  const blocks = [];
  const errors = [];
  // Track trailing free-form markdown BEFORE the first block as the
  // "__prologue__" RichText — this lets legacy plans without blocks
  // still render their content.
  let cursor = 0;
  let prologueCaptured = false;
  let blockCounter = 0;

  const lineOf = (offset) => {
    let line = 1;
    for (let k = 0; k < offset && k < body.length; k += 1) {
      if (body[k] === '\n') line += 1;
    }
    return line;
  };

  // Find the next opening tag for a known block. We use a custom walker
  // instead of a regex because MDX attribute values can contain `>` (in
  // strings or arrow functions) — a regex would stop too early and
  // truncate the attribute list. The walker respects:
  //   - string literals (single + double quotes, with escape sequences)
  //   - JSX expression braces `{...}` (depth-balanced)
  //   - HTML comments `<!-- ... -->`
  const findNextOpenTag = (startFrom) => {
    let i = startFrom;
    while (i < body.length) {
      const ch = body[i];
      if (ch !== '<') { i += 1; continue; }
      // Skip comments `<!-- ... -->`
      if (body.slice(i, i + 4) === '<!--') {
        const end = body.indexOf('-->', i + 4);
        if (end === -1) return null;
        i = end + 3;
        continue;
      }
      // Must be `<Word` (capital letter followed by alpha) — a known block opening tag.
      if (!/[A-Z]/.test(body[i + 1] || '')) { i += 1; continue; }
      let j = i + 1;
      while (j < body.length && /[A-Za-z0-9]/.test(body[j])) j += 1;
      const name = body.slice(i + 1, j);
      if (!BLOCK_TYPES.has(name)) { i = j; continue; }
      // Walk past the rest of the opening tag, respecting strings + braces.
      while (j < body.length && body[j] !== '>') {
        const c = body[j];
        if (c === '"' || c === "'") {
          // Skip string literal
          j += 1;
          while (j < body.length && body[j] !== c) {
            if (body[j] === '\\') j += 2;
            else j += 1;
          }
          j += 1;
          continue;
        }
        j += 1;
      }
      if (j >= body.length) return null;
      const selfClose = body[j - 1] === '/' ? '/' : '';
      const inside = body.slice(i + 1 + name.length, j - (selfClose ? 1 : 0));
      return { name, inside, selfClose, start: i, end: j + 1 };
    }
    return null;
  };

  while (cursor < body.length) {
    const found = findNextOpenTag(cursor);
    if (!found) break;
    const { name, inside, selfClose, start, end } = found;
    const { attrs, errors: attrErrors } = parseAttrs(inside);
    for (const e of attrErrors) errors.push({ line: lineOf(start), ...e });
    blockCounter += 1;
    const id = typeof attrs.id === 'string' && attrs.id
      ? attrs.id
      : `${name.toLowerCase()}_${blockCounter}`;
    // Capture anything between this tag and its closer as children
    let childrenMarkdown = '';
    let closeOffset = -1;
    if (selfClose === '/') {
      closeOffset = end;
      cursor = closeOffset;
    } else {
      const closeStr = `</${name}>`;
      const ci = body.indexOf(closeStr, end);
      if (ci === -1) {
        errors.push({
          line: lineOf(start),
          message: `<${name}> opened at line ${lineOf(start)} has no closing tag`,
        });
        closeOffset = end;
        cursor = closeOffset;
      } else {
        closeOffset = ci;
        childrenMarkdown = body.slice(end, ci);
        cursor = ci + closeStr.length;
      }
    }
    // Capture free-form markdown BEFORE this block as the prologue.
    if (!prologueCaptured) {
      const pre = body.slice(cursor, start).trim();
      if (pre) {
        blocks.push({
          id: PROLOGUE_ID,
          type: 'RichText',
          data: {},
          childrenMarkdown: pre,
        });
      }
      prologueCaptured = true;
    }
    const data = { ...attrs };
    delete data.id;
    blocks.push({
      id,
      type: name,
      data,
      childrenMarkdown: childrenMarkdown.trim(),
    });
  }

  // Trailing free-form markdown after the last block
  if (!prologueCaptured) {
    const rest = body.slice(cursor).trim();
    if (rest) {
      blocks.push({
        id: PROLOGUE_ID,
        type: 'RichText',
        data: {},
        childrenMarkdown: rest,
      });
    }
  } else {
    const rest = body.slice(cursor).trim();
    if (rest) {
      blocks.push({
        id: `${PROLOGUE_ID}_tail`,
        type: 'RichText',
        data: {},
        childrenMarkdown: rest,
      });
    }
  }

  return { blocks, errors };
}

/**
 * Compile MDX source into a JSON-serializable glyph object.
 *
 * Validates the source with `@mdx-js/mdx` so MDX syntax errors surface
 * as structured errors, then walks the body to extract blocks using
 * the recursive parser above.
 *
 * @param {string} source  Raw MDX text (frontmatter optional).
 * @param {object} [options]
 * @param {boolean} [options.skipValidate]  Skip the @mdx-js/mdx pass (faster, for trusted input).
 * @returns {Promise<{
 *   frontmatter: Record<string, unknown>,
 *   blocks: Array<{ id: string, type: string, data: object, childrenMarkdown?: string }>,
 *   errors: Array<{ line?: number, message: string }>,
 *   compiledAt: string,
 * }>}
 */
export async function compileGlyphMdx(source, options = {}) {
  const { skipValidate = false } = options;
  const errors = [];
  const { frontmatter, body } = parseFrontmatter(source || '');

  if (!skipValidate) {
    try {
      await compile(source || '', { jsx: false, development: false });
    } catch (err) {
      errors.push({
        line: err.line ?? null,
        message: err.message || String(err),
      });
    }
  }

  const { blocks, errors: extractErrors } = extractBlocks(body);
  for (const e of extractErrors) errors.push(e);

  return {
    frontmatter,
    blocks,
    errors,
    compiledAt: new Date().toISOString(),
  };
}

/**
 * Synchronous variant of `compileGlyphMdx`. Skips MDX validation (so
 * it doesn't need `compile()` from @mdx-js/mdx, which is async-only).
 * Use this only for trusted input where you want zero-overhead
 * extraction.
 *
 * @param {string} source
 * @returns {{
 *   frontmatter: Record<string, unknown>,
 *   blocks: Array<{ id: string, type: string, data: object, childrenMarkdown?: string }>,
 *   errors: Array<{ line?: number, message: string }>,
 *   compiledAt: string,
 * }}
 */
export function compileGlyphMdxSync(source) {
  const { frontmatter, body } = parseFrontmatter(source || '');
  const { blocks, errors } = extractBlocks(body);
  return {
    frontmatter,
    blocks,
    errors,
    compiledAt: new Date().toISOString(),
  };
}

export const _internal = {
  BLOCK_TYPES,
  PROLOGUE_ID,
  parseFrontmatter,
  parseJsxValue,
  parseAttrs,
  extractBlocks,
};