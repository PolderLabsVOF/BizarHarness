// src/views/MiniMaxUsage.tsx — v4.6.0
//
// Full rewrite with two tabs:
//   1. Token Plan — existing 5h + weekly remaining quota (unchanged)
//   2. Usage Analytics — charts, KPIs, per-model breakdown, per-key status
//
// The usage data comes from the JSONL store at ~/.local/share/bizar/usage.jsonl
// (written by minimax.mjs after every chatCompletion / fetchRemains call).
// The Usage Analytics tab is only shown when the key is configured.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  Sparkles,
  X,
  ExternalLink,
  ShieldCheck,
  CircleCheck,
  BarChart2,
} from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { UsageChart } from '../components/UsageChart';
import { UsageTable, type PerModelRow } from '../components/UsageTable';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { cn } from '../lib/utils';

// ─── Types ───────────────────────────────────────────────────────────

type Props = {
  snapshot: unknown;
  settings: unknown;
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
  keySource?: string;
  groupId?: string;
  baseUrl?: string;
  models?: RemainsModel[];
  baseResp?: { status_code: number; status_msg: string };
  error?: string;
  message?: string;
};

type Status = {
  configured: boolean;
  apiKeyHint: string;
  source: string;
  groupId: string;
  tokenBaseUrl: string;
  chatBaseUrl: string;
  knownModels: string[];
  keyPatternValid: boolean | null;
  cache: { fetchedAt: number; apiKeyHint: string; modelCount: number } | null;
};

