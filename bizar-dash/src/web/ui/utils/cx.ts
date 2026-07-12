/*
 * cx.ts — Tiny className combiner.
 *
 * Filters out falsy values (false, null, undefined, 0, '') and joins the
 * surviving truthy strings with a single space. Accepts nested arrays
 * (recursively flattened) and object syntax ({ active: true, disabled:
 * false }) so callers can pass conditional flags without concatenation.
 *
 * Zero runtime dependencies — preferred over `clsx`/`classnames` to keep
 * the design-system package free of vendored utilities.
 */

export type ClassValue =
  | string
  | number
  | null
  | false
  | undefined
  | ClassValue[]
  | { [key: string]: boolean | null | undefined };

export function cx(...inputs: ClassValue[]): string {
  const out: string[] = [];
  const walk = (value: ClassValue): void => {
    if (!value) return;
    if (typeof value === 'string' || typeof value === 'number') {
      out.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) walk(v);
      return;
    }
    if (typeof value === 'object') {
      for (const key in value) {
        if (value[key]) out.push(key);
      }
    }
  };
  for (const input of inputs) walk(input);
  return out.join(' ');
}
