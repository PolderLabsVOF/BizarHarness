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

// jsdom doesn't ship EventSource. AgentStreamPanel (Sprint S11) opens
// an SSE connection on mount, so we stub a no-op stand-in that lets the
// component subscribe without throwing. Tests that exercise the stream
// replace globalThis.EventSource with a mock before render.
if (typeof globalThis.EventSource === 'undefined') {
  class StubEventSource {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 2;
    readyState = 0;
    onopen: ((this: EventSource, ev: Event) => unknown) | null = null;
    onerror: ((this: EventSource, ev: Event) => unknown) | null = null;
    onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null;
    addEventListener(): void {}
    removeEventListener(): void {}
    close(): void { this.readyState = 2; }
    dispatchEvent(): boolean { return true; }
  }
  globalThis.EventSource = StubEventSource as unknown as typeof EventSource;
}

afterEach(() => {
  cleanup();
});
