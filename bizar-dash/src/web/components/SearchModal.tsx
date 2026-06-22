// src/components/SearchModal.tsx — fuzzy search modal opened by / or Cmd/Ctrl+K.
import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useToast } from './Toast';
import { api } from '../lib/api';
import type { SearchResult } from '../lib/types';
import { cn } from '../lib/utils';

type Props = {
  open: boolean;
  onClose: () => void;
  onSelect: (r: SearchResult) => void;
};

const SCOPES = [
  { id: 'all', label: 'All' },
  { id: 'projects', label: 'Projects' },
  { id: 'agents', label: 'Agents' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'mods', label: 'Mods' },
  { id: 'schedules', label: 'Schedules' },
  { id: 'commands', label: 'Commands' },
  { id: 'settings', label: 'Settings' },
] as const;

const RESULT_TYPE_BY_SCOPE: Record<(typeof SCOPES)[number]['id'], string | null> = {
  all: null,
  projects: 'project',
  agents: 'agent',
  tasks: 'task',
  mods: 'mod',
  schedules: 'schedule',
  commands: 'command',
  settings: 'setting',
};

export function SearchModal({ open, onClose, onSelect }: Props) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<typeof SCOPES[number]['id']>('all');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let focusTimer: number | undefined;
    if (open) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      setQ('');
      setResults([]);
      setActiveIdx(0);
      focusTimer = window.setTimeout(() => inputRef.current?.focus(), 30);
    }
    return () => {
      if (focusTimer) window.clearTimeout(focusTimer);
      if (!open) return;
      const previous = previousFocusRef.current;
      if (previous && previous.isConnected) previous.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!q.trim()) {
      setResults([]);
      setActiveIdx(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .get<{ results: SearchResult[] }>(`/search?q=${encodeURIComponent(q)}&scope=${scope}`)
        .then((r) => {
          if (cancelled) return;
          setResults(r.results || []);
          setActiveIdx(0);
        })
        .catch((err) => {
          if (cancelled) return;
          toast.error(`Search failed: ${(err as Error).message}`);
        })
        .finally(() => !cancelled && setLoading(false));
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, scope, open, toast]);

  if (!open) return null;

  const grouped: Record<string, SearchResult[]> = {};
  for (const r of results) {
    const type = r.type.toLowerCase();
    grouped[type] = grouped[type] || [];
    grouped[type].push(r);
  }

  const flat: SearchResult[] = [];
  for (const scope of SCOPES.map((s) => s.id)) {
    const resultType = RESULT_TYPE_BY_SCOPE[scope];
    if (resultType && grouped[resultType]) flat.push(...grouped[resultType]);
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flat.length === 0) return;
      setActiveIdx((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length === 0) return;
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && flat[activeIdx]) {
      e.preventDefault();
      onSelect(flat[activeIdx]);
      onClose();
    }
  };

  return (
    <div className="search-modal-backdrop" onClick={onClose}>
      <div className="search-modal" role="dialog" aria-modal="true" aria-labelledby="search-modal-title" onClick={(e) => e.stopPropagation()}>
        <div className="search-modal-head">
          <Search size={14} />
          <span id="search-modal-title" className="sr-only">Search</span>
          <input
            ref={inputRef}
            className="search-modal-input"
            placeholder="Search tasks, agents, settings, projects…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
          />
          <button
            type="button"
            className="icon-btn"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
        <div className="search-modal-scopes">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={cn('search-scope', scope === s.id && 'search-scope-active')}
              onClick={() => setScope(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="search-modal-body">
          {loading && <div className="muted">Searching…</div>}
          {!loading && q && flat.length === 0 && <div className="muted">No results.</div>}
          {!loading && !q && <div className="muted">Type to search…</div>}
          {SCOPES.map((s) => {
            const resultType = RESULT_TYPE_BY_SCOPE[s.id];
            if (!resultType) return null;
            const list = grouped[resultType];
            if (!list || list.length === 0) return null;
            return (
              <div key={s.id} className="search-group">
                <div className="search-group-head">{s.label}</div>
                {list.map((r) => {
                  const flatIdx = flat.indexOf(r);
                  return (
                    <button
                      type="button"
                      key={`${r.type}-${flatIdx}`}
                      className={cn('search-result', flatIdx === activeIdx && 'search-result-active')}
                      onMouseEnter={() => setActiveIdx(flatIdx)}
                      onClick={() => {
                        onSelect(r);
                        onClose();
                      }}
                    >
                      <span className="search-result-type">{r.type}</span>
                      <span className="search-result-label">
                        {summarize(r)}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="search-modal-foot">
          <span className="muted">↑↓ navigate · ↵ open · esc close</span>
        </div>
      </div>
    </div>
  );
}

function summarize(r: SearchResult): string {
  const i = r.item || {};
  if (r.type === 'project') return `${i.name} — ${i.path}`;
  if (r.type === 'agent') return `${i.name} — ${i.description || i.model || ''}`;
  if (r.type === 'task') return `${i.title} — ${(i.status || '')}`;
  if (r.type === 'mod') return `${i.name} v${i.version} — ${i.description || ''}`;
  if (r.type === 'schedule') return `${i.name} (${i.type}: ${i.schedule})`;
  if (r.type === 'command') return `${i.name} — ${i.description || ''}`;
  if (r.type === 'setting') {
    const val = i.value === null || i.value === undefined
      ? ''
      : typeof i.value === 'string'
        ? ` = ${i.value}`
        : ` = ${JSON.stringify(i.value)}`;
    return `${i.label}${val}  —  ${i.desc || ''}`.trim();
  }
  return JSON.stringify(i).slice(0, 80);
}
