// src/web/views/Memory.tsx — v7.0.4 dedicated Memory tab.
//
// Two-column layout: source rail on the left (10 sources), main panel on
// the right (one sub-panel at a time). v7.0.4 swaps the legacy
// `.view view-memory memory-tab` + `.memory-tab-body` + `.memory-source-rail`
// shell for the design-system primitives (Box / ViewHeader / Grid /
// cx-classed nav buttons) so the Memory tab matches the rest of the
// dashboard theme. Sub-panels keep their own shell until a follow-up
// sprint per-component migrates them.

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
import { Box, Grid, IconButton, Inline, Stack, ViewHeader } from '../ui';
import { cx } from '../ui/utils/cx';
import { useToast } from '../components/Toast';
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

type SubPanel =
  | 'overview'
  | 'lightrag'
  | 'obsidian'
  | 'git'
  | 'semantic'
  | 'config'
  | 'graph'
  | 'webclip'
  | 'screenshot'
  | 'voice';

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
        return (
          <MemoryOverview
            refreshKey={refreshKey}
            onRefresh={refresh}
            setActiveSubPanel={(id) => setActive(id as SubPanel)}
          />
        );
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
        return null;
    }
  };

  return (
    <Box as="div" className="view view-memory" bg="0" p={7}>
      <Stack gap={5}>
        <ViewHeader
          title={
            <Inline gap={2} align="center">
              <Brain size={18} />
              <span>Memory</span>
            </Inline>
          }
          subtitle="LightRAG, Obsidian vault, git sync, semantic search, web clips, and screenshot OCR — all in one place."
          actions={
            <IconButton
              variant="ghost"
              size="md"
              onClick={onRefreshAll}
              aria-label="Refresh memory"
              title="Refresh"
              icon={<RefreshCw size={14} />}
            />
          }
        />

        <Grid
          cols={2}
          gap={4}
          style={{
            gridTemplateColumns: '240px 1fr',
            alignItems: 'start',
            minHeight: 0,
          }}
          data-testid="memory-grid"
        >
          {/* Source rail — Stack doesn't accept `as="nav"`, so wrap
             in <nav> directly and let Stack render its rows. */}
          <nav aria-label="Memory sources" data-testid="memory-source-rail">
            <Stack direction="column" gap={1}>
              {SOURCES.map((s) => {
                const Icon = s.icon;
                const isActive = active === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    className={cx(
                      'memory-source-button',
                      isActive && 'memory-source-button-active',
                    )}
                    onClick={() => setActive(s.id)}
                  >
                    <Icon size={16} aria-hidden />
                    <span>{s.label}</span>
                  </button>
                );
              })}
            </Stack>
          </nav>

          {/* Main panel */}
          <Box as="div" key={active} data-testid="memory-main-panel">
            {renderPanel()}
          </Box>
        </Grid>
      </Stack>
    </Box>
  );
}

export const Memory = React.memo(MemoryInner);
