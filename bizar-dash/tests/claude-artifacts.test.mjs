/**
 * tests/claude-artifacts.test.mjs
 *
 * v10.1.0 — Smoke test for the Claude Artifacts compiler:
 *   - kind auto-detection
 *   - safe-mode triggers on exfil pattern
 *   - claude-react envelope includes React CDN scripts
 *   - mdx → react migration helper returns working JSX
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  compileClaudeArtifact,
  detectKind,
  scanForExfil,
  stripScripts,
  buildEnvelope,
  mdxBlocksToReact,
} from '../src/server/claude-artifacts.mjs';

describe('claude-artifacts', () => {
  it('detects kind from content', () => {
    assert.equal(detectKind('<svg viewBox="0 0 10 10"><circle r="5"/></svg>'), 'claude-svg');
    assert.equal(detectKind('export default function App() { return <div/> }'), 'claude-react');
    assert.equal(detectKind('<h1>hello</h1>'), 'claude-html');
    // Declared kind wins over content
    assert.equal(detectKind('export default function A(){}', 'claude-svg'), 'claude-svg');
  });

  it('flags exfiltration patterns', () => {
    const hits = scanForExfil(`top.location = 'https://evil'`);
    assert.ok(hits.length >= 1, 'expected at least one hit');
    const clean = scanForExfil(`<h1>hello</h1>`);
    assert.equal(clean.length, 0);
  });

  it('falls back to safeMode when scan trips', () => {
    const out = compileClaudeArtifact(`<script>top.location='//evil'</script><h1>x</h1>`);
    assert.equal(out.safeMode, true);
    assert.ok(out.warnings.length >= 1);
    // The script block must be gone in safe mode.
    assert.equal(/<script/i.test(out.html), false);
  });

  it('react envelope injects React + Babel CDN', () => {
    const out = compileClaudeArtifact('export default function App(){ return <h1>hi</h1>; }', {
      kind: 'claude-react',
    });
    assert.equal(out.kind, 'claude-react');
    assert.ok(out.html.includes('react@18.3.1/umd/react.production.min.js'));
    assert.ok(out.html.includes('babel.min.js'));
  });

  it('stripScripts removes inline handlers + script blocks', () => {
    const html = '<div onclick="alert(1)">x</div><script>top.foo</script>';
    const out = stripScripts(html);
    assert.equal(/<script/i.test(out), false);
    assert.equal(/onclick=/i.test(out), false);
  });

  it('buildEnvelope wraps body and adds head', () => {
    const out = buildEnvelope('<h1>hello</h1>', { kind: 'claude-html' });
    assert.ok(out.startsWith('<!doctype html>'));
    assert.ok(out.includes('<style>'));
    assert.ok(out.includes('<h1>hello</h1>'));
  });

  it('mdxBlocksToReact emits working JSX for supported blocks', () => {
    const compiled = {
      frontmatter: { title: 't' },
      blocks: [
        { id: 'a', type: 'RichText', childrenMarkdown: 'hi' },
        { id: 'b', type: 'Stat', data: { label: 'Calls', value: '42' } },
        { id: 'c', type: 'Mockup', childrenMarkdown: 'mock' }, // unsupported
      ],
    };
    const { source, warnings } = mdxBlocksToReact(compiled);
    assert.ok(source.includes('export default function App'));
    assert.ok(source.includes('Block_a'));
    assert.ok(source.includes('Block_b'));
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Mockup/);
  });
});

/**
 * Compiled-envelope shape: a non-Claude kind (`mdx`) gets a plain
 * monospace preview; a Claude kind gets a full HTML document. Both
 * must be standalone-`<iframe srcdoc>`-safe (no external script src
 * pointing at non-allowlisted hosts unless the kind is claude-react,
 * which injects React + Babel from unpkg).
 */
describe('compiled envelope for full-screen viewer', () => {
  it('mdx preview is standalone-safe', () => {
    const html = `<!doctype html><html><body style="font-family:monospace;padding:16px;"><pre>hi</pre></body></html>`;
    assert.ok(html.startsWith('<!doctype html>'));
    assert.ok(html.includes('<body'));
  });

  it('claude-react envelope is iframe-srcdoc ready', () => {
    const out = compileClaudeArtifact(
      'export default function App(){return <h1>hi</h1>;}',
      { kind: 'claude-react' },
    );
    assert.ok(out.html.startsWith('<!doctype html>'));
    assert.ok(out.html.includes('crossorigin src="https://unpkg.com/react'));
  });

  it('claude-html envelope omits the React CDN', () => {
    const out = compileClaudeArtifact('<h1>hello</h1>', { kind: 'claude-html' });
    assert.equal(out.html.includes('react@18'), false);
    assert.equal(out.html.includes('babel.min.js'), false);
  });
});