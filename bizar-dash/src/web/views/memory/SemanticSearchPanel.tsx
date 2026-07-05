// src/web/views/memory/SemanticSearchPanel.tsx — cross-source search (LightRAG + Obsidian).
import { useEffect, useMemo, useState } from 'react';
import { Brain, FileText, Loader2, Search as SearchIcon, X } from 'lucide-react';
import { Button } from '../../components/Button';
import { Card, CardMeta, CardTitle } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { Spinner } from '../../components/Spinner';
import { useToast } from '../../components/Toast';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';

type Result = {
  source: 'lightrag' | 'obsidian';
  relPath: string | null;
  snippet: string;
  score: number;
  mtime: number | null;
  raw?: unknown;
  error?: string;
};

type Props = { refreshKey: number };

export function SemanticSearchPanel({ refreshKey }: Props) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [sources, setSources] = useState<{ lightrag: boolean; obsidian: boolean }>({ lightrag: true, obsidian: true });
  const [results, setResults] = useState<Result[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastQuery, setLastQuery] = useState('');

  const onSearch = async (query: string) => {
    if (!query.trim()) return;
    setLoading(true);
    setLastQuery(query);
    try {
      const activeSources = [
        ...(sources.lightrag ? ['lightrag' as const] : []),
        ...(sources.obsidian ? ['obsidian' as const] : []),
      ];
      const r = await api.post<{ query: string; count: number; results: Result[] }>(
        '/memory/semantic-search',
        { query, limit: 20, sources: activeSources },
      );
      setResults(r.results || []);
    } catch (err) {
      toast.error(`Search failed: ${(err as Error).message}`);
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  // Re-run when sources toggle (if there's a last query).
  useEffect(() => {
    if (lastQuery) onSearch(lastQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources]);

  // Re-run when the panel is re-mounted.
  useEffect(() => {
    if (lastQuery) onSearch(lastQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const grouped = useMemo(() => {
    const obs = (results || []).filter((r) => r.source === 'obsidian');
    const lr = (results || []).filter((r) => r.source === 'lightrag');
    return { obs, lr };
  }, [results]);

  return (
    <div className="memory-panel-content">
      <Card variant="elevated">
        <CardTitle>
          <SearchIcon size={14} /> Semantic search
        </CardTitle>
        <CardMeta>Query both LightRAG (graph-based) and the Obsidian vault in one shot.</CardMeta>
        <div className="memory-search-row">
          <input
            type="text"
            className="input"
            placeholder="e.g. how are notes indexed?"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSearch(q);
            }}
            disabled={loading}
          />
          <Button variant="primary" onClick={() => onSearch(q)} disabled={loading || !q.trim()}>
            {loading ? <Loader2 size={12} className="memory-spin" /> : <SearchIcon size={12} />}
            Search
          </Button>
        </div>
        <div className="memory-source-toggle-row">
          <ToggleChip
            active={sources.obsidian}
            onToggle={() => setSources((s) => ({ ...s, obsidian: !s.obsidian }))}
            label="Obsidian"
            icon={<FileText size={11} />}
          />
          <ToggleChip
            active={sources.lightrag}
            onToggle={() => setSources((s) => ({ ...s, lightrag: !s.lightrag }))}
            label="LightRAG"
            icon={<Brain size={11} />}
          />
          {q && (
            <button type="button" className="icon-btn" onClick={() => { setQ(''); setResults(null); setLastQuery(''); }} aria-label="Clear">
              <X size={12} />
            </button>
          )}
        </div>
      </Card>

      {loading && (
        <div className="view-loading">
          <Spinner size="md" />
        </div>
      )}

      {!loading && results && results.length === 0 && (
        <EmptyState
          icon={<SearchIcon size={28} />}
          title="No matches"
          message={`Nothing in scope matched "${lastQuery}".`}
        />
      )}

      {grouped.obs.length > 0 && (
        <Card>
          <CardTitle>
            <FileText size={14} /> Obsidian ({grouped.obs.length})
          </CardTitle>
          <ul className="memory-search-result-list">
            {grouped.obs.map((r, i) => (
              <li key={`obs-${i}`} className="memory-search-result">
                <div className="memory-search-result-head">
                  <code>{r.relPath}</code>
                  <span className="muted text-xs">score {r.score.toFixed(1)}</span>
                </div>
                <p className="muted text-sm">{r.snippet}</p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {grouped.lr.length > 0 && (
        <Card>
          <CardTitle>
            <Brain size={14} /> LightRAG ({grouped.lr.length})
          </CardTitle>
          <div className="memory-search-result-list">
            {grouped.lr.map((r, i) => (
              <div key={`lr-${i}`} className="memory-search-result">
                <div className="memory-search-result-head">
                  <span className="memory-source-pill"><Brain size={11} /> LightRAG</span>
                  {r.error && <span className="muted text-xs">error: {r.error}</span>}
                </div>
                <p className="text-sm">{r.snippet}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function ToggleChip({
  active,
  onToggle,
  label,
  icon,
}: {
  active: boolean;
  onToggle: () => void;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={cn('memory-toggle-chip', active && 'memory-toggle-chip-active')}
      onClick={onToggle}
      aria-pressed={active}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}