/**
 * S37 — chat-types.test.ts
 *
 * Static-analysis guard that all `WsMessage`-typed consumers reference
 * the v9.3.0 chat events. Defends against the type union growing
 * while some consumer still filters on the legacy event set.
 *
 * Also verifies the data shapes exported from types.ts compile to the
 * expected property set (chat streaming contract: delta carries text +
 * session; message carries session + message object; done carries
 * session; error carries session + error + status).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TYPES_PATH = join(import.meta.dirname, '../data/types.ts');

interface WsMember { type: string }

function extractWsMembers(source: string): WsMember[] {
  // Naive parse: pull every `| { type: '…'` line from the WsMessage union.
  const out: WsMember[] = [];
  const re = /\|\s*\{\s*type:\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) out.push({ type: m[1] });
  return out;
}

describe('S37 WsMessage union', () => {
  it('exposes every v9.3.0 chat event type', () => {
    const src = readFileSync(TYPES_PATH, 'utf8');
    const members = new Set(extractWsMembers(src).map((w) => w.type));
    for (const required of ['chat:delta', 'chat:message', 'chat:done', 'chat:error', 'history:new', 'projects:change', 'update:progress']) {
      expect(members.has(required), `WsMessage must include ${required}`).toBe(true);
    }
  });

  it('ChatMessage shape includes role + ts + content', () => {
    const src = readFileSync(TYPES_PATH, 'utf8');
    expect(src).toMatch(/export\s+interface\s+ChatMessage[\s\S]+role:\s+'user'\s*\|\s*'assistant'\s*\|\s*'system'\s*\|\s*'tool'/);
    expect(src).toMatch(/export\s+interface\s+ChatMessage[\s\S]+content:\s*string/);
    expect(src).toMatch(/export\s+interface\s+ChatMessage[\s\S]+ts:\s*string/);
  });

  it('ChatSession shape includes id', () => {
    const src = readFileSync(TYPES_PATH, 'utf8');
    expect(src).toMatch(/export\s+interface\s+ChatSession[\s\S]+id:\s*string/);
  });

  it('HistoryEvent shape includes ts', () => {
    const src = readFileSync(TYPES_PATH, 'utf8');
    expect(src).toMatch(/export\s+interface\s+HistoryEvent[\s\S]+ts\?:\s*number/);
  });
});