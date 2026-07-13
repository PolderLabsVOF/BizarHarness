/**
 * S43 — artifacts-view.test.tsx
 *
 * Renders list, opens detail Sheet, confirms DELETE.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ArtifactsView } from '../views/Artifacts/ArtifactsView.js';

interface MockState {
  posts: Array<{ url: string; body: unknown }>;
  deletes: string[];
}

function installFetchMock(handler: (url: string) => Response, state?: MockState): MockState {
  const out: MockState = state ?? { posts: [], deletes: [] };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (method === 'POST' && init?.body) {
      let parsed: unknown = init.body;
      try { parsed = JSON.parse(String(init.body)); } catch { /* keep raw */ }
      out.posts.push({ url, body: parsed });
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

describe('S43 ArtifactsView', () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders empty state when no artifacts', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/artifacts')) return jsonResponse(200, { artifacts: [] });
      return jsonResponse(200, {});
    });
    render(<ArtifactsView />);
    expect(await screen.findByTestId('artifacts-view')).toBeTruthy();
    expect(await screen.findByText('No artifacts')).toBeTruthy();
  });

  it('POSTs /api/artifacts from Add Sheet', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/artifacts')) return jsonResponse(200, { artifacts: [] });
      return jsonResponse(200, {});
    });
    render(<ArtifactsView />);
    fireEvent.click(await screen.findByTestId('artifacts-add'));
    fireEvent.input(await screen.findByTestId('artifact-form-slug'), { target: { value: 'foo-plan' } });
    fireEvent.input(await screen.findByTestId('artifact-form-title'), { target: { value: 'Foo plan' } });
    fireEvent.click(await screen.findByTestId('artifact-form-submit'));
    await waitFor(() => {
      const hit = state.posts.find((p) => p.url.endsWith('/api/artifacts'));
      expect(hit).toBeTruthy();
      expect((hit!.body as { slug: string }).slug).toBe('foo-plan');
    });
  });

  it('DELETEs /api/artifacts/:slug on confirm', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/artifacts')) {
        return jsonResponse(200, { artifacts: [{ slug: 'plan-a', title: 'Plan A' }] });
      }
      return jsonResponse(200, {});
    });
    render(<ArtifactsView />);
    fireEvent.click(await screen.findByTestId('artifact-delete-plan-a'));
    fireEvent.click(await screen.findByTestId('artifact-confirm-delete-plan-a'));
    await waitFor(() => {
      expect(state.deletes.find((u) => u.endsWith('/api/artifacts/plan-a'))).toBeTruthy();
    });
  });

  it('opens detail Sheet on Open click', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/artifacts')) return jsonResponse(200, { artifacts: [{ slug: 'plan-x', title: 'Plan X' }] });
      if (url.endsWith('/api/artifacts/plan-x')) return jsonResponse(200, { slug: 'plan-x', title: 'Plan X', description: 'desc', planMdx: '# X', frontmatter: { kind: 'plan' } });
      if (url.endsWith('/api/artifacts/plan-x/render')) return jsonResponse(200, { blocks: [{}, {}] });
      return jsonResponse(200, {});
    });
    render(<ArtifactsView />);
    fireEvent.click(await screen.findByTestId('artifact-open-plan-x'));
    expect(await screen.findByTestId('artifact-frontmatter-plan-x')).toBeTruthy();
    expect(await screen.findByTestId('artifact-mdx-plan-x')).toBeTruthy();
  });
});