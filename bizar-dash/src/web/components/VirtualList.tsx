// src/web/components/VirtualList.tsx — hand-rolled virtual scrolling (no external deps).
import React, { useState, useRef, useEffect, useMemo } from 'react';

export function VirtualList<T>({
  items,
  renderItem,
  itemHeight = 80,
  height = 400,
  overscan = 5,
  className,
}: {
  items: T[];
  renderItem: (item: T, index: number) => React.ReactNode;
  itemHeight?: number;
  height?: number;
  overscan?: number;
  className?: string;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const visibleRange = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const end = Math.min(
      items.length,
      Math.ceil((scrollTop + height) / itemHeight) + overscan,
    );
    return { start, end };
  }, [scrollTop, itemHeight, height, overscan, items.length]);

  const totalHeight = items.length * itemHeight;
  const offsetY = visibleRange.start * itemHeight;
  const visibleItems = items.slice(visibleRange.start, visibleRange.end);

  return (
    <div
      ref={containerRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      style={{ height, overflowY: 'auto' }}
      className={className}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleItems.map((item, i) => (
            <div key={visibleRange.start + i} style={{ height: itemHeight }}>
              {renderItem(item, visibleRange.start + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
