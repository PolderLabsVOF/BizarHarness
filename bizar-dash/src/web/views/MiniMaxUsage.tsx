// src/views/MiniMaxUsage.tsx — v4.5.0
//
// Token Plan usage tracking dashboard.
//
// Renders the user's current 5-hour rolling + weekly remaining quota
// per model, fetched from https://www.minimax.io/v1/token_plan/remains.
// The Subscription Key is set inline on this page (no separate Settings
// trip needed) — the value is written to settings.json under
// `minimax.apiKey` and read back on next load.

import { useCallback, useEffect, useState } from 'react';
import {
  Coins,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Send,
  Loader2,
  Calendar,
  Activity,
  Save,
  Eye,
  EyeOff,
} from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import type { Settings, Snapshot } from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

type RemainsModel = {
  model_name: string;
  current_interval_remaining_percent: number;
  current_weekly_remaining_percent: number;
  current_interval_consumed_percent?: number;
  weekly_consumed_percent?: number;
  current_interval_status: number;
  current_weekly_status: number;
  current_interval_total_count: number;
  current_interval_usage_count: number;
  current_weekly_total_count: number;
  current_weekly_usage_count: number;
  endTimeISO?: string;
  weeklyEndTimeISO?: string;
  intervalResetInMs?: number;
  weeklyResetInMs?: number;
  intervalResetInHuman?: string;
  weeklyResetInHuman?: string;
  intervalUsed?: number;
  intervalTotal?: number;
  weeklyUsed?: number;
  weeklyTotal?: number;
};

type RemainsSnapshot = {
  ok: boolean;
  cached?: boolean;
  fetchedAt?: number;
  apiKeyHint?: string;
  groupId?: string;
  baseUrl?: string;
  models?: RemainsModel[];
  baseResp?: { status_code: number; status_msg: string };
  error?: string;
  message?: string;
};

type Status = {
  enabled: boolean;
  configured: boolean;
  apiKeyHint: string;
  groupId: string;
  baseUrl: string;
  chatBaseUrl: string;
  cache: { fetchedAt: number; apiKeyHint: string; modelCount: number } | null;
};

