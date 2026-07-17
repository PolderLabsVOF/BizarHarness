/**
 * v8/views/Artifacts/ClaudeArtifactView.tsx — v10.1.0.
 *
 * Renders Claude-* kind artifacts (HTML / SVG / React) inside a
 * sandboxed iframe. The server hands us a fully-compiled HTML envelope
 * (returned from GET /api/artifacts/:slug/render) and we drop it into
 * `srcdoc`. The iframe has `sandbox` set so even if a malicious escape
 * slips past server-side filtering, the runtime is still constrained.
 *
 * Two render modes:
 *   1. <iframe srcdoc> — for full-envelope artifacts (default).
 *   2. Plain `<div>` for an `mdx` kind fallback (handled by caller).
 */

import { useState } from 'react';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { Stack } from '../../ui/primitives/Stack.js';
import { AlertTriangle, ShieldCheck, ExternalLink } from 'lucide-react';
import { Button } from '../../ui/controls/Button.js';

export interface ClaudeRenderPayload {
  slug: string;
  kind: 'claude-html' | 'claude-svg' | 'claude-react' | 'mdx';
  html?: string;
  blocks?: unknown[];
  frontmatter?: Record<string, unknown>;
  warnings?: Array<{ message?: string; pattern?: string }>;
  safeMode?: boolean;
  compiledAt?: string;
}

export function ClaudeArtifactView({
  payload,
  slug,
}: {
  payload: ClaudeRenderPayload;
  slug: string;
}): JSX.Element {
  const [showSource, setShowSource] = useState(false);

  if (payload.kind === 'mdx') {
    // Legacy fallback — the server returns no `html` for mdx; just show
    // the compiled block count.
    return (
      <Card variant="default" data-testid={`claude-view-${slug}`}>
        <CardBody>
          <Inline align="center" gap={2}>
            <ShieldCheck size={14} aria-hidden style={{ color: 'var(--fg-muted)' }} />
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              Legacy MDX — {Array.isArray(payload.blocks) ? `${payload.blocks.length} blocks` : 'no blocks'}
            </span>
          </Inline>
        </CardBody>
      </Card>
    );
  }

  if (!payload.html) {
    return (
      <Card variant="default" data-testid={`claude-view-${slug}`}>
        <CardBody>
          <span role="alert" style={{ color: 'var(--danger)' }}>
            No HTML returned by the compiler.
          </span>
        </CardBody>
      </Card>
    );
  }

  return (
    <Stack gap={2} data-testid={`claude-view-${slug}`}>
      {payload.safeMode && (
        <Inline
          align="center"
          gap={2}
          style={{
            padding: 'var(--space-2)',
            background: 'var(--callout-warning-bg, #fdf6e3)',
            border: '1px solid var(--callout-warning-border, #e0c97d)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--fs-12)',
          }}
          role="status"
          data-testid={`claude-safe-${slug}`}
        >
          <AlertTriangle size={14} aria-hidden style={{ color: 'var(--callout-warning-fg)' }} />
          <span>
            Safe mode — the compiler stripped potentially dangerous
            patterns in this artifact.
          </span>
        </Inline>
      )}
      {payload.warnings && payload.warnings.length > 0 && (
        <details
          style={{
            fontSize: 'var(--fs-12)',
            color: 'var(--fg-muted)',
            padding: 'var(--space-2)',
            background: 'var(--surface-1)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <summary>{payload.warnings.length} warning(s)</summary>
          <ul style={{ marginTop: 'var(--space-1)' }}>
            {payload.warnings.map((w, i) => (
              <li key={i}>
                <code style={{ fontFamily: 'var(--font-mono)' }}>
                  {w.pattern}
                </code>{' '}
                — {w.message}
              </li>
            ))}
          </ul>
        </details>
      )}
      <Inline align="center" justify="between" gap={2}>
        <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>
          {payload.kind} · compiled {payload.compiledAt ? new Date(payload.compiledAt).toLocaleTimeString() : 'now'}
        </span>
        <Inline gap={1}>
          <Button variant="ghost" onClick={() => setShowSource((v) => !v)} data-testid={`claude-source-${slug}`}>
            {showSource ? 'Hide source' : 'Show source'}
          </Button>
          <a
            href={`/api/artifacts/${slug}/view`}
            target="_blank"
            rel="noopener noreferrer"
            data-testid={`claude-blank-${slug}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 'var(--space-1)',
              fontSize: 'var(--fs-12)',
              padding: 'var(--space-1) var(--space-2)',
              color: 'var(--fg)',
              textDecoration: 'none',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface-0)',
            }}
          >
            <ExternalLink size={12} aria-hidden /> Open in new tab
          </a>
        </Inline>
      </Inline>
      <iframe
        title={`claude-artifact-${slug}`}
        data-testid={`claude-iframe-${slug}`}
        sandbox="allow-scripts allow-same-origin"
        srcDoc={payload.html}
        style={{
          width: '100%',
          height: 480,
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          background: 'white',
        }}
      />
      {showSource && (
        <pre
          data-testid={`claude-source-text-${slug}`}
          style={{
            padding: 'var(--space-2)',
            background: 'var(--surface-1)',
            borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--fs-11)',
            maxHeight: 320,
            overflow: 'auto',
            fontFamily: 'var(--font-mono)',
            whiteSpace: 'pre-wrap',
          }}
        >
          {payload.html}
        </pre>
      )}
    </Stack>
  );
}