import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom doesn't ship ResizeObserver, but @xyflow/react (and other
// layout libs) expect it to be present. Stub a no-op so React renders
// don't crash when a component mounts a graph.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom doesn't ship IntersectionObserver either; SettingsView uses it
// to sync the left-rail highlight with scroll position. Stub so the
// effect's `new IntersectionObserver(...)` doesn't throw.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = class {
    readonly root: Element | null = null;
    readonly rootMargin = '';
    readonly thresholds: ReadonlyArray<number> = [];
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  } as unknown as typeof IntersectionObserver;
}

// Similarly for matchMedia — used by some component libs that the
// dashboard pulls in. jsdom ships an empty stub but it lacks the
// addEventListener/removeEventListener pair that React 18 expects.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// jsdom does not implement Element#scrollIntoView, but `cmdk` calls it on
// the highlighted item during keyboard navigation. Stub a no-op so tests
// that mount <Dialog><CommandPalette/></Dialog> don't throw.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView(): void {
    /* noop */
  };
}

afterEach(() => {
  cleanup();
});