type TestResult = {
  ok: boolean;
  error?: string;
  message?: string;
  model?: string;
  content?: string;
  reasoning?: string;
  finishReason?: string;
  usage?: {
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
  status?: number;
  raw?: unknown;
};

export function MiniMaxUsage({ snapshot, settings, setActiveTab, refreshSnapshot }: Props) {
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [remains, setRemains] = useState<RemainsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  // Inline key config — saves a trip to Settings.
  const [keyDraft, setKeyDraft] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, r] = await Promise.all([
        api.get<Status>('/minimax/status'),
        api.get<RemainsSnapshot>('/minimax/remains'),
      ]);
      setStatus(s);
      setRemains(r);
      setKeyDraft(s.configured ? '' : ''); // never prefill — security
    } catch (err) {
      setError((err as Error).message || 'Failed to load MiniMax data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveKey = useCallback(async () => {
    if (!keyDraft.trim()) {
      toast.error('Paste a Subscription Key first.');
      return;
    }
    setSavingKey(true);
    try {
      const r = await api.put<{ minimax: { apiKey: string } }>('/settings', {
        minimax: {
          ...(settings.minimax || {}),
          apiKey: keyDraft.trim(),
        },
      });
      // Wipe the in-memory draft + clear the remains cache so the
      // next load picks up the new key.
      setKeyDraft('');
      clearRemainsCacheClient();
      toast.success('Subscription Key saved. Refreshing…');
      void load();
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSavingKey(false);
    }
  }, [keyDraft, settings, toast, load]);

  // Clears the on-disk + in-memory cache via the dashboard's
  // /api/minimax/cache DELETE endpoint. Wrapped in a helper so the
  // success path can await the round-trip.
  const clearRemainsCacheClient = useCallback(async () => {
    try { await api.del('/minimax/cache'); } catch { /* best-effort */ }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      await api.post('/minimax/remains/refresh');
      await load();
      toast.success('Refreshed');
    } catch (err) {
      toast.error(`Refresh failed: ${(err as Error).message}`);
    } finally {
      setRefreshing(false);
    }
  }, [load, toast]);

  const sendTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.post<TestResult>('/minimax/test', {
        prompt: 'Reply with a single word: pong',
        model: 'MiniMax-M3',
        maxTokens: 16,
      });
      setTestResult(r);
      if (r.ok) {
        toast.success(`Test ok — used ${r.usage?.total_tokens ?? '?'} tokens`);
      } else {
        toast.error(`Test failed: ${r.message ?? r.error ?? 'unknown'}`);
      }
    } catch (err) {
      toast.error(`Test request failed: ${(err as Error).message}`);
    } finally {
      setTesting(false);
    }
  }, [toast]);

  if (loading && !status) {
    return (
      <div className="view-container">
        <Spinner /> Loading MiniMax data…
      </div>
    );
  }

  if (!status) {
    return (
      <div className="view-container">
        <div className="error-card">
          <AlertTriangle size={20} />
          <div>
            <strong>Couldn't load MiniMax status</strong>
            <pre>{error ?? 'unknown error'}</pre>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="view-container view-minimax-usage">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="view-header">
        <div className="view-header-titles">
          <h1 className="view-title">
            <Coins size={20} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
            MiniMax Token Plan
          </h1>
          <p className="view-subtitle">
            Remaining 5-hour + weekly quota per model. Fetches live from{' '}
            <code>www.minimax.io/v1/token_plan/remains</code>.
          </p>
        </div>
        <div className="view-header-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setActiveTab('settings')}
            title="Configure your Subscription Key"
          >
            <KeyRound size={14} /> {status.configured ? `Key ${status.apiKeyHint}` : 'Add key'}
          </Button>
          <Button variant="secondary" size="sm" onClick={refresh} disabled={refreshing}>
            {refreshing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
            Refresh
          </Button>
        </div>
      </header>

      {/* ── Status banners ─────────────────────────────────────────── */}
      {!status.enabled && (
        <div className="banner banner-warn">
          <AlertTriangle size={16} />
          <span>
            MiniMax integration is <strong>disabled</strong> in settings. Enable it in Settings → MiniMax.
          </span>
        </div>
      )}

      {/* ── Subscription Key config (inline) ──────────────────── */}
      {status.enabled && (
        <Card id="minimax-key">
          <CardTitle>
            <KeyRound size={14} /> Subscription Key
          </CardTitle>
          <CardMeta>
            Get it from{' '}
            <a
              href="https://platform.minimax.io/user-center/payment/token-plan"
              target="_blank"
              rel="noreferrer"
              className="minimax-link"
            >
              platform.minimax.io/user-center/payment/token-plan
            </a>
            . Stored locally in <code>~/.config/bizar/settings.json</code>;
            never sent to any other host. Status:{' '}
            {status.configured ? (
              <strong className="is-ok">configured ({status.apiKeyHint})</strong>
            ) : (
              <strong className="is-warn">not configured</strong>
            )}
            .
          </CardMeta>
          <div className="minimax-key-row">
            <div className="minimax-key-input-wrap">
              <KeyRound size={12} className="minimax-key-icon" />
              <input
                type={showKey ? 'text' : 'password'}
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder={status.configured ? '•••• paste a new key to replace' : 'eyJhbGciOi...'}
                spellCheck={false}
                autoComplete="off"
                className="minimax-key-input"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="minimax-key-toggle"
                aria-label={showKey ? 'Hide key' : 'Show key'}
                title={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
            <Button onClick={saveKey} disabled={savingKey || !keyDraft.trim()} size="sm">
              {savingKey ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
              Save key
            </Button>
          </div>
        </Card>
      )}

      {remains && !remains.ok && (
        <div className="banner banner-err">
          <AlertTriangle size={16} />
          <span>
            <strong>Couldn't load quota</strong>: {remains.message ?? remains.error ?? 'unknown error'}
          </span>
        </div>
      )}

      {/* ── Summary stats ─────────────────────────────────────────── */}
      {remains?.ok && remains.models && (
        <>
          <div className="minimax-stats-row">
            <Stat
              label="Models tracked"
              value={String(remains.models.length)}
              hint="Distinct model quotas returned by the API"
            />
            <Stat
              label="Last fetched"
              value={remains.fetchedAt ? relativeTime(remains.fetchedAt) : '—'}
              hint="Refreshed on demand + every 60s"
            />
            <Stat
              label="Group"
              value={remains.groupId ?? '—'}
              hint="Usually 'default' for an individual team"
            />
            <Stat
              label="API key"
              value={remains.apiKeyHint ?? '—'}
              hint="Masked; the real key never leaves settings.json"
            />
          </div>

          {/* ── Per-model quota cards ──────────────────────────────── */}
          <div className="minimax-models-grid">
            {remains.models.map((m) => (
              <ModelQuotaCard key={m.model_name} model={m} />
            ))}
          </div>
        </>
      )}

      {/* ── Test prompt card ─────────────────────────────────────── */}
      {status.configured && (
        <Card id="minimax-test">
          <CardTitle>
            <Send size={14} /> Test the API key
          </CardTitle>
          <CardMeta>
            Sends a one-shot chat completion to{' '}
            <code>{status.chatBaseUrl}/chat/completions</code> to verify the
            key works and surface live token usage.
          </CardMeta>
          <div className="minimax-test-actions">
            <Button onClick={sendTest} disabled={testing} variant="primary" size="sm">
              {testing ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
              Send test prompt
            </Button>
            <code className="minimax-test-prompt">"Reply with a single word: pong"</code>
          </div>
          {testResult && (
            <div className={cn('minimax-test-result', testResult.ok ? 'ok' : 'err')}>
              {testResult.ok ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
              <div className="minimax-test-body">
                {testResult.ok ? (
                  <>
                    <div className="minimax-test-line">
                      <strong>model:</strong> <code>{testResult.model}</code> ·{' '}
                      <strong>finish:</strong> {testResult.finishReason ?? '—'}
                    </div>
                    {testResult.content && (
                      <div className="minimax-test-content">
                        <code>{testResult.content}</code>
                      </div>
                    )}
                    {testResult.usage && (
                      <div className="minimax-test-usage">
                        <strong>usage:</strong> total{' '}
                        <code>{testResult.usage.total_tokens ?? '?'}</code> · prompt{' '}
                        <code>{testResult.usage.prompt_tokens ?? '?'}</code> · completion{' '}
                        <code>{testResult.usage.completion_tokens ?? '?'}</code>
                        {testResult.usage.prompt_tokens_details?.cached_tokens != null && (
                          <> · cached <code>{testResult.usage.prompt_tokens_details.cached_tokens}</code></>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <pre>{testResult.message ?? testResult.error ?? 'unknown error'}</pre>
                )}
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

function ModelQuotaCard({ model }: { model: RemainsModel }) {
  const fivePct = clamp(model.current_interval_remaining_percent ?? 0, 0, 100);
  const weekPct = clamp(model.current_weekly_remaining_percent ?? 0, 0, 100);
  const fiveConsumed = clamp(100 - fivePct, 0, 100);
  const weekConsumed = clamp(100 - weekPct, 0, 100);
  return (
    <Card id={`minimax-model-${model.model_name}`} className="minimax-model-card">
      <div className="minimax-model-head">
        <div className="minimax-model-name">{model.model_name}</div>
        <div
          className={cn(
            'minimax-model-status',
            fivePct < 25 || weekPct < 25 ? 'is-warn' : 'is-ok'
          )}
        >
          {model.current_interval_status === 1 ? 'active' : 'idle'} ·{' '}
          {model.current_weekly_status === 1 ? 'week active' : 'week idle'}
        </div>
      </div>

      <div className="minimax-quota-rows">
        <QuotaBar
          icon={<Activity size={12} />}
          label="5-hour rolling"
          remainingPct={fivePct}
          consumedPct={fiveConsumed}
          used={model.current_interval_usage_count ?? 0}
          total={model.current_interval_total_count ?? 0}
          resetIn={model.intervalResetInHuman}
          resetISO={model.endTimeISO}
        />
        <QuotaBar
          icon={<Calendar size={12} />}
          label="Weekly"
          remainingPct={weekPct}
          consumedPct={weekConsumed}
          used={model.current_weekly_usage_count ?? 0}
          total={model.current_weekly_total_count ?? 0}
          resetIn={model.weeklyResetInHuman}
          resetISO={model.weeklyEndTimeISO}
        />
      </div>
    </Card>
  );
}

function QuotaBar({
  icon,
  label,
  remainingPct,
  consumedPct,
  used,
  total,
  resetIn,
  resetISO,
}: {
  icon: React.ReactNode;
  label: string;
  remainingPct: number;
  consumedPct: number;
  used: number;
  total: number;
  resetIn?: string;
  resetISO?: string;
}) {
  const tone = remainingPct >= 75 ? 'good' : remainingPct >= 25 ? 'warn' : 'low';
  return (
    <div className={`minimax-quota-row is-${tone}`}>
      <div className="minimax-quota-head">
        <span className="minimax-quota-label">
          {icon} {label}
        </span>
        <span className="minimax-quota-remaining">{remainingPct}% remaining</span>
      </div>
      <div className="minimax-bar">
        <div
          className="minimax-bar-fill"
          style={{ width: `${consumedPct}%` }}
          aria-label={`${consumedPct}% consumed`}
        />
      </div>
      <div className="minimax-quota-meta">
        <span>
          <strong>{used}</strong> / {total || '—'} requests
        </span>
        <span title={resetISO}>
          {resetIn ? `resets in ${resetIn}` : '—'}
        </span>
      </div>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function relativeTime(ts: number): string {
  const ms = Date.now() - ts;
  if (ms < 5_000) return 'just now';
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  return `${Math.floor(ms / 3_600_000)}h ago`;
}
