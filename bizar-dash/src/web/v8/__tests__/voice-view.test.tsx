/**
 * S43 — voice-view.test.tsx
 *
 * Renders the list, audio src uses /api/voice/:id/audio, and
 * Delete confirms + fires DELETE.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VoiceView } from '../views/Voice/VoiceView.js';

interface MockState {
  deletes: string[];
}

function installFetchMock(handler: (url: string) => Response, state?: MockState): MockState {
  const out: MockState = state ?? { deletes: [] };
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? 'GET').toUpperCase();
    if (method === 'DELETE') out.deletes.push(url);
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

describe('S43 VoiceView', () => {
  beforeEach(() => {
    if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders empty state when no memos', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/voice/list')) return jsonResponse(200, { memos: [] });
      return jsonResponse(200, {});
    });
    render(<VoiceView />);
    expect(await screen.findByTestId('voice-view')).toBeTruthy();
    expect(await screen.findByText('No voice memos')).toBeTruthy();
  });

  it('renders rows with audio src on /api/voice/:id/audio', async () => {
    installFetchMock((url) => {
      if (url.endsWith('/api/voice/list')) {
        return jsonResponse(200, { memos: [{ id: 'v1', filename: 'note.wav', durationMs: 4321 }] });
      }
      return jsonResponse(200, {});
    });
    render(<VoiceView />);
    const row = await screen.findByTestId('voice-row-v1');
    expect(row.textContent).toContain('note.wav');
    const audio = screen.getByTestId('voice-audio-v1') as HTMLAudioElement;
    expect(audio.getAttribute('src')).toBe('/api/voice/v1/audio');
  });

  it('DELETEs /api/voice/:id on confirm', async () => {
    const state = installFetchMock((url) => {
      if (url.endsWith('/api/voice/list')) {
        return jsonResponse(200, { memos: [{ id: 'v2', filename: 'x.wav' }] });
      }
      return jsonResponse(200, {});
    });
    render(<VoiceView />);
    fireEvent.click(await screen.findByTestId('voice-delete-v2'));
    fireEvent.click(await screen.findByTestId('voice-confirm-delete-v2'));
    await waitFor(() => {
      expect(state.deletes.find((u) => u.endsWith('/api/voice/v2'))).toBeTruthy();
    });
  });
});