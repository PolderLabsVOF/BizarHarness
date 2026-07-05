/**
 * tests/backup-restore.test.tsx
 *
 * v4.8.0 — Component test for BackupRestoreCard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { BackupRestoreCard } from '../src/web/components/BackupRestore';

// Mock the API
vi.mock('../src/web/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    del: vi.fn(),
  },
}));

// Mock the Toast
vi.mock('../src/web/components/Toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// Mock the Modal
vi.mock('../src/web/components/Modal', () => ({
  useModal: () => ({
    open: vi.fn(),
    close: vi.fn(),
    isModalOpen: false,
  }),
}));

import { api } from '../src/web/lib/api';

const mockBackups = [
  {
    path: '/tmp/backups/bizar-2025-07-05-120000',
    name: 'bizar-2025-07-05-120000',
    createdAt: '2025-07-05T12:00:00.000Z',
    sizeBytes: 4096,
    sizeFormatted: '4.0 KB',
    manifest: {
      version: '4.8.0',
      createdAt: '2025-07-05T12:00:00.000Z',
      label: null,
      paths: ['config', 'opencode'],
    },
  },
];

describe('BackupRestoreCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, backups: mockBackups });
    (api.post as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, path: '/tmp/backups/bizar-2025-07-05-120000', sizeBytes: 4096, durationMs: 100 });
  });

  it('renders the card title', async () => {
    render(<BackupRestoreCard />);
    expect(screen.getByText(/Backup.*Restore/i)).toBeTruthy();
  });

  it('renders the create backup button', async () => {
    render(<BackupRestoreCard />);
    expect(screen.getByRole('button', { name: /create backup/i })).toBeTruthy();
  });

  it('shows loading state initially', async () => {
    render(<BackupRestoreCard />);
    expect(screen.getByText(/Loading backups/i)).toBeTruthy();
  });

  it('renders backup list after loading', async () => {
    render(<BackupRestoreCard />);
    await waitFor(() => {
      expect(screen.getByText(/bizar-2025-07-05-120000/)).toBeTruthy();
    });
  });

  it('calls create backup API when create button is clicked', async () => {
    render(<BackupRestoreCard />);
    await waitFor(() => {
      expect(screen.getByText(/bizar-2025-07-05-120000/)).toBeTruthy();
    });
    const createBtn = screen.getByRole('button', { name: /create backup/i });
    fireEvent.click(createBtn);
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/backup/create', expect.objectContaining({}));
    });
  });

  it('calls verify API when verify button is clicked', async () => {
    render(<BackupRestoreCard />);
    await waitFor(() => {
      expect(screen.getByText(/bizar-2025-07-05-120000/)).toBeTruthy();
    });
    const verifyBtn = screen.getByRole('button', { name: /verify/i });
    fireEvent.click(verifyBtn);
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/backup/verify', expect.objectContaining({
        backupPath: '/tmp/backups/bizar-2025-07-05-120000',
      }));
    });
  });

  it('opens restore dialog when restore button is clicked', async () => {
    const { useModal } = await import('../src/web/components/Modal');
    render(<BackupRestoreCard />);
    await waitFor(() => {
      expect(screen.getByText(/bizar-2025-07-05-120000/)).toBeTruthy();
    });
    const restoreBtn = screen.getByRole('button', { name: /restore/i });
    fireEvent.click(restoreBtn);
    // Modal should open
    const modalOpen = (useModal as ReturnType<typeof vi.fn>).mock.results[0]?.value?.open;
    expect(modalOpen).toHaveBeenCalled();
  });
});