type OnboardingState = {
  dismissedAt: number | null;
  hiddenModels: string[];
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

// Usage analytics types.
type UsageTotals = {
  requests: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  costEstimate: number;
};

type DailyBucket = {
  date: string;
  requests: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  errors: number;
  avgLatencyMs: number;
};

type PerModelBucket = {
  providerId: string;
  modelId: string;
  requests: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  errors: number;
  avgLatencyMs: number;
};

type PerKeyBucket = {
  keyEnvVar: string;
  isBackup: boolean;
  requests: number;
  errors: number;
  lastUsed: number | null;
  status: 'active' | 'backup';
};

type UsageQueryResult = {
  totals: UsageTotals;
  daily: DailyBucket[];
  perModel: PerModelBucket[];
  perKey: PerKeyBucket[];
  errors: { code: string; message: string; count: number; lastOccurred: number | null }[];
};

type RecentRecord = {
  ts: number;
  providerId: string;
  modelId: string;
  endpoint: string;
  requestId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens: number;
  reasoningTokens: number;
  latencyMs: number;
  finishReason: string | null;
  error: { code: string; message: string } | null;
  keyEnvVar: string;
  isBackup: boolean;
  cached: boolean;
};

type TimeRange = '24h' | '7d' | '30d' | 'custom';

// ─── Main component ────────────────────────────────────────────────────

function MiniMaxUsageInner({ activeTab, setActiveTab }: Props) {
  // Share state between tabs.
  const [view, setView] = useState<'quota' | 'analytics'>('quota');
  const toast = useToast();

  // Load based on active view.
  return (
    <div className="view-container view-minimax-usage">
      {/* Sub-tab switcher */}
      <div className="minimax-sub-tabs">
        <button
          className={cn('minimax-sub-tab', view === 'quota' && 'is-active')}
          onClick={() => setView('quota')}
        >
          <Coins size={13} /> Token Plan
        </button>
        <button
          className={cn('minimax-sub-tab', view === 'analytics' && 'is-active')}
          onClick={() => setView('analytics')}
        >
          <BarChart2 size={13} /> Usage Analytics
        </button>
      </div>

      {view === 'quota'
        ? <QuotaView activeTab={activeTab} setActiveTab={setActiveTab} />
        : <AnalyticsView toast={toast} />
      }
    </div>
  );
}

// ─── Token Plan view (existing functionality) ──────────────────────────

function QuotaView({ activeTab, setActiveTab }: Pick<Props, 'activeTab' | 'setActiveTab'>) {
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [remains, setRemains] = useState<RemainsSnapshot | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardVerifying, setWizardVerifying] = useState(false);
  const [wizardVerifyResult, setWizardVerifyResult] = useState<TestResult | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [savingKey, setSavingKey] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, r, o] = await Promise.all([
        api.get<Status>('/minimax/status'),
        api.get<RemainsSnapshot>('/minimax/remains'),
        api.get<OnboardingState>('/minimax/onboarding'),
      ]);
      setStatus(s);
      setRemains(r);
      setOnboarding(o);
      if (s.configured) setWizardStep(4);
    } catch (err) {
      setError((err as Error).message || 'Failed to load MiniMax data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const dismissWizard = useCallback(async () => {
    try {
      await api.post('/minimax/onboarding', { dismissedAt: Date.now() });
      setOnboarding((o) => o ? { ...o, dismissedAt: Date.now() } : o);
    } catch { /* best-effort */ }
  }, []);

  const verifyKeyBeforeSave = useCallback(async () => {
    if (!keyDraft.trim()) { toast.error('Paste a Subscription Key first.'); return; }
    setWizardVerifying(true);
    setWizardVerifyResult(null);
    try {
      const r = await api.post<TestResult>('/minimax/test', {
        prompt: 'Reply with a single word: pong',
        model: 'MiniMax-M3',
        maxTokens: 16,
      });
      setWizardVerifyResult(r);
      if (r.ok) {
        setWizardStep(3);
        toast.success('Key works. Saving…');
        try {
          await api.post('/minimax/onboarding/save-key', { key: keyDraft.trim(), groupId: 'default' });
          clearRemainsCacheClient();
          toast.success('Subscription Key saved.');
        } catch (err) { toast.error(`Save failed: ${(err as Error).message}`); }
        void load();
      } else {
        toast.error(`Verification failed: ${r.message ?? r.error ?? 'unknown'}`);
      }
    } catch (err) { toast.error(`Test request failed: ${(err as Error).message}`); }
    finally { setWizardVerifying(false); }
  }, [keyDraft, toast, load]);

  const saveKey = useCallback(async () => {
    if (!keyDraft.trim()) { toast.error('Paste a Subscription Key first.'); return; }
    setSavingKey(true);
    try {
      const r = await api.post<{ ok: boolean; path?: string; apiKeyHint?: string; error?: string; message?: string }>(
        '/minimax/onboarding/save-key', { key: keyDraft.trim(), groupId: 'default' },
      );
      if (!r.ok) { toast.error(`Save failed: ${r.message ?? r.error ?? 'unknown'}`); return; }
      setKeyDraft('');
      clearRemainsCacheClient();
      toast.success('Subscription Key saved. Loading quota…');
      void load();
    } catch (err) { toast.error(`Save failed: ${(err as Error).message}`); }
    finally { setSavingKey(false); }
  }, [keyDraft, toast, load]);

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
    } catch (err) { toast.error(`Refresh failed: ${(err as Error).message}`); }
    finally { setRefreshing(false); }
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
      if (r.ok) toast.success(`Test ok — used ${r.usage?.total_tokens ?? '?'} tokens`);
      else toast.error(`Test failed: ${r.message ?? r.error ?? 'unknown'}`);
    } catch (err) { toast.error(`Test request failed: ${(err as Error).message}`); }
    finally { setTesting(false); }
  }, [toast]);

  if (loading && !status) {
    return <div className="view-container"><Spinner /> Loading MiniMax data…</div>;
  }
  if (!status) {
    return (
      <div className="view-container">
        <div className="error-card">
          <AlertTriangle size={20} />
          <div><strong>Couldn't load MiniMax status</strong><pre>{error ?? 'unknown error'}</pre></div>
        </div>
      </div>
    );
  }

  const showWizard = !status.configured && (onboarding?.dismissedAt == null) && wizardStep < 4;
  if (showWizard) {
    return <OnboardingWizard
      step={wizardStep} setStep={setWizardStep}
      keyDraft={keyDraft} setKeyDraft={setKeyDraft}
      showKey={showKey} setShowKey={setShowKey}
      verifying={wizardVerifying} verifyResult={wizardVerifyResult}
      onVerify={verifyKeyBeforeSave}
      onSkip={async () => { await dismissWizard(); toast.success("Skipped."); }}
      onManualKeySave={saveKey} savingKey={savingKey} status={status}
    />;
  }

  return (
    <>
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
          <Button variant="secondary" size="sm" onClick={() => setActiveTab('settings')} title="Configure your Subscription Key">
            <KeyRound size={14} /> {status.configured ? `Key ${status.apiKeyHint}` : 'Add key'}
          </Button>
          <Button variant="secondary" size="sm" onClick={refresh} disabled={refreshing}>
            {refreshing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Refresh
          </Button>
        </div>
      </header>

      {remains && !remains.ok && (
        <div className="banner banner-err">
          <AlertTriangle size={16} />
          <span><strong>Couldn't load quota</strong>: {remains.message ?? remains.error ?? 'unknown error'}</span>
        </div>
      )}

      {remains?.ok && remains.models && (
        <>
          <div className="minimax-stats-row">
            <Stat label="Models tracked" value={String(remains.models.length)} hint="Distinct model quotas returned by the API" />
            <Stat label="Last fetched" value={remains.fetchedAt ? relativeTime(remains.fetchedAt) : '—'} hint="Refreshed on demand + every 60s" />
            <Stat label="Group" value={remains.groupId ?? '—'} hint="Usually 'default' for an individual team" />
            <Stat label="API key" value={remains.apiKeyHint ?? '—'} hint="Masked; the real key never leaves auth.json" />
          </div>
          <div className="minimax-models-grid">
            {remains.models.map((m) => <ModelQuotaCard key={m.model_name} model={m} />)}
          </div>
        </>
      )}

      {status.configured && (
        <Card id="minimax-test">
          <CardTitle><Send size={14} /> Test the API key</CardTitle>
          <CardMeta>One-shot chat completion to <code>{status.chatBaseUrl}/chat/completions</code>.</CardMeta>
          <div className="minimax-test-actions">
            <Button onClick={sendTest} disabled={testing} variant="primary" size="sm">
              {testing ? <Loader2 size={14} className="spin" /> : <Send size={14} />} Send test prompt
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
                      <div className="minimax-test-content"><code>{testResult.content}</code></div>
                    )}
                    {testResult.usage && (
                      <div className="minimax-test-usage">
                        <strong>usage:</strong> total <code>{testResult.usage.total_tokens ?? '?'}</code> · prompt{' '}
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
    </>
  );
}

// ─── Analytics view ────────────────────────────────────────────────────

function AnalyticsView({ toast }: { toast: ReturnType<typeof useToast> }) {
  const [range, setRange] = useState<TimeRange>('24h');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState<UsageQueryResult | null>(null);
  const [recent, setRecent] = useState<RecentRecord[]>([]);
  const [sortKey, setSortKey] = useState('requests');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (r: TimeRange, fromMs?: number, toMs?: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ range: r });
      if (r === 'custom' && fromMs && toMs) {
        params.set('from', String(fromMs));
        params.set('to', String(toMs));
      }
      const [u, rec] = await Promise.all([
        api.get<UsageQueryResult>(`/usage?${params.toString()}`),
        api.get<{ records: RecentRecord[]; total: number; returned: number }>('/usage/recent?limit=20'),
      ]);
      setUsage(u);
      setRecent(rec.records);
    } catch (err) {
      toast.error(`Failed to load usage data: ${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (range === 'custom') {
      const from = customFrom ? new Date(customFrom).getTime() : Date.now() - 7 * 86_400_000;
      const to   = customTo   ? new Date(customTo).getTime()   : Date.now();
      void load('custom', from, to);
    } else {
      void load(range);
    }
  }, [range, load]);

  const handleSort = useCallback((key: string) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('desc'); }
  }, [sortKey]);

  const sortedModels = useMemo(() => {
    if (!usage?.perModel) return [];
    return [...usage.perModel].sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey] ?? 0;
      const bv = (b as Record<string, unknown>)[sortKey] ?? 0;
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [usage?.perModel, sortKey, sortDir]);

  const chartSeries = useMemo(() => {
    if (!usage?.daily) return { labels: [] as string[], requests: [] as number[], tokens: [] as number[] };
    return {
      labels:   usage.daily.map(d => d.date.slice(5)), // "MM-DD"
      requests: usage.daily.map(d => d.requests),
      tokens:   usage.daily.map(d => d.totalTokens),
    };
  }, [usage?.daily]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load(range === 'custom' ? 'custom' : range,
      range === 'custom' && customFrom ? new Date(customFrom).getTime() : undefined,
      range === 'custom' && customTo   ? new Date(customTo).getTime()   : undefined);
    setRefreshing(false);
  }, [load, range, customFrom, customTo]);

  if (loading && !usage) {
    return <div className="view-container"><Spinner /> Loading usage data…</div>;
  }

  const t = usage?.totals;
  const errors = usage?.errors ?? [];
  const perKey = usage?.perKey ?? [];

  return (
    <>
      {/* Header */}
      <header className="view-header">
        <div className="view-header-titles">
          <h1 className="view-title">
            <BarChart2 size={20} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
            Usage Analytics
          </h1>
          <p className="view-subtitle">
            Aggregated from <code>~/.local/share/bizar/usage.jsonl</code> —
            every chatCompletion and fetchRemains call.
          </p>
        </div>
        <div className="view-header-actions">
          <Button variant="secondary" size="sm" onClick={refresh} disabled={refreshing}>
            {refreshing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Refresh
          </Button>
        </div>
      </header>

      {/* Time range selector */}
      <div className="usage-time-range">
        {(['24h', '7d', '30d', 'custom'] as TimeRange[]).map(r => (
          <button
            key={r}
            className={cn('usage-range-chip', range === r && 'is-active')}
            onClick={() => setRange(r)}
          >
            {r === 'custom' ? 'Custom' : r.toUpperCase()}
          </button>
        ))}
        {range === 'custom' && (
          <div className="usage-custom-dates">
            <label htmlFor="usage-from-date" className="sr-only">From date</label>
            <input
              id="usage-from-date"
              type="date"
              className="usage-date-input"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              aria-label="From date"
            />
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }} aria-hidden>to</span>
            <label htmlFor="usage-to-date" className="sr-only">To date</label>
            <input
              id="usage-to-date"
              type="date"
              className="usage-date-input"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              aria-label="To date"
            />
          </div>
        )}
      </div>

      {/* KPI row */}
      <div className="usage-kpi-row">
        <KpiCard
          label="Total Requests"
          value={t?.requests.toLocaleString() ?? '—'}
          sub={t ? `${t.errors} errors` : undefined}
          tone={t && t.errors > t.requests * 0.1 ? 'warn' : undefined}
        />
        <KpiCard
          label="Total Tokens"
          value={t ? (t.totalTokens >= 1000 ? `${Math.round(t.totalTokens / 1000)}k` : String(t.totalTokens)) : '—'}
          sub={t ? `${t.promptTokens.toLocaleString()} prompt · ${t.completionTokens.toLocaleString()} completion` : undefined}
        />
        <KpiCard
          label="Errors"
          value={String(t?.errors ?? '—')}
          sub={errors.length > 0 ? `${errors[0].code}: ${errors[0].count}` : undefined}
          tone={t && t.errors > 0 ? 'err' : undefined}
        />
        <KpiCard
          label="Avg Latency"
          value={t?.avgLatencyMs != null ? `${t.avgLatencyMs}ms` : '—'}
          sub={t?.p95LatencyMs != null ? `p95 ${t.p95LatencyMs}ms` : undefined}
        />
        <KpiCard
          label="Est. Cost"
          value={t?.costEstimate != null && t.costEstimate > 0 ? `$${t.costEstimate.toFixed(4)}` : '—'}
          sub="approximate USD"
          tone={undefined}
        />
      </div>

      {/* Chart */}
      <Card className="usage-chart-card">
        <div className="usage-chart-wrap">
          <UsageChart series={chartSeries} height={280} />
        </div>
        <div className="usage-legend">
          <div className="usage-legend-item">
            <div className="usage-legend-bar" style={{ background: 'var(--accent)' }} />
            <span>Requests (bar)</span>
          </div>
          <div className="usage-legend-item">
            <div className="usage-legend-line" style={{ background: 'var(--warning, #d29922)' }} />
            <span>Tokens (line)</span>
          </div>
        </div>
      </Card>

      {/* Per-model table */}
      <Card>
        <CardTitle>Per-model breakdown</CardTitle>
        <UsageTable
          rows={sortedModels as PerModelRow[]}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
        />
      </Card>

      {/* Per-key status */}
      {perKey.length > 0 && (
        <Card>
          <CardTitle>API Keys</CardTitle>
          <div className="usage-key-row">
            {perKey.map(k => (
              <span
                key={k.keyEnvVar}
                className={cn('usage-key-badge', k.isBackup ? 'is-backup' : 'is-active')}
              >
                <span className="usage-key-dot" />
                {k.keyEnvVar}
                {k.isBackup ? ' (backup)' : ' (active)'}
                {' · '}
                {k.requests} req
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Recent activity */}
      {recent.length > 0 && (
        <Card>
          <CardTitle>Recent activity</CardTitle>
          <div className="usage-recent-list">
            {recent.map((r, i) => (
              <div key={`${r.requestId}-${i}`} className={cn('usage-recent-item', r.error && 'is-err')}>
                <span className="usage-recent-time">
                  {new Date(r.ts).toLocaleTimeString()}
                </span>
                <span className="usage-recent-model">
                  <code>{r.modelId}</code>
                </span>
                <span className="usage-recent-tokens">
                  {r.totalTokens.toLocaleString()} tok
                </span>
                <span className="usage-recent-latency">
                  {r.latencyMs}ms
                </span>
                <span className="usage-recent-endpoint">{r.endpoint}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

// ─── Kpi card ──────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'warn' | 'err' | 'ok' }) {
  return (
    <div className="usage-kpi-card">
      <div className="usage-kpi-label">{label}</div>
      <div className={cn('usage-kpi-value', tone && `is-${tone}`)}>{value}</div>
      {sub && <div className="usage-kpi-sub">{sub}</div>}
    </div>
  );
}

// ─── Sub-components (quota view) ───────────────────────────────────────

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
        <div className={cn('minimax-model-status', fivePct < 25 || weekPct < 25 ? 'is-warn' : 'is-ok')}>
          {model.current_interval_status === 1 ? 'active' : 'idle'} ·{' '}
          {model.current_weekly_status === 1 ? 'week active' : 'week idle'}
        </div>
      </div>
      <div className="minimax-quota-rows">
        <QuotaBar
          icon={<Activity size={12} />} label="5-hour rolling"
          remainingPct={fivePct} consumedPct={fiveConsumed}
          used={model.current_interval_usage_count ?? 0} total={model.current_interval_total_count ?? 0}
          resetIn={model.intervalResetInHuman} resetISO={model.endTimeISO}
        />
        <QuotaBar
          icon={<Calendar size={12} />} label="Weekly"
          remainingPct={weekPct} consumedPct={weekConsumed}
          used={model.current_weekly_usage_count ?? 0} total={model.current_weekly_total_count ?? 0}
          resetIn={model.weeklyResetInHuman} resetISO={model.weeklyEndTimeISO}
        />
      </div>
    </Card>
  );
}

function QuotaBar({ icon, label, remainingPct, consumedPct, used, total, resetIn, resetISO }: {
  icon: React.ReactNode; label: string; remainingPct: number; consumedPct: number;
  used: number; total: number; resetIn?: string; resetISO?: string;
}) {
  const tone = remainingPct >= 75 ? 'good' : remainingPct >= 25 ? 'warn' : 'low';
  return (
    <div className={`minimax-quota-row is-${tone}`}>
      <div className="minimax-quota-head">
        <span className="minimax-quota-label">{icon} {label}</span>
        <span className="minimax-quota-remaining">{remainingPct}% remaining</span>
        <span className="minimax-quota-consumed">· {consumedPct}% used</span>
      </div>
      <div className="minimax-bar">
        <div className="minimax-bar-fill" style={{ width: `${consumedPct}%` }} aria-label={`${consumedPct}% consumed`} />
      </div>
      <div className="minimax-quota-meta">
        <span><strong>{used}</strong> / {total || '—'} requests</span>
        <span title={resetISO}>{resetIn ? `resets in ${resetIn}` : '—'}</span>
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

// ─── Onboarding wizard ─────────────────────────────────────────────────

type OnboardingProps = {
  step: number; setStep: (n: number) => void;
  keyDraft: string; setKeyDraft: (s: string) => void;
  showKey: boolean; setShowKey: React.Dispatch<React.SetStateAction<boolean>>;
  verifying: boolean; verifyResult: TestResult | null;
  onVerify: () => void; onSkip: () => void; onManualKeySave: () => void;
  savingKey: boolean; status: Status;
};

function OnboardingWizard({ step, setStep, keyDraft, setKeyDraft, showKey, setShowKey, verifying, verifyResult, onVerify, onSkip, onManualKeySave, savingKey, status }: OnboardingProps) {
  return (
    <div className="view-container view-minimax-onboarding">
      <header className="view-header">
        <div className="view-header-titles">
          <h1 className="view-title">
            <Sparkles size={20} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
            Set up MiniMax Token Plan tracking
          </h1>
          <p className="view-subtitle">We'll read your Subscription Key and show your remaining quota.</p>
        </div>
        <div className="view-header-actions">
          <Button variant="ghost" size="sm" onClick={onSkip}><X size={14} /> Skip for now</Button>
        </div>
      </header>

      <div className="minimax-wizard-stepper">
        {(['Welcome', 'Get a key', 'Paste & test', 'Done']).map((label, i) => (
          <div key={label} className={cn('minimax-wizard-step', i === step && 'is-current', i < step && 'is-done', i > step && 'is-todo')}>
            <div className="minimax-wizard-step-bullet">{i < step ? <CircleCheck size={14} /> : i + 1}</div>
            <div className="minimax-wizard-step-label">{label}</div>
          </div>
        ))}
      </div>

      <Card id="minimax-wizard-card">
        {step === 0 && (
          <div className="minimax-wizard-body">
            <h3 className="minimax-wizard-title">Welcome</h3>
            <p className="minimax-wizard-prose">
              BizarHarness shows you how much of your MiniMax Token Plan quota you have left —
              both the <strong>5-hour rolling</strong> and <strong>weekly</strong> windows.
            </p>
            <ul className="minimax-wizard-list">
              <li>Stored in <code>~/.local/share/cline/auth.json</code>.</li>
              <li>Read fresh on every dashboard load.</li>
              <li>Never logged in full.</li>
            </ul>
            <div className="minimax-wizard-actions">
              <Button onClick={() => setStep(1)} variant="primary" size="md">Get started <span style={{ marginLeft: 6 }}>→</span></Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="minimax-wizard-body">
            <h3 className="minimax-wizard-title">Get your Subscription Key</h3>
            <p className="minimax-wizard-prose">Go to the MiniMax console and copy your Subscription Key.</p>
            <ol className="minimax-wizard-list">
              <li>Open <a href="https://platform.minimax.io/user-center/payment/token-plan" target="_blank" rel="noreferrer" className="minimax-wizard-link"><ExternalLink size={12} /> platform.minimax.io</a></li>
              <li>Click <strong>Copy Subscription Key</strong>.</li>
              <li>Come back here and paste it.</li>
            </ol>
            <div className="minimax-wizard-actions">
              <Button variant="secondary" size="md" onClick={() => setStep(0)}>← Back</Button>
              <Button variant="primary" size="md" onClick={() => setStep(2)}>I have my key <span style={{ marginLeft: 6 }}>→</span></Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="minimax-wizard-body">
            <h3 className="minimax-wizard-title">Paste &amp; test</h3>
            <p className="minimax-wizard-prose">Paste your key below. We'll test it against the real API before saving.</p>
            <div className="minimax-key-row">
              <div className="minimax-key-input-wrap">
                <KeyRound size={12} className="minimax-key-icon" aria-hidden />
                <label htmlFor="minimax-key-input" className="sr-only">Subscription Key</label>
                <input
                  id="minimax-key-input"
                  type={showKey ? 'text' : 'password'}
                  value={keyDraft}
                  onChange={e => setKeyDraft(e.target.value)}
                  placeholder="sk-cp-..."
                  spellCheck={false}
                  autoComplete="off"
                  className="minimax-key-input"
                  autoFocus
                  aria-label="Subscription Key"
                />
                <button type="button" onClick={() => setShowKey(v => !v)} className="minimax-key-toggle" aria-label={showKey ? 'Hide key' : 'Show key'}>
                  {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>
            {verifyResult && !verifyResult.ok && (
              <div className="minimax-wizard-error"><AlertTriangle size={14} /><span><strong>Verification failed:</strong> {verifyResult.message ?? verifyResult.error}</span></div>
            )}
            <div className="minimax-wizard-actions">
              <Button variant="secondary" size="md" onClick={() => setStep(1)}>← Back</Button>
              <Button variant="primary" size="md" onClick={onVerify} disabled={verifying || !keyDraft.trim()}>
                {verifying ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />}
                {verifying ? 'Testing…' : 'Test &amp; save key'}
              </Button>
            </div>
            <p className="minimax-wizard-prose minimax-wizard-prose--muted">
              Don't want to test first? <a href="#" onClick={e => { e.preventDefault(); onManualKeySave(); }} className="minimax-wizard-link">Save without testing</a>
            </p>
          </div>
        )}

        {step === 3 && (
          <div className="minimax-wizard-body">
            <h3 className="minimax-wizard-title"><CircleCheck size={18} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />All set</h3>
            <p className="minimax-wizard-prose">The key works and is saved. Reloading so you can see your live quota.</p>
            <div className="minimax-wizard-actions">
              <Button variant="primary" size="md" onClick={() => window.location.reload()}>View your quota →</Button>
            </div>
          </div>
        )}

        <div className="minimax-wizard-footer">
          <ShieldCheck size={11} />
          <span>Key written to <code>~/.local/share/cline/auth.json</code> with mode 0600.</span>
        </div>
      </Card>
    </div>
  );
}
export const MiniMaxUsage = React.memo(MiniMaxUsageInner);
