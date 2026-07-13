/**
 * S40 — auth-view.test.tsx
 *
 * Verifies AuthView shows auth status, reveals the bearer token
 * via /api/auth/reveal, and rotates via /api/auth/regenerate with
 * inline confirm.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AuthView } from '../views/Auth/AuthView.js';

interface MockState {
  posts: Array<{ url: string; body: unknown }>;
  gets: string[];
}

function installFetchMock(handler: (url: string) => Response, state?: MockState): MockState {
  const out: MockState = state ?? { posts: [], gets: [] };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (method === 'POST') {
      try { out.posts.push({ url, body: JSON.parse(String(init?.body ?? '{}')) }); } catch { /* swallow */ }
    } else {
      out.gets.push(url);
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

describe('S40 AuthView', () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders status from /api/auth/status', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/auth/status')) return jsonResponse(200, { required: true, loopback: false });
      if (url.endsWith('/api/auth/reveal')) return jsonResponse(200, { token: 'sec1' });
      return jsonResponse(200, {});
    });
    render(<AuthView />);
    expect(await screen.findByTestId('auth-view')).toBeTruthy();
    expect(await screen.findByTestId('auth-required')).toBeTruthy();
  });

  it('hits /api/auth/reveal on the Reveal button', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/auth/status')) return jsonResponse(200, { required: true, loopback: true });
      if (url.endsWith('/api/auth/reveal')) return jsonResponse(200, { token: 'sec1' });
      return jsonResponse(200, {});
    });
    render(<AuthView />);
    fireEvent.click(await screen.findByTestId('auth-reveal'));
    await waitFor(() => {
      expect(state.gets.find((u) => u.endsWith('/api/auth/reveal'))).toBeTruthy();
    });
    expect(await screen.findByTestId('auth-token-input')).toBeTruthy();
  });

  it('shows inline confirm before regenerating the token', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/auth/status')) return jsonResponse(200, { required: true, loopback: true });
      if (url.endsWith('/api/auth/reveal')) return jsonResponse(200, { token: 'sec1' });
      if (url.endsWith('/api/auth/regenerate')) return jsonResponse(200, { token: 'sec2' });
      return jsonResponse(200, {});
    });
    render(<AuthView />);
    fireEvent.click(await screen.findByTestId('auth-reveal'));
    fireEvent.click(await screen.findByTestId('auth-regen'));
    expect(await screen.findByTestId('auth-confirm-regen')).toBeTruthy();
    expect(state.posts.find((p) => p.url.endsWith('/api/auth/regenerate'))).toBeUndefined();
    fireEvent.click(await screen.findByTestId('auth-confirm-regen'));
    await waitFor(() => {
      expect(state.posts.find((p) => p.url.endsWith('/api/auth/regenerate'))).toBeTruthy();
    });
  });
});