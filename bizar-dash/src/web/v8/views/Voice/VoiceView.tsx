/**
 * v8/views/Voice/VoiceView.tsx — Sprint S43, v9.3.0.
 *
 * Voice memo list (GET /api/voice/list), per-row audio player
 * (GET /api/voice/:id/audio) + inline-confirm Delete
 * (DELETE /api/voice/:id), and Upload Sheet that POSTs FormData to
 * /api/voice/upload.
 */

import { useCallback, useMemo, useState } from 'react';
import { Mic, Upload, Trash2, RefreshCcw } from 'lucide-react';
import { Stack } from '../../ui/primitives/Stack.js';
import { Inline } from '../../ui/primitives/Inline.js';
import { ViewHeader } from '../../ui/data/ViewHeader.js';
import { Card, CardBody } from '../../ui/data/Card.js';
import { Button } from '../../ui/controls/Button.js';
import { Sheet, SheetContent } from '../../ui/feedback/Sheet.js';
import { Skeleton } from '../../ui/feedback/Skeleton.js';
import { EmptyState } from '../../ui/feedback/EmptyState.js';
import { useFetch } from '../../data/useFetch.js';
import { fetchJson, FetchError } from '../../data/fetcher.js';

interface VoiceMemo {
  id: string;
  filename?: string;
  durationMs?: number;
  createdAt?: string;
  size?: number;
  contentType?: string;
}

export function VoiceView(): JSX.Element {
  const payload = useFetch<{ memos: VoiceMemo[] }>('/api/voice/list');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [uploading, setUploading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const memos = useMemo<VoiceMemo[]>(() => payload.data?.memos ?? [], [payload.data]);
  const refresh = useCallback(() => { void payload.refetch(); }, [payload]);

  const drop = async (id: string): Promise<void> => {
    setError(null);
    try {
      await fetchJson(`/api/voice/${id}`, { method: 'DELETE' });
      setConfirmDelete(null);
      refresh();
    } catch (err) {
      setError(err instanceof FetchError ? err.message : (err as Error).message);
    }
  };

  return (
    <Stack gap={4} data-testid="voice-view">
      <ViewHeader
        title="Voice"
        description="Voice memos. Upload a recording; play it inline."
        actions={
          <Inline align="center" gap={2}>
            {error !== null && (
              <span role="alert" data-testid="voice-error" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>
                {error}
              </span>
            )}
            <Button variant="ghost" onClick={() => void refresh()} data-testid="voice-refresh">
              <RefreshCcw size={14} aria-hidden /> Refresh
            </Button>
            <Button variant="primary" onClick={() => setUploading(true)} data-testid="voice-upload">
              <Upload size={14} aria-hidden /> Upload
            </Button>
          </Inline>
        }
      />

      <Card variant="default">
        <CardBody>
          {payload.loading && memos.length === 0 ? (
            <Stack gap={1}>
              <Skeleton style={{ height: 48 }} />
              <Skeleton style={{ height: 48 }} />
            </Stack>
          ) : memos.length === 0 ? (
            <EmptyState icon={<Mic size={28} aria-hidden />} title="No voice memos" description="Upload a recording to get started." />
          ) : (
            <Stack gap={1}>
              {memos.map((m) => {
                const isConfirming = confirmDelete === m.id;
                return (
                  <div
                    key={m.id}
                    data-testid={`voice-row-${m.id}`}
                    style={{ padding: 'var(--space-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}
                  >
                    <Inline align="center" justify="between" gap={2}>
                      <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
                        <Inline align="center" gap={2}>
                          <strong style={{ fontSize: 'var(--fs-13)' }}>{m.filename || m.id}</strong>
                          {m.durationMs !== undefined && (
                            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                              {(m.durationMs / 1000).toFixed(1)}s
                            </span>
                          )}
                          {m.createdAt && (
                            <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-subtle)' }}>{m.createdAt}</span>
                          )}
                        </Inline>
                        <audio
                          controls
                          preload="none"
                          data-testid={`voice-audio-${m.id}`}
                          src={`/api/voice/${m.id}/audio`}
                          style={{ width: '100%', maxWidth: 480 }}
                        />
                      </Stack>
                      <Button variant="ghost" onClick={() => setConfirmDelete((cur) => (cur === m.id ? null : m.id))} data-testid={`voice-delete-${m.id}`} aria-label={`Delete ${m.id}`}>
                        <Trash2 size={14} aria-hidden />
                      </Button>
                    </Inline>
                    {isConfirming && (
                      <Inline gap={1} style={{ marginTop: 'var(--space-1)' }}>
                        <Button variant="danger" onClick={() => void drop(m.id)} data-testid={`voice-confirm-delete-${m.id}`}>
                          Confirm delete
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                      </Inline>
                    )}
                  </div>
                );
              })}
            </Stack>
          )}
        </CardBody>
      </Card>

      <Sheet open={uploading} onOpenChange={setUploading}>
        <SheetContent side="right" title="Upload voice memo" description="Pick a .wav / .mp3 / .m4a file.">
          <UploadForm
            onSubmit={async (file) => {
              const fd = new FormData();
              fd.append('file', file);
              const r = await fetch('/api/voice/upload', { method: 'POST', body: fd });
              if (!r.ok) throw new Error(`upload failed: ${r.status}`);
              setUploading(false);
              refresh();
            }}
            onCancel={() => setUploading(false)}
          />
        </SheetContent>
      </Sheet>
    </Stack>
  );
}

function UploadForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (file: File) => Promise<void>;
  onCancel: () => void;
}): JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Stack gap={3} style={{ padding: 'var(--space-4)' }}>
      <input
        type="file"
        accept="audio/*"
        data-testid="voice-upload-input"
        onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] ?? null)}
      />
      {error !== null && <span role="alert" style={{ color: 'var(--danger)', fontSize: 'var(--fs-12)' }}>{error}</span>}
      <Inline justify="end" gap={2}>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          disabled={busy || !file}
          data-testid="voice-upload-submit"
          onClick={async () => {
            if (!file) return;
            setBusy(true);
            setError(null);
            try { await onSubmit(file); }
            catch (err) { setError((err as Error).message); setBusy(false); }
          }}
        >
          {busy ? 'Uploading…' : 'Upload'}
        </Button>
      </Inline>
    </Stack>
  );
}