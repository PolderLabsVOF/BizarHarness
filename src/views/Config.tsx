// src/views/Config.tsx — opencode.json editor with live validation.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Settings2, RefreshCw, Save, FileCode2 } from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { cn, debounce, hashText } from '../lib/utils';
import { JsonHighlight } from '../lib/markdown';
import type { ConfigResponse, Settings, Snapshot } from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

type Parsed = {
  raw: string;
  data: unknown | null;
  error: string | null;
};

export function Config({ snapshot }: Props) {
  const toast = useToast();
  const initial: ConfigResponse | undefined = snapshot.config;
  const [original, setOriginal] = useState<string>(
    initial?.raw || (initial?.data ? JSON.stringify(initial.data, null, 2) : ''),
  );
  const [parsed, setParsed] = useState<Parsed>({
    raw: initial?.raw || '',
    data: initial?.data ?? null,
    error: null,
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [path, setPath] = useState<string>(initial?.path || '');
  const [reloadPending, setReloadPending] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const originalHash = useMemo(() => hashText(original), [original]);

  // Refresh from server
  const reload = async () => {
    try {
      const d = await api.post<ConfigResponse>('/config/reload');
      const raw = d.raw || (d.data ? JSON.stringify(d.data, null, 2) : '');
      setOriginal(raw);
      setParsed({ raw, data: d.data ?? null, error: null });
      setDirty(false);
      setPath(d.path || '');
      toast.info('Config reloaded.', 1500);
    } catch (err) {
      toast.error(`Reload failed: ${(err as Error).message}`);
    }
  };

  const onChange = (val: string) => {
    setParsed((cur) => {
      const next: Parsed = { raw: val, data: cur.data, error: null };
      try {
        next.data = JSON.parse(val);
        next.error = null;
      } catch (e) {
        next.data = null;
        next.error = (e as Error).message;
      }
      return next;
    });
  };

  // Debounce sync of dirty state to avoid setState storms
  const onChangeDebounced = useMemo(
    () =>
      debounce((val: string) => {
        setDirty(hashText(val) !== originalHash);
      }, 100),
    [originalHash],
  );

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    onChange(v);
    onChangeDebounced(v);
  };

  // Warn before navigating away with unsaved changes
  useEffect(() => {
    if (!dirty && !reloadPending) return;
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, reloadPending]);

  const save = async () => {
    if (!parsed.data || parsed.error || saving) return;
    setSaving(true);
    try {
      const result = await api.put<ConfigResponse>('/config', parsed.data);
      const raw = result.raw || JSON.stringify(result.data, null, 2);
      setOriginal(raw);
      setParsed({ raw, data: result.data ?? null, error: null });
      setDirty(false);
      toast.success('Config saved.');
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const canSave = !!parsed.data && !parsed.error && dirty && !saving;

  return (
    <div className="view view-config">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <Settings2 size={18} /> Config
          </h2>
          <p className="view-subtitle mono ellipsis" title={path}>
            {path}
          </p>
        </div>
        <div className="view-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              if (dirty) {
                setReloadPending(true);
                if (
                  // eslint-disable-next-line no-alert
                  confirm('Discard unsaved changes and reload from disk?')
                ) {
                  reload();
                }
                setReloadPending(false);
              } else {
                reload();
              }
            }}
          >
            <RefreshCw size={14} /> Reload from disk
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!canSave}
            onClick={save}
          >
            {saving ? (
              <span className="btn-spinner" />
            ) : (
              <Save size={14} />
            )}
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </header>

      <div className="config-grid">
        <Card>
          <CardTitle>
            <FileCode2 size={14} /> JSON tree
          </CardTitle>
          <CardMeta>Parsed from current editor content</CardMeta>
          <div className="json-tree">
            {parsed.data != null ? (
              <JsonHighlight value={parsed.data} />
            ) : (
              <span className="muted">
                {parsed.error ? 'Invalid JSON' : 'No data'}
              </span>
            )}
          </div>
        </Card>
        <Card>
          <CardTitle>Raw JSON</CardTitle>
          <CardMeta>
            {parsed.error ? (
              <span className="text-error">{parsed.error}</span>
            ) : (
              <span className="muted">Live validation as you type</span>
            )}
          </CardMeta>
          <textarea
            ref={taRef}
            className={cn('textarea config-textarea', parsed.error && 'invalid')}
            spellCheck={false}
            value={parsed.raw}
            onChange={handleInput}
          />
        </Card>
      </div>

      <Card className="diff-card">
        <CardTitle>Diff vs last save</CardTitle>
        <CardMeta>
          {parsed.raw === original
            ? 'No changes.'
            : 'Line-level changes from disk.'}
        </CardMeta>
        <div className="diff-view mono">
          {renderDiff(original, parsed.raw)}
        </div>
      </Card>
    </div>
  );
}

function renderDiff(a: string, b: string) {
  if (a === b) return null;
  const aLines = (a || '').split('\n');
  const bLines = (b || '').split('\n');
  const max = Math.max(aLines.length, bLines.length);
  const out: React.ReactNode[] = [];
  for (let i = 0; i < max; i++) {
    const al = aLines[i] ?? '';
    const bl = bLines[i] ?? '';
    if (al === bl) {
      out.push(
        <div key={i} className="diff-line">
          {al || ' '}
        </div>,
      );
    } else {
      if (al)
        out.push(
          <div key={`a${i}`} className="diff-line diff-line-removed">
            - {al}
          </div>,
        );
      if (bl)
        out.push(
          <div key={`b${i}`} className="diff-line diff-line-added">
            + {bl}
          </div>,
        );
    }
  }
  return out;
}
