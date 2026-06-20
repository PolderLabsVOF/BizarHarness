// src/mobile/views/MobileSearchModal.tsx — fullscreen search modal for mobile.
import { useEffect, useRef, useState } from 'react';
import { Search, X, FileText, Bot, CheckSquare, Folder, Sliders } from 'lucide-react';
import { api } from '../../lib/api';
import type { SearchResult } from '../../lib/types';
import { MobileModal } from '../components/MobileModal';

type Props = {
  open: boolean;
  onClose: () => void;
  onNavigate: (type: string, id: string) => void;
};

const SCOPES = ['all', 'tasks', 'agents', 'plans', 'projects', 'settings'] as const;
type Scope = typeof SCOPES[number];

const SCOPE_ICONS: Record<string, typeof FileText> = {
  tasks: CheckSquare,
  agents: Bot,
  plans: FileText,
  projects: Folder,
  settings: Sliders,
};

export function MobileSearchModal({ open, onClose, onNavigate }: Props) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults([]);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.get<{ results: SearchResult[] }>(
          `/search?q=${encodeURIComponent(query)}&scope=${scope}`,
        );
        setResults(data.results || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, scope]);

  const handleResultClick = (r: SearchResult) => {
    const item = r.item as Record<string, string>;
    const id = item.id || item.slug || item.name || '';
    onNavigate(r.type, id);
    onClose();
  };

  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type].push(r);
    return acc;
  }, {});

  return (
    <MobileModal open={open} onClose={onClose} title="Search">
      <div className="mobile-search-container">
        {/* Search input */}
        <div className="mobile-search-input-row">
          <Search size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            className="mobile-search-field"
            type="text"
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && results.length > 0) {
                handleResultClick(results[0]);
              }
            }}
          />
          {query && (
            <button
              type="button"
              className="mobile-icon-btn"
              onClick={() => setQuery('')}
              aria-label="Clear"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Scope chips */}
        <div className="mobile-search-scopes">
          {SCOPES.map((s) => (
            <button
              key={s}
              type="button"
              className={`mobile-scope-chip ${scope === s ? 'active' : ''}`}
              onClick={() => setScope(s)}
            >
              {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* Results */}
        <div className="mobile-search-results">
          {loading && <div className="mobile-search-loading">Searching…</div>}

          {!loading && query && results.length === 0 && (
            <div className="mobile-empty">
              <Search size={32} />
              <p>No results found</p>
            </div>
          )}

          {!loading && !query && (
            <div className="mobile-empty">
              <p>Type to search across tasks, agents, plans, and more.</p>
            </div>
          )}

          {Object.entries(grouped).map(([type, items]) => {
            const Icon = SCOPE_ICONS[type] || FileText;
            return (
              <div key={type} className="mobile-search-group">
                <h4 className="mobile-search-group-title">
                  <Icon size={12} /> {type.charAt(0).toUpperCase() + type.slice(1)} ({items.length})
                </h4>
                {items.map((r, i) => {
                  const item = r.item as Record<string, string>;
                  return (
                    <div
                      key={i}
                      className="mobile-search-result-item"
                      onClick={() => handleResultClick(r)}
                    >
                      <span className="mobile-search-result-title">
                        {item.title || item.name || item.slug || '(unnamed)'}
                      </span>
                      {item.description && (
                        <span className="mobile-search-result-meta">
                          {item.description.slice(0, 80)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </MobileModal>
  );
}
