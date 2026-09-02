/**
 * cli/__tests__/parse-tool-flags.test.mjs
 *
 * F-202 — regression fence for `parseToolFlags` and `parseFlags` so the
 * `--tools=claude,codex` and `--all-tools` plumbing cannot silently
 * regress to Claude-only behavior.
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseToolFlags, parseFlags, resolveEffectiveTools, formatToolsLabel } from '../provision.mjs';

describe('parseToolFlags()', () => {
  test('returns null selection when no tools flag is supplied', () => {
    const r = parseToolFlags([]);
    assert.equal(r.tools, null);
    assert.equal(r.allTools, false);
  });

  test('parses --tools=claude,codex into ordered deduped array', () => {
    const r = parseToolFlags(['--tools=claude,codex']);
    assert.deepEqual(r.tools, ['claude', 'codex']);
    assert.equal(r.allTools, false);
  });

  test('parses --tools codex,claude in input order', () => {
    const r = parseToolFlags(['--tools', 'codex,claude']);
    assert.deepEqual(r.tools, ['codex', 'claude']);
  });

  test('drops unknown tool ids but keeps valid ones', () => {
    const r = parseToolFlags(['--tools=claude,gemini,codex']);
    assert.deepEqual(r.tools, ['claude', 'codex']);
  });

  test('deduplicates repeated ids', () => {
    const r = parseToolFlags(['--tools=claude,claude,codex']);
    assert.deepEqual(r.tools, ['claude', 'codex']);
  });

  test('returns null selection when all ids are invalid', () => {
    const r = parseToolFlags(['--tools=gemini,cursor']);
    assert.equal(r.tools, null);
  });

  test('--all-tools expands to every supported coding tool', () => {
    const r = parseToolFlags(['--all-tools']);
    assert.equal(r.allTools, true);
    assert.ok(r.tools.includes('claude'));
    assert.ok(r.tools.includes('codex'));
  });

  test('--all-tools wins over --tools= when both are passed', () => {
    const r = parseToolFlags(['--tools=codex', '--all-tools']);
    assert.equal(r.allTools, true);
    assert.ok(r.tools.includes('claude'));
    assert.ok(r.tools.includes('codex'));
  });
});

describe('parseFlags() with F-202 tool plumbing', () => {
  test('default behavior keeps tools=null so the interactive prompt runs', () => {
    const prev = process.env.BIZAR_INSTALL_TOOLS;
    delete process.env.BIZAR_INSTALL_TOOLS;
    try {
      const opts = parseFlags([]);
      assert.equal(opts.tools, null);
      assert.equal(process.env.BIZAR_INSTALL_TOOLS, undefined);
    } finally {
      if (prev !== undefined) process.env.BIZAR_INSTALL_TOOLS = prev;
    }
  });

  test('--tools=codex is reflected on opts and in BIZAR_INSTALL_TOOLS env', () => {
    const prev = process.env.BIZAR_INSTALL_TOOLS;
    delete process.env.BIZAR_INSTALL_TOOLS;
    try {
      const opts = parseFlags(['--tools=codex']);
      assert.deepEqual(opts.tools, ['codex']);
      assert.equal(process.env.BIZAR_INSTALL_TOOLS, 'codex');
    } finally {
      if (prev !== undefined) process.env.BIZAR_INSTALL_TOOLS = prev;
    }
  });

  test('--all-tools sets tools to every supported id and exports env', () => {
    const prev = process.env.BIZAR_INSTALL_TOOLS;
    delete process.env.BIZAR_INSTALL_TOOLS;
    try {
      const opts = parseFlags(['--all-tools']);
      assert.ok(Array.isArray(opts.tools));
      assert.ok(opts.tools.includes('claude'));
      assert.ok(opts.tools.includes('codex'));
      assert.match(process.env.BIZAR_INSTALL_TOOLS, /claude/);
      assert.match(process.env.BIZAR_INSTALL_TOOLS, /codex/);
    } finally {
      if (prev !== undefined) process.env.BIZAR_INSTALL_TOOLS = prev;
    }
  });
});

console.log('  parse-tool-flags.test.mjs loaded — run with: node --test cli/__tests__/parse-tool-flags.test.mjs');

describe('resolveEffectiveTools()', () => {
  test('falls back to ["claude"] when nothing is supplied', () => {
    const prev = process.env.BIZAR_INSTALL_TOOLS;
    delete process.env.BIZAR_INSTALL_TOOLS;
    try {
      assert.deepEqual(resolveEffectiveTools(null), ['claude']);
      assert.deepEqual(resolveEffectiveTools(undefined), ['claude']);
    } finally {
      if (prev !== undefined) process.env.BIZAR_INSTALL_TOOLS = prev;
    }
  });

  test('explicit tools argument wins over BIZAR_INSTALL_TOOLS', () => {
    const prev = process.env.BIZAR_INSTALL_TOOLS;
    process.env.BIZAR_INSTALL_TOOLS = 'codex';
    try {
      assert.deepEqual(resolveEffectiveTools(['claude']), ['claude']);
    } finally {
      if (prev === undefined) delete process.env.BIZAR_INSTALL_TOOLS;
      else process.env.BIZAR_INSTALL_TOOLS = prev;
    }
  });

  test('reads BIZAR_INSTALL_TOOLS env when no explicit tools are passed', () => {
    const prev = process.env.BIZAR_INSTALL_TOOLS;
    process.env.BIZAR_INSTALL_TOOLS = 'claude,codex';
    try {
      assert.deepEqual(resolveEffectiveTools(null), ['claude', 'codex']);
    } finally {
      if (prev === undefined) delete process.env.BIZAR_INSTALL_TOOLS;
      else process.env.BIZAR_INSTALL_TOOLS = prev;
    }
  });

  test('drops unknown ids and falls back to default when env is all garbage', () => {
    const prev = process.env.BIZAR_INSTALL_TOOLS;
    process.env.BIZAR_INSTALL_TOOLS = 'gemini,cursor';
    try {
      assert.deepEqual(resolveEffectiveTools(null), ['claude']);
    } finally {
      if (prev === undefined) delete process.env.BIZAR_INSTALL_TOOLS;
      else process.env.BIZAR_INSTALL_TOOLS = prev;
    }
  });

  test('dedupes repeated ids', () => {
    const prev = process.env.BIZAR_INSTALL_TOOLS;
    delete process.env.BIZAR_INSTALL_TOOLS;
    try {
      assert.deepEqual(resolveEffectiveTools(['claude', 'claude', 'codex']), ['claude', 'codex']);
    } finally {
      if (prev !== undefined) process.env.BIZAR_INSTALL_TOOLS = prev;
    }
  });
});

describe('formatToolsLabel()', () => {
  test('renders a single claude selection with the legacy Claude Code label', () => {
    assert.equal(formatToolsLabel(['claude']), 'Claude Code');
  });

  test('renders a single codex selection as Codex CLI', () => {
    assert.equal(formatToolsLabel(['codex']), 'Codex CLI');
  });

  test('renders the dual-tool banner label', () => {
    assert.equal(formatToolsLabel(['claude', 'codex']), 'Claude Code + Codex CLI');
  });

  test('falls back gracefully for empty input', () => {
    assert.equal(formatToolsLabel([]), 'Claude Code');
    assert.equal(formatToolsLabel(null), 'Claude Code');
  });
});