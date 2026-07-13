/**
 * v8/views/Admin/AdminView.tsx — Sprint S40, v9.3.0.
 *
 * Card grid of admin / maintenance actions. Each tile posts to its
 * /api/admin/* endpoint, shows a spinner while busy, surfaces the
 * result inline (or the error message), and uses the inline-confirm
 * pattern for destructive actions (cache clear, log purge, restart,
 * rebuild).
 */

import { useState } from 'react';
import {
  RefreshCw,
  Trash2,
  Database,
  Brain,
  PowerOff,
  Hammer,
  ScrollText,
  Download,
  ShieldAlert,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Button } from '../../ui/controls/Button.js';
import { Grid } from '../../ui/primitives/Grid.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';

interface AdminAction {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  endpoint: string;
  method: 'POST' | 'GET';
  destructive: boolean;
}

const ACTIONS: AdminAction[] = [
  {
    id: 'gc',
    title: 'Garbage collect',
    description: 'Prune empty session files + orphaned task rows from the cache.',
    icon: Trash2,
    endpoint: '/api/admin/gc',
    method: 'POST',
    destructive: false,
  },
  {
    id: 'cache-clear',
    title: 'Clear cache',
    description: 'Wipe the dashboard cache directory. Rebuilds on next access.',
    icon: Database,
    endpoint: '/api/admin/cache/clear',
    method: 'POST',
    destructive: true,
  },
  {
    id: 'memory-reindex',
    title: 'Reindex memory',
    description: 'Rebuild the vault search index.',
    icon: Brain,
    endpoint: '/api/admin/memory/reindex',
    method: 'POST',
    destructive: false,
  },
  {
    id: 'logs-purge',
    title: 'Purge old logs',
    description: 'Delete log files older than 14 days from ~/.config/bizar/logs.',
    icon: ScrollText,
    endpoint: '/api/admin/logs/purge',
    method: 'POST',
    destructive: true,
  },
  {
    id: 'restart',
    title: 'Restart dashboard',
    description: 'Signal the server to shut down. The CLI launcher restarts it.',
    icon: PowerOff,
    endpoint: '/api/admin/restart',
    method: 'POST',
    destructive: true,
  },
  {
    id: 'rebuild',
    title: 'Rebuild',
    description: 'Re-run the installer build step.',
    icon: Hammer,
    endpoint: '/api/admin/rebuild',
    method: 'POST',
    destructive: true,
  },
  {
    id: 'export-activity',
    title: 'Export activity',
    description: 'Download the full activity log as NDJSON.',
    icon: Download,
    endpoint: '/api/admin/activity/export',
    method: 'GET',
    destructive: false,
  },
];

export function AdminView(): JSX.Element {
  return (
    <Stack gap={4} data-testid="admin-view">
      <ViewHeader
        title="Admin"
        description="Maintenance actions. Destructive actions require an inline confirm."
      />
      <Grid cols={{ base: 1, md: 2, lg: 3 }} gap={3}>
        {ACTIONS.map((a) => (
          <AdminTile key={a.id} action={a} />
        ))}
      </Grid>
    </Stack>
  );
}

function AdminTile({ action }: { action: AdminAction }): JSX.Element {
  const [busy, setBusy] = useState<boolean>(false);
  const [confirm, setConfirm] = useState<boolean>(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const Icon = action.icon;

  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      if (action.method === 'GET') {
        // For GET endpoints (export), trigger a download by navigating
        // to the endpoint in a new tab. The server sets Content-Disposition.
        window.open(action.endpoint, '_blank');
        setResult('Download started');
      } else {
        const res = await fetchJson<{ ok?: boolean; files?: number; bytes?: number; note?: string }>(
          action.endpoint,
          { method: action.method, body: {} },
        );
        const summary = res.note
          ? res.note
          : res.files !== undefined
            ? `${res.files} file(s) removed (${res.bytes ?? 0} bytes)`
            : res.ok ? 'Done' : 'Done';
        setResult(summary);
      }
      setConfirm(false);
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card variant="default">
      <CardBody>
        <Stack gap={2}>
          <Inline align="center" gap={2}>
            <Icon size={18} aria-hidden />
            <strong style={{ fontSize: 'var(--fs-13)' }}>{action.title}</strong>
            {action.destructive && (
              <span style={{ marginLeft: 'auto', color: 'var(--danger)', fontSize: 'var(--fs-11)' }} aria-label="Destructive">
                <ShieldAlert size={14} aria-hidden style={{ verticalAlign: 'middle' }} /> destructive
              </span>
            )}
          </Inline>
          <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-12)', margin: 0 }}>
            {action.description}
          </p>
          {result !== null && (
            <span data-testid={`admin-result-${action.id}`} style={{ fontSize: 'var(--fs-12)', color: 'var(--success)' }}>
              {result}
            </span>
          )}
          {error !== null && (
            <span role="alert" data-testid={`admin-error-${action.id}`} style={{ fontSize: 'var(--fs-12)', color: 'var(--danger)' }}>
              {error}
            </span>
          )}
          {confirm ? (
            <Inline gap={1}>
              <Button variant="danger" onClick={() => void run()} disabled={busy} data-testid={`admin-confirm-${action.id}`}>
                Confirm
              </Button>
              <Button variant="ghost" onClick={() => setConfirm(false)} disabled={busy} data-testid={`admin-cancel-${action.id}`}>
                Cancel
              </Button>
            </Inline>
          ) : (
            <Button
              variant={action.destructive ? 'danger' : 'primary'}
              onClick={() => (action.destructive ? setConfirm(true) : void run())}
              disabled={busy}
              data-testid={`admin-run-${action.id}`}
            >
              <RefreshCw size={14} aria-hidden /> {busy ? 'Working…' : 'Run'}
            </Button>
          )}
        </Stack>
      </CardBody>
    </Card>
  );
}