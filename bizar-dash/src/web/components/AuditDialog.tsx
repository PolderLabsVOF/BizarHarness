// src/components/AuditDialog.tsx — Dialog for /audit command.

import { useState } from 'react';
import { Button } from './Button';
import { api } from '../lib/api';

type AuditDialogProps = {
  data?: Record<string, unknown>;
  onClose: () => void;
};

type AuditResult = {
  ok: boolean;
  findings: string[];
  error?: string;
};

export function AuditDialog({ data, onClose }: AuditDialogProps) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);

  const handleRunAudit = async () => {
    setRunning(true);
    setResult(null);
    try {
      // The audit is run by posting to /api/chat with an /audit message,
      // which forwards to the opencode serve child where the plugin handles it.
      // We poll for a response via the chat session.
      const res = await api.post<AuditResult>('/chat/audit', {});
      setResult(res);
    } catch (err) {
      setResult({ ok: false, findings: [], error: (err as Error).message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      {result === null ? (
        <>
          <p style={{ marginBottom: 16, lineHeight: 1.6 }}>
            Run a security audit of your Bizar agent configuration. The audit checks for common misconfigurations, exposed secrets, and insecure defaults.
          </p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={handleRunAudit} disabled={running}>
              {running ? 'Running…' : 'Run Audit'}
            </Button>
          </div>
        </>
      ) : (
        <>
          {result.ok ? (
            <div>
              <p style={{ marginBottom: 12, fontWeight: 600, color: 'var(--color-success)' }}>
                Audit passed — no issues found.
              </p>
              {result.findings.length > 0 && (
                <ul style={{ marginBottom: 16, paddingLeft: 20 }}>
                  {result.findings.map((f, i) => (
                    <li key={i} style={{ marginBottom: 4, fontSize: 13 }}>{f}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p style={{ marginBottom: 16, color: 'var(--color-danger)' }}>
              Audit failed: {result.error ?? 'unknown error'}
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        </>
      )}
    </div>
  );
}
