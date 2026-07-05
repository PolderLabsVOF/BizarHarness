// src/views/Providers.tsx — v3.7.0 provider management: list, add, edit, delete.
import { useEffect, useState } from 'react';
import {
  Cloud,
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Server,
} from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { StatusBadge } from '../components/StatusBadge';
import { useModal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import type { Provider, Settings, Snapshot } from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

type ProviderWithMeta = Provider & {
  _expanded?: boolean;
  _loading?: boolean;
};

export function Providers({ snapshot, settings, refreshSnapshot }: Props) {
  const toast = useToast();
  const modal = useModal();
  const [providers, setProviders] = useState<(ProviderWithMeta)[]>(snapshot.providers || []);
  const [loading, setLoading] = useState(false);
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});

  // Detect active provider from defaultModel (e.g. "anthropic/claude-3-5-sonnet" → "anthropic")
  const defaultProviderId = (settings.defaultModel || '').split('/')[0];

  const reload = async () => {
    setLoading(true);
    try {
      const data = await api.get<{ providers: Provider[] }>('/providers');
      setProviders(Array.isArray(data.providers) ? data.providers : []);
    } catch {
      // Fall back to snapshot data
      setProviders(snapshot.providers || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (snapshot.providers) setProviders(snapshot.providers);
  }, [snapshot.providers]);

  const activeProvider = providers.find(
    (p) => p.id === defaultProviderId || p.name.toLowerCase() === defaultProviderId,
  );

  const openAddModal = () => {
    let nameEl: HTMLInputElement | null = null;
    let urlEl: HTMLInputElement | null = null;
    let keyEl: HTMLInputElement | null = null;
    let modelsEl: HTMLTextAreaElement | null = null;

    modal.open({
      title: 'Add Provider',
      children: (
        <div className="provider-form">
          <label className="field-label" htmlFor="provider-new-name">Provider name</label>
          <input id="provider-new-name" ref={(el) => { nameEl = el; }} className="input" type="text" placeholder="e.g. Anthropic, OpenAI" autoFocus />
          <label className="field-label" htmlFor="provider-new-url">Base URL</label>
          <input id="provider-new-url" ref={(el) => { urlEl = el; }} className="input" type="text" placeholder="https://api.openai.com/v1" />
          <label className="field-label" htmlFor="provider-new-key">API Key</label>
          <input id="provider-new-key" ref={(el) => { keyEl = el; }} className="input" type="password" placeholder="sk-..." />
          <label className="field-label" htmlFor="provider-new-models">Models (one per line)</label>
          <textarea id="provider-new-models" ref={(el) => { modelsEl = el; }} className="input" rows={4} placeholder="gpt-4o&#10;gpt-4o-mini&#10;..." />
        </div>
      ),
      footer: (
        <div className="modal-footer-actions">
          <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
          <Button variant="primary" onClick={async () => {
            const nameVal = (nameEl?.value || '').trim();
            const urlVal = (urlEl?.value || '').trim();
            const keyVal = (keyEl?.value || '').trim();
            const modelsVal = (modelsEl?.value || '').split('\n').map((m) => m.trim()).filter(Boolean);
            if (!nameVal || !urlVal) { toast.error('Name and base URL are required.'); return; }
            try {
              const created = await api.post<Provider>('/providers', { name: nameVal, baseURL: urlVal, apiKey: keyVal, models: modelsVal, enabled: true });
              setProviders((cur) => [...cur, created]);
              toast.success(`Provider "${nameVal}" added.`);
              modal.close();
            } catch (err) {
              toast.error(`Add failed: ${(err as Error).message}`);
            }
          }}>Add Provider</Button>
        </div>
      ),
    });
  };

  const openEditModal = (provider: Provider) => {
    let nameEl: HTMLInputElement | null = null;
    let urlEl: HTMLInputElement | null = null;
    let keyEl: HTMLInputElement | null = null;
    let modelsEl: HTMLTextAreaElement | null = null;

    modal.open({
      title: `Edit "${provider.name}"`,
      children: (
        <div className="provider-form">
          <label className="field-label" htmlFor="provider-edit-name">Provider name</label>
          <input id="provider-edit-name" ref={(el) => { nameEl = el; }} className="input" type="text" defaultValue={provider.name} />
          <label className="field-label" htmlFor="provider-edit-url">Base URL</label>
          <input id="provider-edit-url" ref={(el) => { urlEl = el; }} className="input" type="text" defaultValue={provider.baseURL} />
          <label className="field-label" htmlFor="provider-edit-key">API Key (leave blank to keep current)</label>
          <input id="provider-edit-key" ref={(el) => { keyEl = el; }} className="input" type="password" placeholder="sk-..." />
          <label className="field-label" htmlFor="provider-edit-models">Models (one per line)</label>
          <textarea id="provider-edit-models" ref={(el) => { modelsEl = el; }} className="input" rows={4} defaultValue={(provider.models || []).join('\n')} />
        </div>
      ),
      footer: (
        <div className="modal-footer-actions">
          <Button variant="ghost" onClick={() => modal.close()}>Cancel</Button>
          <Button variant="primary" onClick={async () => {
            const modelsVal = (modelsEl?.value || '').split('\n').map((m) => m.trim()).filter(Boolean);
            const payload: Partial<Provider> = {
              name: (nameEl?.value || '').trim(),
              baseURL: (urlEl?.value || '').trim(),
              models: modelsVal,
            };
            if (keyEl?.value.trim()) payload.apiKey = keyEl.value.trim();
            try {
              const updated = await api.patch<Provider>(`/providers/${encodeURIComponent(provider.id)}`, payload);
              setProviders((cur) => cur.map((p) => (p.id === provider.id ? { ...p, ...updated } : p)));
              toast.success(`Provider "${updated.name}" updated.`);
              modal.close();
            } catch (err) {
              toast.error(`Update failed: ${(err as Error).message}`);
            }
          }}>Save Changes</Button>
        </div>
      ),
    });
  };

  const deleteProvider = async (provider: Provider) => {
    if (!confirm(`Delete provider "${provider.name}"? This cannot be undone.`)) return;
    try {
      await api.del(`/providers/${encodeURIComponent(provider.id)}`);
      setProviders((cur) => cur.filter((p) => p.id !== provider.id));
      toast.success(`Provider "${provider.name}" deleted.`);
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`);
    }
  };

  const toggleExpand = (id: string) => {
    setProviders((cur) =>
      cur.map((p) => (p.id === id ? { ...p, _expanded: !p._expanded } : p)),
    );
  };

  return (
    <div className="view view-providers">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <Cloud size={18} /> Providers ({providers.length})
          </h2>
          <p className="view-subtitle">
            Configure model providers and their available models.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button variant="ghost" size="sm" onClick={reload} title="Refresh" aria-label="Refresh providers">
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </Button>
          <Button variant="accent" size="sm" onClick={openAddModal}>
            <Plus size={14} /> Add Provider
          </Button>
        </div>
      </header>

      {/* Active Provider */}
      {activeProvider && (
        <Card className="provider-active-card">
          <CardTitle>
            <Server size={14} /> Active Provider
          </CardTitle>
          <div className="provider-active-body">
            <div className="provider-active-name">{activeProvider.name}</div>
            <div className="provider-active-model muted text-sm">
              Model: <code>{settings.defaultModel}</code>
            </div>
            {activeProvider.baseURL && (
              <div className="provider-active-url muted text-sm">
                {activeProvider.baseURL}
              </div>
            )}
            <div className="provider-active-models text-sm">
              {activeProvider.models?.length ? (
                <span>{activeProvider.models.length} model{activeProvider.models.length !== 1 ? 's' : ''} configured</span>
              ) : (
                <span className="muted">No models listed</span>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Provider list */}
      {loading ? (
        <div className="view-loading"><Spinner size="lg" /></div>
      ) : providers.length === 0 ? (
        <EmptyState
          icon={<Cloud size={32} />}
          title="No providers configured"
          message="Add a provider to get started. Providers define the base URL and API key for accessing models."
          action={
            <div className="empty-state-actions">
              <Button variant="accent" onClick={openAddModal}>
                <Plus size={14} /> Add Provider
              </Button>
            </div>
          }
        />
      ) : (
        <div className="provider-grid">
          {providers.map((provider) => (
            <Card key={provider.id} className={cn('provider-card', !provider.enabled && 'provider-card-disabled')}>
              <div className="provider-card-head">
                <div className="provider-card-meta">
                  <div className="provider-card-name">
                    <Cloud size={14} />
                    {provider.name}
                  </div>
                  <div className="provider-card-url muted text-sm">{provider.baseURL}</div>
                </div>
                <div className="provider-card-actions">
                  <StatusBadge kind={provider.enabled ? 'success' : 'info'}>
                    {provider.enabled ? 'active' : 'inactive'}
                  </StatusBadge>
                </div>
              </div>

              <div className="provider-card-stats">
                <span className="text-sm">
                  {provider.models?.length ?? 0} model{(provider.models?.length ?? 0) !== 1 ? 's' : ''}
                </span>
                {provider.id === defaultProviderId && (
                  <StatusBadge kind="accent">default</StatusBadge>
                )}
              </div>

              {/* Expandable models list */}
              {(provider.models?.length ?? 0) > 0 && (
                <div className="provider-models-section">
                  <button
                    type="button"
                    className="provider-models-toggle text-sm"
                    onClick={() => toggleExpand(provider.id)}
                  >
                    {provider._expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    {provider._expanded ? 'Hide models' : `Show ${provider.models!.length} model${provider.models!.length !== 1 ? 's' : ''}`}
                  </button>
                  {provider._expanded && (
                    <ul className="provider-models-list">
                      {provider.models!.map((model) => (
                        <li key={model} className="provider-model-item">
                          <code>{model}</code>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="provider-card-footer">
                <Button variant="ghost" size="sm" onClick={() => openEditModal(provider)}>
                  <Pencil size={12} /> Edit
                </Button>
                <Button variant="danger" size="sm" onClick={() => deleteProvider(provider)}>
                  <Trash2 size={12} /> Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
