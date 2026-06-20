// src/mobile/views/MobileAgents.tsx — agents list with detail bottom sheet.
import { useEffect, useState } from 'react';
import { Bot, Plus, RefreshCw, Play, Pencil, Trash2, RotateCw, X } from 'lucide-react';
import { api } from '../../lib/api';
import { formatRelative } from '../../lib/utils';
import type { Agent, Snapshot } from '../../lib/types';
import { MobileBottomSheet } from '../components/MobileBottomSheet';
import { MobileModal } from '../components/MobileModal';

type Props = {
  snapshot: Snapshot;
  onBack: () => void;
  onOpenAgent: (name: string) => void;
  selectedAgent?: string;
  onRefresh?: () => Promise<void>;
};

const CATEGORIES = ['reasoning', 'code', 'design', 'planning', 'gitops', 'analysis'];

const CATEGORY_COLORS: Record<string, string> = {
  reasoning: 'var(--accent)',
  code: 'var(--info)',
  design: 'var(--success)',
  planning: 'var(--warning)',
  gitops: 'var(--error)',
  analysis: 'var(--text-dim)',
};

export function MobileAgents({ snapshot, onBack, onOpenAgent, selectedAgent, onRefresh }: Props) {
  const [agents, setAgents] = useState<Agent[]>(snapshot.agents || []);
  const [loading, setLoading] = useState(!snapshot.agents);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [search, setSearch] = useState('');
  const [detailAgent, setDetailAgent] = useState<Agent | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [invokePrompt, setInvokePrompt] = useState('');
  const [invokeOpen, setInvokeOpen] = useState(false);

  useEffect(() => {
    if (selectedAgent) {
      const a = agents.find((ag) => ag.name === selectedAgent);
      if (a) setDetailAgent(a);
    }
  }, [selectedAgent, agents]);

  const reload = async () => {
    try {
      const data = await api.get<{ agents: Agent[] }>('/agents');
      setAgents(data.agents || []);
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  };

  const filtered = agents.filter((a) => {
    if (categoryFilter && a.category !== categoryFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!a.name.toLowerCase().includes(q) && !(a.description || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const invokeAgent = async (name: string, prompt: string) => {
    try {
      await api.post(`/agents/${encodeURIComponent(name)}/invoke`, { prompt });
      setInvokeOpen(false);
      setInvokePrompt('');
    } catch {
      // best-effort
    }
  };

  const restartAgent = async (name: string) => {
    try {
      await api.post(`/agents/${encodeURIComponent(name)}/restart`);
      await reload();
    } catch {
      // best-effort
    }
  };

  const deleteAgent = async (name: string) => {
    if (!confirm(`Delete agent "${name}"?`)) return;
    try {
      await api.del(`/agents/${encodeURIComponent(name)}`);
      setAgents((cur) => cur.filter((a) => a.name !== name));
      setDetailAgent(null);
      onRefresh?.();
    } catch {
      // best-effort
    }
  };

  const createAgent = async (data: {
    name: string; description: string; model: string; mode: string;
    color: string; tools: string[]; tags: string[]; category: string; prompt: string;
  }) => {
    try {
      const created = await api.post<Agent>('/agents', data);
      setAgents((cur) => [...cur, created]);
      setNewOpen(false);
      onRefresh?.();
    } catch {
      // best-effort
    }
  };

  return (
    <div className="mobile-view">
      {/* Toolbar */}
      <div className="mobile-tasks-toolbar">
        <input
          className="mobile-search-input"
          type="text"
          placeholder="Search agents…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />
        <button type="button" className="mobile-icon-btn" onClick={() => reload()} aria-label="Refresh">
          <RefreshCw size={16} />
        </button>
        <button type="button" className="mobile-icon-btn" onClick={() => setNewOpen(true)} aria-label="New agent">
          <Plus size={16} />
        </button>
      </div>

      {/* Category filter */}
      <div className="mobile-search-scopes">
        <button
          type="button"
          className={`mobile-scope-chip ${!categoryFilter ? 'active' : ''}`}
          onClick={() => setCategoryFilter('')}
        >
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className={`mobile-scope-chip ${categoryFilter === c ? 'active' : ''}`}
            onClick={() => setCategoryFilter(c)}
          >
            {c}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="mobile-loading"><p>Loading…</p></div>
      ) : filtered.length === 0 ? (
        <div className="mobile-empty">
          <Bot size={40} />
          <p>No agents found.</p>
        </div>
      ) : (
        <div className="mobile-card-list">
          {filtered.map((a) => (
            <div
              key={a.name}
              className="mobile-list-item mobile-list-item-interactive"
              onClick={() => { setDetailAgent(a); onOpenAgent(a.name); }}
            >
              <div className="mobile-agent-dot" data-status={a.status || 'idle'} />
              <div className="mobile-list-content">
                <span className="mobile-list-title">{a.name}</span>
                <span className="mobile-list-meta">{a.model || a.mode || '—'}</span>
              </div>
              {a.category && (
                <span
                  className="mobile-list-badge"
                  style={{ color: CATEGORY_COLORS[a.category] || 'var(--text-dim)' }}
                >
                  {a.category}
                </span>
              )}
              <span className="mobile-list-badge" data-status={a.status || 'idle'}>
                {a.status || 'idle'}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Agent detail sheet */}
      {detailAgent && (
        <MobileBottomSheet
          open={true}
          onClose={() => setDetailAgent(null)}
          title={detailAgent.name}
          actions={
            <div className="mobile-task-detail-actions">
              <button
                type="button"
                className="mobile-btn"
                onClick={() => { setInvokePrompt(''); setInvokeOpen(true); }}
              >
                <Play size={14} /> Invoke
              </button>
              {(detailAgent.isStuck || detailAgent.status === 'error' || detailAgent.status === 'working') && (
                <button
                  type="button"
                  className="mobile-btn mobile-btn-secondary"
                  onClick={() => restartAgent(detailAgent.name)}
                >
                  <RotateCw size={14} /> Restart
                </button>
              )}
              <button
                type="button"
                className="mobile-btn mobile-btn-danger"
                onClick={() => deleteAgent(detailAgent.name)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          }
        >
          <div className="mobile-agent-detail">
            <div className="mobile-agent-detail-status">
              <span className="mobile-agent-dot" data-status={detailAgent.status || 'idle'} />
              <span className="mobile-agent-detail-status-text">{detailAgent.status || 'idle'}</span>
              {detailAgent.category && (
                <span
                  className="mobile-list-badge"
                  style={{ color: CATEGORY_COLORS[detailAgent.category] }}
                >
                  {detailAgent.category}
                </span>
              )}
            </div>
            <p className="mobile-agent-detail-desc">{detailAgent.description || 'No description.'}</p>
            <div className="mobile-agent-detail-meta">
              <div className="mobile-task-detail-row">
                <span>Model</span>
                <span className="mono">{detailAgent.model || '—'}</span>
              </div>
              <div className="mobile-task-detail-row">
                <span>Mode</span>
                <span>{detailAgent.mode || 'subagent'}</span>
              </div>
              <div className="mobile-task-detail-row">
                <span>Path</span>
                <span className="mono" style={{ fontSize: 11 }}>{detailAgent.path}</span>
              </div>
              {detailAgent.lastError && (
                <div className="mobile-task-detail-row" style={{ color: 'var(--error)' }}>
                  <span>Last error</span>
                  <span>{detailAgent.lastError.message}</span>
                </div>
              )}
              {detailAgent.tasksTotal != null && detailAgent.tasksTotal > 0 && (
                <div className="mobile-task-detail-row">
                  <span>Success rate</span>
                  <span>{Math.round((detailAgent.successRate || 0) * 100)}%</span>
                </div>
              )}
              <div className="mobile-task-detail-row">
                <span>Last modified</span>
                <span>{formatRelative(detailAgent.mtime)}</span>
              </div>
            </div>
          </div>
        </MobileBottomSheet>
      )}

      {/* Invoke modal */}
      <MobileModal open={invokeOpen} onClose={() => setInvokeOpen(false)} title={`Invoke ${detailAgent?.name}`} actions={
        <button
          type="button"
          className="mobile-btn"
          style={{ width: '100%' }}
          disabled={!invokePrompt.trim()}
          onClick={() => { if (detailAgent) invokeAgent(detailAgent.name, invokePrompt.trim()); }}
        >
          <Play size={14} /> Invoke
        </button>
      }>
        <p className="muted" style={{ marginBottom: 12 }}>
          Model: <span className="mono">{detailAgent?.model || '—'}</span>
        </p>
        <textarea
          className="mobile-input"
          rows={5}
          placeholder="What should this agent do?"
          value={invokePrompt}
          onChange={(e) => setInvokePrompt(e.target.value)}
          autoFocus
        />
      </MobileModal>

      {/* New agent modal */}
      <NewAgentModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreate={createAgent}
      />
    </div>
  );
}

function NewAgentModal({ open, onClose, onCreate }: {
  open: boolean;
  onClose: () => void;
  onCreate: (data: {
    name: string; description: string; model: string; mode: string;
    color: string; tools: string[]; tags: string[]; category: string; prompt: string;
  }) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [model, setModel] = useState('');
  const [mode, setMode] = useState('subagent');
  const [color, setColor] = useState('#8b5cf6');
  const [category, setCategory] = useState('');
  const [tags, setTags] = useState('');
  const [prompt, setPrompt] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate({
      name: name.trim(),
      description: description.trim(),
      model,
      mode,
      color,
      tools: [],
      tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      category,
      prompt,
    });
    setName('');
    setDescription('');
    setModel('');
    setMode('subagent');
    setColor('#8b5cf6');
    setCategory('');
    setTags('');
    setPrompt('');
  };

  return (
    <MobileModal open={open} onClose={onClose} title="New Agent" actions={
      <button type="submit" form="new-agent-form" className="mobile-btn" style={{ width: '100%' }}>
        <Plus size={14} /> Create
      </button>
    }>
      <form id="new-agent-form" onSubmit={handleSubmit} className="mobile-task-form">
        <label className="mobile-field-label">Name *</label>
        <input className="mobile-input" type="text" placeholder="my-agent" pattern="[a-z0-9][a-z0-9-]{0,63}"
          value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        <label className="mobile-field-label">Description</label>
        <input className="mobile-input" type="text" placeholder="What does this agent do?"
          value={description} onChange={(e) => setDescription(e.target.value)} />
        <label className="mobile-field-label">Model</label>
        <input className="mobile-input" type="text" placeholder="(provider default)"
          value={model} onChange={(e) => setModel(e.target.value)} />
        <label className="mobile-field-label">Category</label>
        <select className="mobile-input" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">None</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className="mobile-field-label">Tags (comma-separated)</label>
        <input className="mobile-input" type="text" placeholder="tag1, tag2"
          value={tags} onChange={(e) => setTags(e.target.value)} />
      </form>
    </MobileModal>
  );
}
