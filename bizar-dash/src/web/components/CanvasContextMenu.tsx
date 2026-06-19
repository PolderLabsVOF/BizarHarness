// src/components/CanvasContextMenu.tsx — v3.3.2 reusable right-click context menu.
import { useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';

export type ContextMenuItem =
  | { type?: 'item'; label: string; icon?: LucideIcon; onClick: () => void; disabled?: boolean }
  | { type: 'separator' };

export type ContextMenuState = {
  x: number;
  y: number;
  items: ContextMenuItem[];
} | null;

type Props = {
  menu: ContextMenuState;
  onClose: () => void;
};

export function CanvasContextMenu({ menu, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('contextmenu', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('contextmenu', handler);
    };
  }, [menu, onClose]);

  if (!menu) return null;

  // Clamp so the menu doesn't overflow the viewport
  const style: React.CSSProperties = {
    left: Math.min(menu.x, window.innerWidth - 200),
    top: Math.min(menu.y, window.innerHeight - 40),
  };

  return (
    <div ref={ref} className="canvas-context-menu" style={style}>
      {menu.items.map((item, i) =>
        item.type === 'separator' ? (
          <div key={`sep-${i}`} className="canvas-context-menu-sep" />
        ) : (
          <button
            key={i}
            className="canvas-context-menu-item"
            disabled={item.disabled}
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            {item.icon && <item.icon size={14} />}
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
