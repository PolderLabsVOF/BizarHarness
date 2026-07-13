/**
 * S41 — config-view.test.tsx
 *
 * Verifies ConfigView tabs work, Runtime config PUTs /api/config
 * on Save, Providers panel shows the list + Delete (inline confirm),
 * and System LLM PUTs /api/llm/system-llm on Save.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ConfigView } from '../views/Config/ConfigView.js';

interface MockState {
  puts: Array<{ url: string; rawBody: string; parsedBody: unknown }>;
  deletes: string[];
}

function installFetchMock(handler: (url: string) => Response, state?: MockState): MockState {
  const out: MockState = state ?? { puts: [], deletes: [] };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (method === 'PUT' && init?.body) {
      const rawBody = String(init.body);
      let parsed: unknown = rawBody;
      try { parsed = JSON.parse(rawBody); } catch { /* keep raw */ }
      out.puts.push({ url, rawBody, parsedBody: parsed });
    } else if (method === 'DELETE') {
      out.deletes.push(url);
    }
    return handler(url);
  }) as unknown as typeof fetch;
  return out;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('S41 ConfigView', () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the runtime config tab by default', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/config')) return jsonResponse(200, { path: '/x', data: { foo: 1 }, raw: '{\n  "foo": 1\n}', exists: true });
      return jsonResponse(200, {});
    });
    render(<ConfigView />);
    expect(await screen.findByTestId('config-view')).toBeTruthy();
    expect(await screen.findByTestId('config-runtime-raw')).toBeTruthy();
  });

  it('PUTs /api/config on Save', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/config')) return jsonResponse(200, { path: '/x', data: {}, raw: '{}', exists: true });
      return jsonResponse(200, {});
    });
    render(<ConfigView />);
    const ta = await screen.findByTestId('config-runtime-raw');
    fireEvent.change(ta, { target: { value: '{"foo": 2}' } });
    fireEvent.click(screen.getByTestId('config-runtime-save'));
    await waitFor(() => {
      const hit = state.puts.find((p) => p.url.endsWith('/api/config'));
      expect(hit).toBeTruthy();
      // The textarea holds the raw JSON string; the route accepts either
      // a string or a parsed object. The fetch helper JSON-stringifies
      // its body, so we expect a JSON-encoded string here.
      expect(hit!.rawBody).toBe(JSON.stringify('{"foo": 2}'));
      expect(JSON.parse(JSON.parse(hit!.rawBody) as string)).toEqual({ foo: 2 });
    });
  });

  it('switches to the Providers tab and DELETEs a provider on confirm', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/config/providers')) return jsonResponse(200, { providers: [{ id: 'openai', name: 'OpenAI' }] });
      return jsonResponse(200, {});
    });
    render(<ConfigView />);
    fireEvent.click(await screen.findByTestId('config-tab-providers'));
    fireEvent.click(await screen.findByTestId('config-provider-delete-openai'));
    fireEvent.click(await screen.findByTestId('config-provider-confirm-delete-openai'));
    await waitFor(() => {
      expect(state.deletes.find((u) => u.endsWith('/api/config/providers/openai'))).toBeTruthy();
    });
  });

  it('switches to the System LLM tab and PUTs on Save', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/llm/system-llm')) return jsonResponse(200, { enabled: false, provider: null, model: null });
      return jsonResponse(200, {});
    });
    render(<ConfigView />);
    fireEvent.click(await screen.findByTestId('config-tab-system-llm'));
    fireEvent.input(await screen.findByTestId('config-system-llm-provider'), { target: { value: 'openai' } });
    fireEvent.input(await screen.findByTestId('config-system-llm-model'), { target: { value: 'gpt-4o-mini' } });
    fireEvent.click(await screen.findByTestId('config-system-llm-save'));
    await waitFor(() => {
      const hit = state.puts.find((p) => p.url.endsWith('/api/llm/system-llm'));
      expect(hit).toBeTruthy();
      expect((hit!.parsedBody as { provider: string }).provider).toBe('openai');
    });
  });
});