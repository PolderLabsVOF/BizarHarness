/**
 * tests/voice-recorder.test.tsx
 *
 * v5.0.0 — Tests for VoiceRecorder React component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { VoiceRecorder } from '../src/web/components/VoiceRecorder';

// Mock the browser's MediaRecorder — use a class so `new MediaRecorder()` works
class MockMediaRecorder {
  constructor(stream, opts) {
    this.stream = stream;
    this.opts = opts;
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onstop = null;
    MockMediaRecorder.instances.push(this);
  }
  start() { this.state = 'recording'; }
  stop() { this.state = 'stopped'; this.onstop?.(); }
  static isTypeSupported() { return true; }
  static instances = [];
  static reset() { MockMediaRecorder.instances = []; }
}

const mockMediaStream = {
  getTracks: vi.fn(() => [{ stop: vi.fn() }]),
};

vi.stubGlobal('navigator', {
  mediaDevices: {
    getUserMedia: vi.fn(() => Promise.resolve(mockMediaStream)),
  },
});

vi.stubGlobal('MediaRecorder', MockMediaRecorder);

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('VoiceRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockMediaRecorder.reset();
    mockFetch.mockReset();
  });

  it('renders a Record button initially', () => {
    render(<VoiceRecorder />);
    const btn = screen.getByRole('button', { name: /start recording/i });
    expect(btn).toBeInTheDocument();
  });

  it('starts recording when Record is clicked', async () => {
    render(<VoiceRecorder />);
    const btn = screen.getByRole('button', { name: /start recording/i });
    fireEvent.click(btn);

    await waitFor(() => {
      expect(MockMediaRecorder.instances.length).toBe(1);
    });
    expect(MockMediaRecorder.instances[0].state).toBe('recording');
  });

  it('shows Stop button while recording', async () => {
    render(<VoiceRecorder />);
    const recordBtn = screen.getByRole('button', { name: /start recording/i });
    fireEvent.click(recordBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /stop recording/i })).toBeInTheDocument();
    });
  });

  it('shows Transcribing state after stopping', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ notePath: '/v/notes/abc.md', transcription: 'x' }),
    });

    render(<VoiceRecorder />);
    const recordBtn = screen.getByRole('button', { name: /start recording/i });
    fireEvent.click(recordBtn);

    const stopBtn = await screen.findByRole('button', { name: /stop recording/i });
    fireEvent.click(stopBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /transcribing/i })).toBeInTheDocument();
    });
  });
});
