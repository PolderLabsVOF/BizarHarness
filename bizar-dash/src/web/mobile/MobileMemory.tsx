// src/web/mobile/MobileMemory.tsx — v5.4 mobile memory view with tabbed sources.
// Tab bar at top, scrollable source panels below.
import { useState } from 'react';
import {
  Brain,
  BarChart,
  FileText,
  GitBranch,
  Search,
  Mic,
  Settings,
  Network,
  Clipboard,
  Scan,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { MemoryOverview } from '../views/memory/MemoryOverview';
import { LightragPanel } from '../views/memory/LightragPanel';
import { ObsidianPanel } from '../views/memory/ObsidianPanel';
import { GitSyncPanel } from '../views/memory/GitSyncPanel';
import { SemanticSearchPanel } from '../views/memory/SemanticSearchPanel';
import { ConfigPanel } from '../views/memory/ConfigPanel';
import { MemoryGraphPanel } from '../views/memory/MemoryGraphPanel';
import { VaultFromClipboardPanel } from '../views/memory/VaultFromClipboardPanel';
import { FromScreenshotPanel } from '../views/memory/FromScreenshotPanel';
import { VoiceNotesPanel } from '../components/VoiceNotesPanel';

type SubPanel = 'overview' | 'lightrag' | 'obsidian' | 'git' | 'semantic' | 'config' | 'graph' | 'webclip' | 'screenshot' | 'voice';

type Props = {
  snapshot?: unknown;
  settings?: unknown;
  vaultPath?: string;
};

const SOURCES: Array<{ id: SubPanel; label: string; icon: typeof BarChart }> = [
  { id: 'overview', label: 'Overview', icon: BarChart },
  { id: 'lightrag', label: 'LightRAG', icon: Brain },
  { id: 'obsidian', label: 'Obsidian', icon: FileText },
  { id: 'git', label: 'Git Sync', icon: GitBranch },
  { id: 'semantic', label: 'Search', icon: Search },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'config', label: 'Config', icon: Settings },
  { id: 'graph', label: 'Graph', icon: Network },
  { id: 'webclip', label: 'Web Clip', icon: Clipboard },
  { id: 'screenshot', label: 'OCR', icon: Scan },
];

export function MobileMemory({ vaultPath }: Props) {
  const [activeSource, setActiveSource] = useState<SubPanel>('overview');
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => setRefreshKey((k) => k + 1);

  const renderPanel = () => {
    const key = refreshKey;
    switch (activeSource) {
      case 'overview':
        return <MemoryOverview refreshKey={key} onRefresh={refresh} setActiveSubPanel={setActiveSource as (s: string) => void} />;
      case 'lightrag':
        return <LightragPanel refreshKey={key} />;
      case 'obsidian':
        return <ObsidianPanel refreshKey={key} />;
      case 'git':
        return <GitSyncPanel refreshKey={key} />;
      case 'semantic':
        return <SemanticSearchPanel refreshKey={key} />;
      case 'config':
        return <ConfigPanel refreshKey={key} />;
      case 'graph':
        return <MemoryGraphPanel refreshKey={key} />;
      case 'webclip':
        return <VaultFromClipboardPanel refreshKey={key} />;
      case 'screenshot':
        return <FromScreenshotPanel refreshKey={key} />;
      case 'voice':
        return <VoiceNotesPanel refreshKey={key} />;
      default:
        return null;
    }
  };

  return (
    <div className="mobile-memory">
      <div className="mobile-memory-tabs">
        {SOURCES.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              type="button"
              className={cn('mobile-memory-tab', activeSource === s.id && 'is-active')}
              onClick={() => setActiveSource(s.id)}
              aria-pressed={activeSource === s.id}
            >
              <Icon size={14} aria-hidden />
              {s.label}
            </button>
          );
        })}
      </div>

      <div className="mobile-memory-content">
        {renderPanel()}
      </div>
    </div>
  );
}
