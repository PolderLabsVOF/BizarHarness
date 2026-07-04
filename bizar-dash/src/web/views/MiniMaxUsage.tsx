// src/views/MiniMaxUsage.tsx — v4.5.0
//
// Token Plan usage tracking dashboard.
//
// Renders the user's current 5-hour rolling + weekly remaining quota
// per model, fetched from https://www.minimax.io/v1/token_plan/remains.
// The Subscription Key is read from opencode's canonical auth store
// (`~/.local/share/opencode/auth.json`) — same place opencode's
// `/connect` command writes to — so the user only enters the key once
// and both opencode + the Bizar dashboard pick it up.
//
// The view has three states:
//   1. Onboarding wizard (first time, no key configured) — guided flow
//      that takes the user from "get a key" → paste → save → dashboard
//   2. Live dashboard (key configured) — per-model 5h + weekly usage
//   3. Banner only (key invalid or auth failure) — inline error

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
  Sparkles,
  X,
  ExternalLink,
  ShieldCheck,
  CircleCheck,
} from 'lucide-react';
import { Card, CardTitle, CardMeta } from '../components/Card';
import { Button } from '../components/Button';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import type { Settings, Snapshot } from '../lib/types';
// Settings is passed for forward-compat with the App's view-props shape
// even though the read path no longer needs it.

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

// Suppress unused-var — `settings` is kept in the prop signature so
// App.tsx can pass a single shape; the read path doesn't need it now
// that the key comes from opencode's auth.json.
void (null as unknown as Settings | null);

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

