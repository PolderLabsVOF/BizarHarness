// src/web/components/MobileLayout.tsx — main mobile shell: header + drawer + content + bottom nav.
import { useState } from 'react';
import { MobileHeader } from './MobileHeader';
import { MobileDrawer, type DrawerTab } from './MobileDrawer';
import { MobileBottomNav, type MobileTab } from './MobileBottomNav';

// Re-export DrawerTab so consumers only need to import from MobileLayout.
export { type DrawerTab } from './MobileDrawer';

type Props = {
  children: React.ReactNode;
  activeTab: string;
  onTabChange: (id: string) => void;
  tabs: MobileTab[];
  fullTabs: DrawerTab[];
  onExitSettings?: () => void;
  onSearch?: () => void;
};

export function MobileLayout({
  children,
  activeTab,
  onTabChange,
  tabs,
  fullTabs,
  onExitSettings,
  onSearch,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  return (
    <div className="mobile-layout">
      <MobileHeader
        onMenuClick={() => setDrawerOpen(true)}
        scrolled={scrolled}
        activeTab={activeTab}
        onSettings={activeTab === 'settings' ? onExitSettings : null}
        onSearch={onSearch}
      />

      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        tabs={fullTabs}
        activeTab={activeTab}
        onTabChange={(id) => {
          onTabChange(id);
          setDrawerOpen(false);
        }}
      />

      <main
        className="mobile-content"
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 10)}
      >
        {children}
      </main>

      <MobileBottomNav tabs={tabs} activeTab={activeTab} onTabChange={onTabChange} />
    </div>
  );
}
