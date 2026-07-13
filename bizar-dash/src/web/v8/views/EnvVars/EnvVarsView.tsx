/**
 * v8/views/EnvVars/EnvVarsView.tsx — Sprint S41, v9.3.0.
 *
 * List of env vars (masked values) with: per-row edit (Sheet),
 * per-row delete (inline confirm), Add Sheet, Bulk Import Sheet,
 * and Export trigger. Backed by /api/env-vars + /api/env-vars/grouped
 * + /api/env-vars/export + /api/env-vars/bulk-import.
 */

import { useCallback, useMemo, useState } from 'react';
import { Download, FileUp, Pencil, Plus, RefreshCcw, Trash2, Variable } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Button } from '../../ui/controls/Button.js';
import { Input } from '../../ui/controls/Input.js';
import { Sheet, SheetClose, SheetContent } from '../../ui/feedback/Sheet.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { useFetch } from '../../data/useFetch.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';

interface EnvRow {
  name: string;
  value: string;
  createdAt?: string;
  source?: string;
}

export function EnvVarsView(): JSX.Element {
  const payload = useFetch<EnvRow[]>('/api/env-vars');
  const [adding, setAdding] = useState<boolean>(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [bulkImporting, setBulkImporting] = useState<boolean>(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo<EnvRow[]>(() => payload.data ?? [], [payload.data]);

  const refresh = useCallback(() => { void payload.refetch(); }, [payload]);

  const drop = async (name: string): Promise<void> => {
    setError(null);
    try {
      await fetchJson(`/api/env-vars/${name}`, { method: 'DELETE' });
      setConfirmDelete(null);
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  return (
    <Stack gap={4} data-testid="env-vars-view">
      <ViewHeader
        title="Env vars"
        description="Runtime environment variables for the dashboard. Stored in ~/.config/bizar/env.json (mode 0600)."
        actions={
          <Inline align="center" gap={2}>
            {error !== null && (
              <span role="alert" data-testid="env-vars-error" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>
                {error}
              </span>
            )}
            <Button variant="ghost" onClick={() => { window.open('/api/env-vars/export', '_blank'); }} data-testid="env-vars-export">
              <Download size={14} aria-hidden /> Export
            </Button>
            <Button variant="ghost" onClick={() => setBulkImporting(true)} data-testid="env-vars-bulk-import">
              <FileUp size={14} aria-hidden /> Bulk import
            </Button>
            <Button variant="ghost" onClick={() => void refresh()} data-testid="env-vars-refresh">
              <RefreshCcw size={14} aria-hidden /> Refresh
            </Button>
            <Button variant="primary" onClick={() => setAdding(true)} data-testid="env-vars-add">
              <Plus size={14} aria-hidden /> Add
            </Button>
          </Inline>
        }
      />

      <Card variant="default">
        <CardBody>
          {payload.loading && rows.length === 0 ? (
            <Stack gap={2}>
              <Skeleton style={{ height: 36 }} />
              <Skeleton style={{ height: 36 }} />
            </Stack>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Variable size={28} aria-hidden />}
              title="No env vars"
              description="Add one or bulk-import a .env file."
            />
          ) : (
            <Stack gap={1}>
              {rows.map((r) => {
                const isConfirming = confirmDelete === r.name;
                return (
                  <div
                    key={r.name}
                    data-testid={`env-var-row-${r.name}`}
                    style={{
                      padding: 'var(--space-2)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--border)',
                      background: 'var(--surface-0)',
                    }}
                  >
                    <Inline align="center" justify="between" gap={2}>
                      <Stack gap={0} style={{ minWidth: 0 }}>
                        <code style={{ fontSize: 'var(--fs-12)' }}>{r.name}</code>
                        <code style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{r.value}</code>
                        {r.source && (
                          <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-subtle)' }}>
                            source: {r.source} {r.createdAt ? `· ${r.createdAt}` : ''}
                          </span>
                        )}
                      </Stack>
                      <Inline gap={1}>
                        <Button variant="ghost" onClick={() => setEditing(r.name)} data-testid={`env-var-edit-${r.name}`} aria-label={`Edit ${r.name}`}>
                          <Pencil size={14} aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => setConfirmDelete((cur) => (cur === r.name ? null : r.name))}
                          data-testid={`env-var-delete-${r.name}`}
                          aria-label={`Delete ${r.name}`}
                        >
                          <Trash2 size={14} aria-hidden />
                        </Button>
                      </Inline>
                    </Inline>
                    {isConfirming && (
                      <Inline gap={1} style={{ marginTop: 'var(--space-1)' }}>
                        <Button variant="danger" onClick={() => void drop(r.name)} data-testid={`env-var-confirm-delete-${r.name}`}>
                          Confirm delete
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmDelete(null)} data-testid={`env-var-cancel-delete-${r.name}`}>
                          Cancel
                        </Button>
                      </Inline>
                    )}
                  </div>
                );
              })}
            </Stack>
          )}
        </CardBody>
      </Card>

      <Sheet open={adding} onOpenChange={setAdding}>
        <SheetContent side="right" title="Add env var" description="Must match /^BIZAR_[A-Z0-9_]+$/.">
          <AddEditForm
            mode="add"
            onSubmit={async (name, value) => {
              await fetchJson('/api/env-vars', { method: 'POST', body: { name, value } });
              setAdding(false);
              refresh();
            }}
            onCancel={() => setAdding(false)}
          />
        </SheetContent>
      </Sheet>

      <Sheet open={editing !== null} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <SheetContent side="right" title="Edit env var" description={editing ?? ''}>
          {editing !== null && (
            <AddEditForm
              mode="edit"
              initialName={editing}
              onSubmit={async (name, value) => {
                await fetchJson(`/api/env-vars/${name}`, { method: 'PUT', body: { value } });
                setEditing(null);
                refresh();
              }}
              onCancel={() => setEditing(null)}
            />
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={bulkImporting} onOpenChange={setBulkImporting}>
        <SheetContent side="right" title="Bulk import" description="Paste KEY=value lines (one per line, # comments ignored).">
          <BulkImportForm
            onSubmit={async (envContent) => {
              await fetchJson('/api/env-vars/bulk-import', {
                method: 'POST',
                body: { envContent },
              });
              setBulkImporting(false);
              refresh();
            }}
            onCancel={() => setBulkImporting(false)}
          />
        </SheetContent>
      </Sheet>
    </Stack>
  );
}

function AddEditForm({
  mode,
  initialName,
  onSubmit,
  onCancel,
}: {
  mode: 'add' | 'edit';
  initialName?: string;
  onSubmit: (name: string, value: string) => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [name, setName] = useState<string>(initialName ?? '');
  const [value, setValue] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!name.trim() || !value || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name.trim(), value);
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack gap={3} style={{ padding: 'var(--space-4)' }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Name</span>
        <Input
          value={name}
          readOnly={mode === 'edit'}
          data-testid="env-var-form-name"
          onChange={(e) => setName((e.target as HTMLInputElement).value)}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Value</span>
        <Input
          type="password"
          value={value}
          data-testid="env-var-form-value"
          onChange={(e) => setValue((e.target as HTMLInputElement).value)}
        />
      </label>
      {error !== null && (
        <span role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{error}</span>
      )}
      <Inline justify="end" gap={2}>
        <SheetClose asChild>
          <Button variant="ghost" onClick={onCancel} data-testid="env-var-form-cancel">Cancel</Button>
        </SheetClose>
        <Button
          variant="primary"
          onClick={() => void submit()}
          disabled={busy || !name.trim() || !value}
          data-testid="env-var-form-submit"
        >
          {mode === 'add' ? 'Add' : 'Save'}
        </Button>
      </Inline>
    </Stack>
  );
}

function BulkImportForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (envContent: string) => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [content, setContent] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Stack gap={3} style={{ padding: 'var(--space-4)' }}>
      <textarea
        value={content}
        placeholder={'BIZAR_FOO=bar\nBIZAR_BAZ=qux\n# comment'}
        rows={12}
        data-testid="env-vars-bulk-input"
        onChange={(e) => setContent((e.target as HTMLTextAreaElement).value)}
        style={{
          background: 'var(--surface-0)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-2)',
          color: 'var(--fg)',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-12)',
          resize: 'vertical',
        }}
      />
      {error !== null && (
        <span role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{error}</span>
      )}
      <Inline justify="end" gap={2}>
        <SheetClose asChild>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        </SheetClose>
        <Button
          variant="primary"
          onClick={async () => {
            setBusy(true);
            setError(null);
            try { await onSubmit(content); }
            catch (err) { setError(err instanceof FetchError ? err.message : (err as Error).message); }
            finally { setBusy(false); }
          }}
          disabled={busy || content.trim() === ''}
          data-testid="env-vars-bulk-submit"
        >
          {busy ? 'Importing…' : 'Import'}
        </Button>
      </Inline>
    </Stack>
  );
}