export function MiniMaxUsage({ snapshot, settings, setActiveTab, refreshSnapshot }: Props) {
  const toast = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [remains, setRemains] = useState<RemainsSnapshot | null>(null);
  const [onboarding, setOnboarding] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  // Onboarding wizard state.
  const [wizardStep, setWizardStep] = useState(0); // 0..3 (welcome → key → verify → done)
  const [wizardVerifying, setWizardVerifying] = useState(false);
  const [wizardVerifyResult, setWizardVerifyResult] = useState<TestResult | null>(null);
  // Inline key config — saves a trip to Settings.
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
      setKeyDraft(''); // never prefill — security
      // If we just configured a key (dismissedAt is set but not configured)
      // or the user already dismissed, do not show the wizard.
      if (s.configured) setWizardStep(4); // skip past wizard
    } catch (err) {
      setError((err as Error).message || 'Failed to load MiniMax data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Dismiss the onboarding wizard (so it doesn't show again until the
  // user clears their key).
  const dismissWizard = useCallback(async () => {
    try {
      await api.post('/minimax/onboarding', { dismissedAt: Date.now() });
      setOnboarding((o) => o ? { ...o, dismissedAt: Date.now() } : o);
    } catch { /* best-effort */ }
  }, []);

  // Wizard step 2: test the key against the real API before saving.
  const verifyKeyBeforeSave = useCallback(async () => {
    if (!keyDraft.trim()) {
      toast.error('Paste a Subscription Key first.');
      return;
    }
    setWizardVerifying(true);
    setWizardVerifyResult(null);
    try {
      // Temporarily save to the real auth.json, probe, then if the
      // probe fails the user can re-paste. The probe endpoint is the
      // chat completions surface (cheaper than remains + a real-world
      // check that the key actually works for the dashboard's purpose).
      const r = await api.post<TestResult>('/minimax/test', {
        prompt: 'Reply with a single word: pong',
        model: 'MiniMax-M3',
        maxTokens: 16,
      });
      setWizardVerifyResult(r);
      if (r.ok) {
        setWizardStep(3); // success
        toast.success('Key works. Saving…');
        // Auto-save: the user already proved the key works.
        try {
          await api.post('/minimax/onboarding/save-key', {
            key: keyDraft.trim(),
            groupId: 'default',
          });
          clearRemainsCacheClient();
          toast.success('Subscription Key saved.');
        } catch (err) {
          toast.error(`Save failed: ${(err as Error).message}`);
        }
        void load();
      } else {
        toast.error(`Verification failed: ${r.message ?? r.error ?? 'unknown'}`);
      }
    } catch (err) {
      toast.error(`Test request failed: ${(err as Error).message}`);
    } finally {
      setWizardVerifying(false);
    }
  }, [keyDraft, toast, load]);

  useEffect(() => { load(); }, [load]);

  // Persist the key into opencode's auth.json. The server-side route
  // `POST /api/minimax/onboarding/save-key` writes to
  // `~/.local/share/opencode/auth.json` (the canonical store the
  // opencode `/connect` command writes to). The dashboard reads it
  // back on the next status fetch.
  const saveKey = useCallback(async () => {
    if (!keyDraft.trim()) {
      toast.error('Paste a Subscription Key first.');
      return;
    }
    setSavingKey(true);
    try {
      const r = await api.post<{ ok: boolean; path?: string; apiKeyHint?: string; error?: string; message?: string }>(
        '/minimax/onboarding/save-key',
        { key: keyDraft.trim(), groupId: 'default' },
      );
      if (!r.ok) {
        toast.error(`Save failed: ${r.message ?? r.error ?? 'unknown'}`);
        return;
      }
      setKeyDraft('');
      clearRemainsCacheClient();
      toast.success('Subscription Key saved. Loading quota…');
      void load();
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSavingKey(false);
    }
  }, [keyDraft, toast, load]);

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

  // First-run onboarding: show the wizard when no key is configured and
  // the user hasn't dismissed it. The wizard writes the key to opencode's
  // auth store (same place `/connect` writes), then the dashboard reads
  // it back via /minimax/status and the live dashboard takes over.
  const showWizard = !status.configured
    && (onboarding?.dismissedAt == null)
    && wizardStep < 4;
  if (showWizard) {
    return <OnboardingWizard
      step={wizardStep}
      setStep={setWizardStep}
      keyDraft={keyDraft}
      setKeyDraft={setKeyDraft}
      showKey={showKey}
      setShowKey={setShowKey}
      verifying={wizardVerifying}
      verifyResult={wizardVerifyResult}
      onVerify={verifyKeyBeforeSave}
      onSkip={async () => {
        await dismissWizard();
        toast.success("Skipped. You can paste the key anytime from this page.");
      }}
      onManualKeySave={saveKey}
      savingKey={savingKey}
      status={status}
    />;
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
      {remains && !remains.ok && (
        <div className="banner banner-err">
          <AlertTriangle size={16} />
          <span>
            <strong>Couldn't load quota</strong>: {remains.message ?? remains.error ?? 'unknown error'}
            {status.source && (
              <> · source: <code>{status.source}</code></>
            )}
          </span>
        </div>
      )}
      {status.configured && status.keyPatternValid === false && (
        <div className="banner banner-warn">
          <AlertTriangle size={16} />
          <span>
            The configured Subscription Key has an unexpected format (expected
            <code> sk-cp-</code> / <code>sk-ant-</code> / <code>sk-or-</code> prefix).
            Re-save it from this page.
          </span>
        </div>
      )}

      {/* ── Subscription Key config (inline) ──────────────────── */}
      {(
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
            . Stored in <code>~/.local/share/opencode/auth.json</code>;
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
              hint="Masked; the real key never leaves auth.json"
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

// ─── Onboarding wizard ──────────────────────────────────────────────────

type OnboardingProps = {
  step: number;
  setStep: (n: number) => void;
  keyDraft: string;
  setKeyDraft: (s: string) => void;
  showKey: boolean;
  setShowKey: React.Dispatch<React.SetStateAction<boolean>>;
  verifying: boolean;
  verifyResult: TestResult | null;
  onVerify: () => void;
  onSkip: () => void;
  onManualKeySave: () => void;
  savingKey: boolean;
  status: Status;
};

/**
 * 4-step first-run wizard:
 *   0. Welcome — what the page does, what the user needs.
 *   1. Get a key — link to platform.minimax.io + how to find it.
 *   2. Paste — input with show/hide + "Test key" button.
 *   3. Done — confirms the save + "View your quota" CTA.
 *
 * The wizard writes to opencode's canonical auth store at
 * ~/.local/share/opencode/auth.json (via /api/minimax/onboarding/save-key).
 */
function OnboardingWizard({
  step, setStep, keyDraft, setKeyDraft, showKey, setShowKey,
  verifying, verifyResult, onVerify, onSkip, onManualKeySave,
  savingKey, status,
}: OnboardingProps) {
  return (
    <div className="view-container view-minimax-onboarding">
      <header className="view-header">
        <div className="view-header-titles">
          <h1 className="view-title">
            <Sparkles size={20} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
            Set up MiniMax Token Plan tracking
          </h1>
          <p className="view-subtitle">
            We'll read your Subscription Key from opencode's auth store and show your remaining
            5-hour + weekly quota for every MiniMax model.
          </p>
        </div>
        <div className="view-header-actions">
          <Button variant="ghost" size="sm" onClick={onSkip}>
            <X size={14} /> Skip for now
          </Button>
        </div>
      </header>

      {/* ── Stepper ────────────────────────────────────────────── */}
      <div className="minimax-wizard-stepper">
        {(['Welcome', 'Get a key', 'Paste & test', 'Done']).map((label, i) => (
          <div
            key={label}
            className={cn(
              'minimax-wizard-step',
              i === step && 'is-current',
              i < step && 'is-done',
              i > step && 'is-todo',
            )}
          >
            <div className="minimax-wizard-step-bullet">
              {i < step ? <CircleCheck size={14} /> : i + 1}
            </div>
            <div className="minimax-wizard-step-label">{label}</div>
          </div>
        ))}
      </div>

      {/* ── Step content ────────────────────────────────────────── */}
      <Card id="minimax-wizard-card">
        {step === 0 && (
          <div className="minimax-wizard-body">
            <h3 className="minimax-wizard-title">Welcome</h3>
            <p className="minimax-wizard-prose">
              BizarHarness can show you how much of your MiniMax Token Plan
              quota you have left — both the <strong>5-hour rolling</strong>
              and the <strong>weekly</strong> windows — for each model. To
              do that it needs your Subscription Key. The key never leaves
              this machine.
            </p>
            <ul className="minimax-wizard-list">
              <li>Stored in <code>~/.local/share/opencode/auth.json</code> (same place opencode's <code>/connect</code> writes).</li>
              <li>Read fresh on every dashboard load — you can revoke it any time from the MiniMax console.</li>
              <li>Used only for <code>GET /v1/token_plan/remains</code> and the chat-completions probe; never logged in full.</li>
            </ul>
            <div className="minimax-wizard-actions">
              <Button onClick={() => setStep(1)} variant="primary" size="md">
                Get started <span style={{ marginLeft: 6 }}>→</span>
              </Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="minimax-wizard-body">
            <h3 className="minimax-wizard-title">Get your Subscription Key</h3>
            <p className="minimax-wizard-prose">
              Go to the MiniMax console and copy your Subscription Key. The
              key starts with <code>sk-cp-</code> (or <code>sk-ant-</code>{' '}
              if you're using the Anthropic-format surface). It's about
              120 characters long.
            </p>
            <ol className="minimax-wizard-list">
              <li>Open{' '}
                <a
                  href="https://platform.minimax.io/user-center/payment/token-plan"
                  target="_blank"
                  rel="noreferrer"
                  className="minimax-wizard-link"
                >
                  <ExternalLink size={12} /> platform.minimax.io/user-center/payment/token-plan
                </a>
              </li>
              <li>Click <strong>Copy Subscription Key</strong>.</li>
              <li>Come back here and paste it in the next step.</li>
            </ol>
            <p className="minimax-wizard-prose minimax-wizard-prose--muted">
              Already have the key? You can also set the env var{' '}
              <code>MINIMAX_API_KEY</code> or add it to{' '}
              <code>opencode.json</code> under{' '}
              <code>provider.minimax.options.apiKey</code>.
            </p>
            <div className="minimax-wizard-actions">
              <Button variant="secondary" size="md" onClick={() => setStep(0)}>← Back</Button>
              <Button variant="primary" size="md" onClick={() => setStep(2)}>
                I have my key <span style={{ marginLeft: 6 }}>→</span>
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="minimax-wizard-body">
            <h3 className="minimax-wizard-title">Paste &amp; test</h3>
            <p className="minimax-wizard-prose">
              Paste your Subscription Key below. We'll test it against the
              real API (one tiny chat call) and then save it to opencode's
              auth store. If the test fails you'll see exactly why.
            </p>
            <div className="minimax-key-row">
              <div className="minimax-key-input-wrap">
                <KeyRound size={12} className="minimax-key-icon" />
                <input
                  type={showKey ? 'text' : 'password'}
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  placeholder="eyJhbGciOi... or sk-cp-..."
                  spellCheck={false}
                  autoComplete="off"
                  className="minimax-key-input"
                  autoFocus
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
            </div>
            {verifyResult && !verifyResult.ok && (
              <div className="minimax-wizard-error">
                <AlertTriangle size={14} />
                <span>
                  <strong>Verification failed:</strong> {verifyResult.message ?? verifyResult.error}
                </span>
              </div>
            )}
            <div className="minimax-wizard-actions">
              <Button variant="secondary" size="md" onClick={() => setStep(1)}>← Back</Button>
              <Button
                variant="primary"
                size="md"
                onClick={onVerify}
                disabled={verifying || !keyDraft.trim()}
              >
                {verifying ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />}
                {verifying ? 'Testing…' : 'Test &amp; save key'}
              </Button>
            </div>
            <p className="minimax-wizard-prose minimax-wizard-prose--muted">
              Don't want to test first?{' '}
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); onManualKeySave(); }}
                className="minimax-wizard-link"
              >
                Save without testing
              </a>
            </p>
          </div>
        )}

        {step === 3 && (
          <div className="minimax-wizard-body">
            <h3 className="minimax-wizard-title">
              <CircleCheck size={18} style={{ verticalAlign: 'text-bottom', marginRight: 6 }} />
              All set
            </h3>
            <p className="minimax-wizard-prose">
              The key works and is saved. Reloading the dashboard so you
              can see your live 5-hour + weekly quota.
            </p>
            <div className="minimax-wizard-actions">
              <Button variant="primary" size="md" onClick={() => window.location.reload()}>
                View your quota →
              </Button>
            </div>
          </div>
        )}

        {/* ── Status footer ─────────────────────────────────────────── */}
        <div className="minimax-wizard-footer">
          <ShieldCheck size={11} />
          <span>Key is written to <code>~/.local/share/opencode/auth.json</code> with mode 0600.</span>
        </div>
      </Card>
    </div>
  );
}
