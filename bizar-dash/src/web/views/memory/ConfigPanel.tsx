// src/web/views/memory/ConfigPanel.tsx — global memory config + per-system toggles.
import { useEffect, useState } from 'react';
import {
  Brain,
  Database,
  FileText,
  GitBranch,
  Loader2,
  Plug,
  Save,
  Sparkles,
} from 'lucide-react';
import { Button } from '../../components/Button';
import { Card, CardMeta, CardTitle } from '../../components/Card';
import { Spinner } from '../../components/Spinner';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';

type GlobalConfig = {
  lightrag?: { enabled?: boolean; url?: string; llm?: string; embedding?: string };
  obsidian?: { vaultPath?: string; syncInterval?: number };
  git?: { repoPath?: string; remoteUrl?: string; branch?: string; autoSync?: boolean };
};

type Props = { refreshKey: number };

export function ConfigPanel({ refreshKey }: Props) {
  const toast = useToast();
  const [cfg, setCfg] = useState<GlobalConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tests, setTests] = useState<Array<{ name: string; pass: boolean; detail: string }> | null>(null);
  const [testing, setTesting] = useState(false);

  const reload = async () => {
    setLoading(true);
    try {
      const r = await api.get<{ config: GlobalConfig }>('/memory/config/global');
      setCfg(r.config);
    } catch (err) {
      toast.error(`Config load failed: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const update = (block: keyof GlobalConfig, key: string, value: unknown) => {
    setCfg((cur) => cur ? { ...cur, [block]: { ...(cur[block] || {}), [key]: value } } : cur);
  };

  const onSave = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      await api.put('/memory/config/global', cfg);
      toast.success('Config saved.');
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const onTest = async () => {
    setTesting(true);
    try {
      const r = await api.post<{ ok: boolean; checks: Array<{ name: string; pass: boolean; detail: string }> }>(
        '/memory/test-git',
        {},
      );
      setTests(r.checks);
    } catch (err) {
      toast.error(`Test failed: ${(err as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  if (loading && !cfg) {
    return (
      <div className="view-loading">
        <Spinner size="md" />
        <p>Loading config…</p>
      </div>
    );
  }
  if (!cfg) return <div className="muted">No config available.</div>;

  return (
    <div className="memory-panel-content">
      {/* ── LightRAG ──────────────────────────────────────────────── */}
      <Card>
        <CardTitle><Brain size={14} /> LightRAG</CardTitle>
        <CardMeta>URL + model overrides. Server-side defaults from <code>opencode Zen free tier</code>.</CardMeta>
        <div className="memory-config-form">
          <Row label="Enabled" inline>
            <label className="memory-switch">
              <input
                type="checkbox"
                checked={!!cfg.lightrag?.enabled}
                onChange={(e) => update('lightrag', 'enabled', e.target.checked)}
              />
              <span>{cfg.lightrag?.enabled ? 'on' : 'off'}</span>
            </label>
          </Row>
          <Row label="URL">
            <input
              type="text"
              className="input mono"
              value={cfg.lightrag?.url || ''}
              onChange={(e) => update('lightrag', 'url', e.target.value)}
              placeholder="http://127.0.0.1:9621"
            />
          </Row>
          <Row label="LLM model">
            <input
              type="text"
              className="input mono"
              value={cfg.lightrag?.llm || ''}
              onChange={(e) => update('lightrag', 'llm', e.target.value)}
              placeholder="opencode/gpt-5-nano"
            />
          </Row>
          <Row label="Embedding">
            <input
              type="text"
              className="input mono"
              value={cfg.lightrag?.embedding || ''}
              onChange={(e) => update('lightrag', 'embedding', e.target.value)}
              placeholder="opencode/text-embedding-3-small"
            />
          </Row>
        </div>
      </Card>

      {/* ── Obsidian ──────────────────────────────────────────────── */}
      <Card>
        <CardTitle><FileText size={14} /> Obsidian vault</CardTitle>
        <CardMeta>Path + sync cadence for the markdown vault.</CardMeta>
        <div className="memory-config-form">
          <Row label="Vault path">
            <input
              type="text"
              className="input mono"
              value={cfg.obsidian?.vaultPath || ''}
              onChange={(e) => update('obsidian', 'vaultPath', e.target.value)}
              placeholder="/home/me/vault"
            />
          </Row>
          <Row label="Sync interval (seconds)">
            <input
              type="number"
              min={0}
              max={2592000}
              className="input mono"
              value={cfg.obsidian?.syncInterval ?? 300}
              onChange={(e) => update('obsidian', 'syncInterval', Number(e.target.value))}
            />
          </Row>
        </div>
      </Card>

      {/* ── Git ───────────────────────────────────────────────────── */}
      <Card>
        <CardTitle><GitBranch size={14} /> Git sync</CardTitle>
        <CardMeta>Repo path, remote, branch, and auto-sync toggle.</CardMeta>
        <div className="memory-config-form">
          <Row label="Repo path">
            <input
              type="text"
              className="input mono"
              value={cfg.git?.repoPath || ''}
              onChange={(e) => update('git', 'repoPath', e.target.value)}
              placeholder="/path/to/repo"
            />
          </Row>
          <Row label="Remote URL">
            <input
              type="text"
              className="input mono"
              value={cfg.git?.remoteUrl || ''}
              onChange={(e) => update('git', 'remoteUrl', e.target.value)}
              placeholder="git@github.com:org/repo.git"
            />
          </Row>
          <Row label="Branch">
            <input
              type="text"
              className="input mono"
              value={cfg.git?.branch || 'main'}
              onChange={(e) => update('git', 'branch', e.target.value)}
              placeholder="main"
            />
          </Row>
          <Row label="Auto-sync" inline>
            <label className="memory-switch">
              <input
                type="checkbox"
                checked={!!cfg.git?.autoSync}
                onChange={(e) => update('git', 'autoSync', e.target.checked)}
              />
              <span>{cfg.git?.autoSync ? 'on' : 'off'}</span>
            </label>
          </Row>
        </div>
      </Card>

      {/* ── CCR (placeholder when Headroom is installed) ─────────── */}
      <Card>
        <CardTitle>
          <Sparkles size={14} /> CCR (Compress-Cache-Retrieve)
        </CardTitle>
        <CardMeta>
          Reversible compression for very long conversations. Enabled automatically
          when the Headroom mod is installed.
        </CardMeta>
        <div className="muted text-sm">
          See Settings → Headroom for CCR configuration. This panel will surface
          retention + compression-ratio controls when the mod is active.
        </div>
      </Card>

      {/* ── Test all connections ─────────────────────────────────── */}
      <Card>
        <CardTitle>
          <Plug size={14} /> Connection tests
        </CardTitle>
        <CardMeta>Verify the configured git repo, remote, and path.</CardMeta>
        <div className="memory-action-row">
          <Button variant="secondary" onClick={onTest} disabled={testing}>
            {testing ? <Loader2 size={12} className="memory-spin" /> : <Plug size={12} />}
            Test git connection
          </Button>
          <Button variant="primary" onClick={onSave} disabled={saving}>
            {saving ? <Loader2 size={12} className="memory-spin" /> : <Save size={12} />}
            Save config
          </Button>
        </div>
        {tests && tests.length > 0 && (
          <ul className="memory-check-list" style={{ marginTop: 12 }}>
            {tests.map((t, i) => (
              <li key={i} className="memory-check-row">
                <span className="memory-check-icon">
                  <span className={cn('memory-pill', t.pass ? 'memory-pill-ok' : 'memory-pill-warn')}>
                    {t.pass ? 'OK' : 'FAIL'}
                  </span>
                </span>
                <span className="memory-check-name">{t.name}</span>
                <span className="memory-check-detail muted">{t.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Row({
  label,
  children,
  inline,
}: {
  label: string;
  children: React.ReactNode;
  inline?: boolean;
}) {
  if (inline) {
    return (
      <div className="memory-config-row-inline">
        <div className="memory-config-row-label" id={`cfg-${label.replace(/\s+/g, '-').toLowerCase()}`}>{label}</div>
        <div
          className="memory-config-row-control"
          role="group"
          aria-labelledby={`cfg-${label.replace(/\s+/g, '-').toLowerCase()}`}
        >
          {children}
        </div>
      </div>
    );
  }
  return (
    <label className="memory-config-row-stack">
      <span>{label}</span>
      {children}
    </label>
  );
}

