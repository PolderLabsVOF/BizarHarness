// src/web/components/SettingsSearch.tsx — fuzzy search across Settings sections with scroll-to highlight
import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import Fuse from 'fuse.js';
import { cn } from '../lib/utils';

export type SettingsSection = {
  id: string;
  label: string;
  icon?: string;
  fields: SettingsField[];
};

export type SettingsField = {
  key: string;       // e.g. "theme.accent"
  label: string;     // e.g. "Accent color"
  value?: string;    // current value (masked if secret)
  section: string;   // parent section id
};

type Props = {
  sections: SettingsSection[];
  onJump: (sectionId: string, fieldKey?: string) => void;
};

type Match = {
  item: SettingsField | SettingsSection;
  score: number;
  type: 'section' | 'field';
  sectionId: string;
  fieldKey?: string;
};

function fuseSearch(items: SettingsSection[], query: string): Match[] {
  if (!query.trim()) return [];

  const sectionFuse = new Fuse(items, {
    keys: ['label'],
    threshold: 0.4,
    includeScore: true,
  });

  const fieldFuse = new Fuse(
    items.flatMap((s) => s.fields.map((f) => ({ ...f, _sectionId: s.id }))),
    { keys: ['label', 'key'], threshold: 0.4, includeScore: true },
  );

  const results: Match[] = [];

  for (const r of sectionFuse.search(query)) {
    results.push({
      item: r.item,
      score: r.score ?? 1,
      type: 'section',
      sectionId: r.item.id,
    });
  }

  for (const r of fieldFuse.search(query)) {
    results.push({
      item: r.item as SettingsField,
      score: r.score ?? 1,
      type: 'field',
      sectionId: (r.item as SettingsField & { _sectionId: string })._sectionId,
      fieldKey: r.item.key,
    });
  }

  // Deduplicate by sectionId+fieldKey, prefer lower score
  const seen = new Set<string>();
  return results
    .filter((r) => {
      const k = `${r.sectionId}::${r.fieldKey ?? ''}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, 8);
}

export function SettingsSearch({ sections, onJump }: Props) {
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(
    (query: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!query.trim()) {
        setMatches([]);
        setActiveIdx(0);
        return;
      }
      debounceRef.current = setTimeout(() => {
        setMatches(fuseSearch(sections, query));
        setActiveIdx(0);
      }, 200);
    },
    [sections],
  );

  useEffect(() => {
    search(q);
  }, [q, search]);

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const highlightSection = (sectionId: string) => {
    setHighlighted(sectionId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlighted(null), 1500);
    const el = document.querySelector(`[data-section="${sectionId}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setQ('');
      inputRef.current?.blur();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && matches[activeIdx]) {
      const m = matches[activeIdx];
      highlightSection(m.sectionId);
      onJump(m.sectionId, m.fieldKey);
      setQ('');
    }
  };

  const handleSelect = (m: Match) => {
    highlightSection(m.sectionId);
    onJump(m.sectionId, m.fieldKey);
    setQ('');
  };

  return (
    <div className="settings-search">
      <div className="settings-search-input-wrap">
        <Search size={13} className="settings-search-icon" />
        <input
          ref={inputRef}
          className="settings-search-input"
          placeholder="Search settings…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={handleKey}
          aria-label="Search settings"
        />
        {q && (
          <button
            type="button"
            className="icon-btn settings-search-clear"
            onClick={() => setQ('')}
            aria-label="Clear search"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {q && matches.length > 0 && (
        <div className="settings-search-results">
          {matches.map((m, idx) => {
            const label = m.type === 'section'
              ? (m.item as SettingsSection).label
              : (m.item as SettingsField).label;
            const key = m.type === 'section'
              ? (m.item as SettingsSection).id
              : (m.item as SettingsField).key;
            return (
              <button
                key={`${m.sectionId}::${key}`}
                type="button"
                className={cn('settings-search-result', idx === activeIdx && 'settings-search-result-active')}
                onClick={() => handleSelect(m)}
                onMouseEnter={() => setActiveIdx(idx)}
              >
                <span className={cn('settings-search-result-type', m.type === 'section' && 'settings-search-result-type-section')}>
                  {m.type === 'section' ? 'section' : 'field'}
                </span>
                <span className="settings-search-result-label">
                  {label}
                </span>
                {m.type === 'field' && (
                  <span className="settings-search-result-key mono muted">{key}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {q && matches.length === 0 && (
        <div className="settings-search-empty muted">No matching settings.</div>
      )}
    </div>
  );
}
