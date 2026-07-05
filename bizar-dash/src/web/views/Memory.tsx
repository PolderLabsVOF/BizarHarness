// src/web/views/Memory.tsx — v4.7.0 dedicated Memory tab.
//
// Three-column layout: left rail (source picker), main panel (per-source UI),
// and a top stat row + a health hero at the top of every panel for context.
//
// The Memory subsystem has 4 sources (LightRAG, Obsidian vault, git sync,
// semantic search) plus a config panel and a high-level overview. Each is a
// standalone component under views/memory/.

import React, { useCallback, useState } from 'react';
import {
  Brain,
  Clipboard,
  FileText,
  GitBranch,
  LayoutDashboard,
  Mic,
  Network,
  RefreshCw,
  Scan,
  Search as SearchIcon,
  Sliders,
} from 'lucide-react';
import { Card } from '../components/Card';
import { useToast } from '../components/Toast';
import { cn } from '../lib/utils';
import { MemoryOverview } from './memory/MemoryOverview';
import { LightragPanel } from './memory/LightragPanel';
import { ObsidianPanel } from './memory/ObsidianPanel';
import { GitSyncPanel } from './memory/GitSyncPanel';
import { SemanticSearchPanel } from './memory/SemanticSearchPanel';
import { ConfigPanel } from './memory/ConfigPanel';
import { MemoryGraphPanel } from './memory/MemoryGraphPanel';
import { FromScreenshotPanel } from './memory/FromScreenshotPanel';
import { VaultFromClipboardPanel } from './memory/VaultFromClipboardPanel';
import { VoiceNotesPanel } from '../components/VoiceNotesPanel';

type SubPanel = 'overview' | 'lightrag' | 'obsidian' | 'git' | 'semantic' | 'config' | 'graph' | 'webclip' | 'screenshot' | 'voice';

type Props = {
  snapshot: unknown;
  settings: unknown;
  activeTab: string;
  setActiveTab: (id: string) => void;
  refreshSnapshot: () => Promise<void>;
};

const SOURCES: Array<{
  id: SubPanel;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'lightrag', label: 'LightRAG', icon: Brain },
  { id: 'obsidian', label: 'Obsidian Vault', icon: FileText },
  { id: 'git', label: 'Git Sync', icon: GitBranch },
  { id: 'semantic', label: 'Semantic Search', icon: SearchIcon },
  { id: 'config', label: 'Config', icon: Sliders },
  { id: 'graph', label: 'Memory Graph', icon: Network },
  { id: 'webclip', label: 'Web Clip', icon: Clipboard },
  { id: 'screenshot', label: 'Screenshot OCR', icon: Scan },
  { id: 'voice', label: 'Voice Notes', icon: Mic },
];

function MemoryInner(_props: Props) {
  const toast = useToast();
  const [active, setActive] = useState<SubPanel>('overview');
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const onRefreshAll = useCallback(async () => {
    refresh();
    toast.info('Refreshing memory…', 1200);
  }, [refresh, toast]);

  const renderPanel = () => {
    switch (active) {
      case 'overview':
        return <MemoryOverview refreshKey={refreshKey} onRefresh={refresh} setActiveSubPanel={setActive} />;
      case 'lightrag':
        return <LightragPanel refreshKey={refreshKey} />;
      case 'obsidian':
        return <ObsidianPanel refreshKey={refreshKey} />;
      case 'git':
        return <GitSyncPanel refreshKey={refreshKey} />;
      case 'semantic':
        return <SemanticSearchPanel refreshKey={refreshKey} />;
      case 'config':
        return <ConfigPanel refreshKey={refreshKey} />;
      case 'graph':
        return <MemoryGraphPanel refreshKey={refreshKey} />;
      case 'webclip':
        return <VaultFromClipboardPanel refreshKey={refreshKey} />;
      case 'screenshot':
        return <FromScreenshotPanel refreshKey={refreshKey} />;
      case 'voice':
        return <VoiceNotesPanel refreshKey={refreshKey} />;
      default:
        return <Card>Unknown panel: {active}</Card>;
    }
  };

  return (
    <div className="view view-memory memory-tab">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="view-header">
        <div className="view-header-text">
          <h2 className="view-title">
            <Brain size={18} /> Memory
          </h2>
          <p className="view-subtitle">
            LightRAG, Obsidian vault, git sync, semantic search, web clips, and screenshot OCR — all in one place.
          </p>
        </div>
        <div className="view-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={onRefreshAll}
            aria-label="Refresh memory"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </header>

      <div className="memory-tab-body">
        {/* ── Source rail ─────────────────────────────────────── */}
        <nav className="memory-source-rail" aria-label="Memory sources">
          {SOURCES.map((s) => {
            const Icon = s.icon;
            const isActive = active === s.id;
            return (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={cn('memory-source-button', isActive && 'memory-source-button-active')}
                onClick={() => setActive(s.id)}
              >
                <Icon size={16} aria-hidden />
                <span>{s.label}</span>
              </button>
            );
          })}
        </nav>

        {/* ── Main panel ─────────────────────────────────────── */}
        <div className="memory-main" key={active}>
          {renderPanel()}
        </div>
      </div>
    </div>
  );
}
export const Memory = React.memo(MemoryInner);
