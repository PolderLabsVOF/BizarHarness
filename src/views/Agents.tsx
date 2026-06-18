// src/views/Agents.tsx — agent grid + invoke modal.
import { useEffect, useMemo, useState } from 'react';
import { Bot, RefreshCw, Play, X } from 'lucide-react';
import { Button } from '../components/Button';
import { Card, CardTitle } from '../components/Card';
import { EmptyState } from '../components/EmptyState';
import { Spinner } from '../components/Spinner';
import { StatusBadge } from '../components/StatusBadge';
import { useModal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { formatRelative, truncate } from '../lib/utils';
import type { Agent, Settings, Snapshot } from '../lib/types';

type Props = {
  snapshot: Snapshot;
  settings: Settings;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

export function Agents({ snapshot }: Props) {
  const toast = useToast();
  const modal = useModal();
  const [agents, setAgents] = useState<Agent[]>(snapshot.agents || []);
  const [loading, setLoading] = useState(!snapshot.agents);

  useEffect(() => {
    if (snapshot.agents?.length) {
      setAgents(snapshot.agents);
      setLoading(false);
      return;
    }
    let cancelled = false;
    api
      .get<{ agents: Agent[] }>('/agents')
      .then((d) => {
        if (!cancelled) {
          setAgents(d.agents || []);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setLoading(false);
          toast.error(`Could not load agents: ${(err as Error).message}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [snapshot.agents, toast]);

  const sorted = useMemo(
    () => [...agents].sort((a, b) => a.name.localeCompare(b.name)),
    [agents],
  );

  const refresh = async () => {
    try {
      const d = await api.get<{ agents: Agent[] }>('/agents');
      setAgents(d.agents || []);
      toast.info('Agents refreshed.', 1500);
    } catch (err) {
      toast.error(`Refresh failed: ${(err as Error).message}`);
    }
  };

  return (
    <div className="view view-agents">
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <Bot size={18} /> Agents ({sorted.length})
          </h2>
          <p className="view-subtitle">
            The Norse pantheon — 13 specialized agents across 4 cost tiers.
          </p>
        </div>
        <div className="view-actions">
          <Button variant="secondary" size="sm" onClick={refresh}>
            <RefreshCw size={14} /> Refresh
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="view-loading">
          <Spinner size="lg" />
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<Bot size={32} />}
          title="No agents found"
          message="Run bizar in the terminal to install Bizar."
        />
      ) : (
        <div className="agent-grid">
          {sorted.map((a) => (
            <AgentCard key={a.name} agent={a} onInvoke={() => openInvoke(modal, a, toast, refresh)} />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentCard({
  agent,
  onInvoke,
}: {
  agent: Agent;
  onInvoke: () => void;
}) {
  return (
    <Card variant="elevated" interactive className="agent-card">
      <div className="agent-card-head">
        <div className="agent-card-name">{agent.name}</div>
        <StatusBadge kind={agent.mode === 'primary' ? 'accent' : 'neutral'}>
          {agent.mode || 'agent'}
        </StatusBadge>
      </div>
      <p className="agent-card-desc">{truncate(agent.description, 200)}</p>
      <div className="agent-card-meta">
        <span className="mono" title={agent.model || ''}>
          {agent.model || '—'}
        </span>
        <span className="tabular-nums muted">{formatRelative(agent.mtime)}</span>
      </div>
      <div className="agent-card-actions">
        <Button variant="primary" size="sm" onClick={onInvoke}>
          <Play size={12} /> Invoke
        </Button>
      </div>
    </Card>
  );
}

function openInvoke(
  modal: ReturnType<typeof useModal>,
  agent: Agent,
  toast: ReturnType<typeof useToast>,
  refresh: () => Promise<void>,
) {
  let promptEl: HTMLTextAreaElement | null = null;

  const submit = async () => {
    const prompt = (promptEl?.value || '').trim();
    if (!prompt) {
      toast.warning('Prompt is required.');
      return;
    }
    try {
      await api.post(`/agents/${encodeURIComponent(agent.name)}/invoke`, { prompt });
      toast.success(`Invoked ${agent.name}.`);
      modal.close();
      await refresh();
    } catch (err) {
      toast.error(`Invoke failed: ${(err as Error).message}`);
    }
  };

  modal.open({
    title: `Invoke ${agent.name}`,
    width: 560,
    children: (
      <div className="invoke-form">
        <p className="muted invoke-form-meta mono">
          {agent.model || '—'} · {agent.path}
        </p>
        <p className="invoke-form-desc">{agent.description}</p>
        <label className="field-label" htmlFor="invoke-prompt">
          Prompt
        </label>
        <textarea
          ref={(el) => {
            promptEl = el;
          }}
          id="invoke-prompt"
          className="textarea"
          rows={5}
          placeholder="What should this agent do?"
          autoFocus
        />
      </div>
    ),
    footer: (
      <div className="modal-footer-actions">
        <Button variant="ghost" onClick={() => modal.close()}>
          <X size={14} /> Cancel
        </Button>
        <Button variant="primary" onClick={submit}>
          <Play size={14} /> Invoke
        </Button>
      </div>
    ),
  });
}
