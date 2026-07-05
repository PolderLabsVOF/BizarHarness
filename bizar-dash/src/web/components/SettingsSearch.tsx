// src/web/components/SettingsSearch.tsx — fuzzy search across Settings sections with scroll-to highlight.
// v4.9: replaces Fuse.js with Levenshtein-based fuzzySearch; adds recent searches + match highlighting.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { fuzzySearch, type SearchableItem, type SearchResult } from '../lib/search';

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

/* ─── Recent searches (localStorage) ─── */

const RECENT_KEY = 'bizar_settings_recent';

function getRecentSearches(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(query: string) {
  if (!query) return;
  try {
    const recent = getRecentSearches().filter((q) => q !== query);
    recent.unshift(query);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 5)));
  } catch {
    // localStorage may be full or disabled — silently ignore
  }
}

/* ─── Highlight matched terms ─── */

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  // Escape regex special characters in the user query
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>,
  );
}

/* ─── Build SearchableItems from sections ─── */

function toSearchableItems(sections: SettingsSection[]): SearchableItem[] {
  const items: SearchableItem[] = [];
  for (const section of sections) {
    // Section itself is searchable
    items.push({
      key: section.id,
      label: section.label,
      section: section.id,
      description: `${section.fields.length} field${section.fields.length === 1 ? '' : 's'}`,
    });
    // Each field is searchable
    for (const field of section.fields) {
      items.push({
        key: field.key,
        label: field.label,
        section: section.id,
        value: field.value,
      });
    }
  }
  return items;
}

/* ─── Component ─── */

export function SettingsSearch({ sections, onJump }: Props) {
  const [q, setQ] = useState('');
  const [matches, setMatches] = useState<SearchResult[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allItems = useRef<SearchableItem[]>([]);
  // Rebuild items when sections change
  useEffect(() => {
    allItems.current = toSearchableItems(sections);
  }, [sections]);

  const search = useCallback(
    (query: string, immediate = false) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!query.trim()) {
        setMatches([]);
        setActiveIdx(0);
        return;
      }
      const run = () => {
        const results = fuzzySearch(query, allItems.current);
        setMatches(results);
        setActiveIdx(0);
      };
      if (immediate) {
        run();
      } else {
        debounceRef.current = setTimeout(run, 150);
      }
    },
    [], // stable — allItems is a ref
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

  /* ─── Quick-jump with flash ─── */

  const jumpToSection = (sectionId: string, key: string) => {
    // Look for the field by data-setting-id within the section
    const fieldEl = document.querySelector(
      `[data-section="${sectionId}"] [data-setting-id="${key}"]`,
    );
    if (fieldEl) {
      fieldEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      fieldEl.classList.add('setting-flash');
      setTimeout(() => fieldEl.classList.remove('setting-flash'), 2000);
    }
    // Also scroll the section Card into view
    const sectionEl = document.querySelector(`[data-section="${sectionId}"]`);
    if (sectionEl) {
      sectionEl.scrollIntoView({ behavior: 'smooth', block: fieldEl ? 'nearest' : 'start' });
    }
  };

  const highlightSection = (sectionId: string) => {
    setHighlighted(sectionId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlighted(null), 1500);
    const el = document.querySelector(`[data-section="${sectionId}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const commitSelection = (result: SearchResult) => {
    saveRecentSearch(q);
    if (result.key === result.section) {
      // It's a section match — jump to section
      highlightSection(result.section);
      onJump(result.section);
    } else {
      // It's a field match — jump to field with flash
      highlightSection(result.section);
      onJump(result.section, result.key);
      jumpToSection(result.section, result.key);
    }
    setQ('');
    inputRef.current?.blur();
  };

  /* ─── Keyboard navigation ─── */

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
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // If debounce hasn't fired yet, search immediately
      if (matches.length === 0 && q.trim()) {
        search(q, true);
      }
      if (matches[activeIdx]) {
        commitSelection(matches[activeIdx]);
      }
    }
  };

  const handleSelect = (m: SearchResult) => {
    commitSelection(m);
  };

  /* ─── Recent searches helpers ─── */

  const recent = getRecentSearches();

  const handleRecentClick = (term: string) => {
    setQ(term);
    inputRef.current?.focus();
  };

  const clearRecent = () => {
    try {
      localStorage.removeItem(RECENT_KEY);
    } catch {
      // ignore
    }
    // Force re-render
    setFocused((f) => f);
  };

  /* ─── Render ─── */

  const showRecent = focused && !q.trim() && recent.length > 0;

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
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
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

      {/* Recent searches dropdown */}
      {showRecent && (
        <div className="settings-search-recent">
          <div className="settings-search-recent-header">
            <span className="settings-search-recent-label">Recent</span>
            <button
              type="button"
              className="settings-search-recent-clear"
              onClick={clearRecent}
              tabIndex={-1}
            >
              Clear
            </button>
          </div>
          {recent.map((term) => (
            <button
              key={term}
              type="button"
              className="settings-search-recent-item"
              onMouseDown={(e) => {
                e.preventDefault();
                handleRecentClick(term);
              }}
            >
              <Search size={11} />
              <span>{term}</span>
            </button>
          ))}
        </div>
      )}

      {/* Search results */}
      {q && matches.length > 0 && (
        <div className="settings-search-results">
          {matches.map((m, idx) => (
            <button
              key={`${m.section}::${m.key}`}
              type="button"
              className={cn('settings-search-result', idx === activeIdx && 'settings-search-result-active')}
              onClick={() => handleSelect(m)}
              onMouseEnter={() => setActiveIdx(idx)}
            >
              <span
                className={cn(
                  'settings-search-result-type',
                  m.key === m.section && 'settings-search-result-type-section',
                )}
              >
                {m.key === m.section ? 'section' : 'field'}
              </span>
              <span className="settings-search-result-label">
                {highlightMatch(m.label, q)}
              </span>
              {m.key !== m.section && (
                <span className="settings-search-result-key mono muted">{m.key}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {q && matches.length === 0 && (
        <div className="settings-search-empty muted">No matching settings.</div>
      )}
    </div>
  );
}
