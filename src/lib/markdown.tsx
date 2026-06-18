// src/lib/markdown.ts — pretty JSON syntax highlighter for the JSON tree panel.
// Replaces the old utils.highlightJSON; we render to React nodes, not strings.

import { Fragment } from 'react';

type Token = { kind: 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct' | 'space'; value: string };

function tokenize(json: string): Token[] {
  const out: Token[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(\btrue\b|\bfalse\b)|(\bnull\b)|([{}\[\],])|(\s+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(json)) !== null) {
    if (m[1] !== undefined) {
      out.push({ kind: m[2] ? 'key' : 'string', value: m[1] });
      if (m[2]) out.push({ kind: 'punct', value: m[2] });
    } else if (m[3] !== undefined) {
      out.push({ kind: 'number', value: m[3] });
    } else if (m[4] !== undefined) {
      out.push({ kind: 'boolean', value: m[4] });
    } else if (m[5] !== undefined) {
      out.push({ kind: 'null', value: m[5] });
    } else if (m[6] !== undefined) {
      out.push({ kind: 'punct', value: m[6] });
    } else if (m[7] !== undefined) {
      out.push({ kind: 'space', value: m[7] });
    }
  }
  return out;
}

const COLOR: Record<Token['kind'], string | undefined> = {
  key: 'var(--syntax-key)',
  string: 'var(--syntax-string)',
  number: 'var(--syntax-number)',
  boolean: 'var(--syntax-boolean)',
  null: 'var(--syntax-null)',
  punct: undefined,
  space: undefined,
};

/** Render highlighted JSON as React fragments. */
export function JsonHighlight({ value }: { value: unknown }) {
  const json = JSON.stringify(value, null, 2);
  if (json === undefined) return null;
  const tokens = tokenize(json);
  return (
    <>
      {tokens.map((t, i) => {
        const color = COLOR[t.kind];
        if (!color) return <Fragment key={i}>{t.value}</Fragment>;
        return (
          <span key={i} style={{ color }}>
            {t.value}
          </span>
        );
      })}
    </>
  );
}
