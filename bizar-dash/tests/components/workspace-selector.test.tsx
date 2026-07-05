import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { WorkspaceSelector } from '../../src/web/components/WorkspaceSelector';

// Mock the api module
vi.mock('../../src/web/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ workspaces: [] }),
  },
}));

describe('WorkspaceSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders with default text when no workspace is selected', () => {
    render(
      <WorkspaceSelector
        currentWorkspaceId={null}
        onWorkspaceChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Workspace')).toBeInTheDocument();
  });

  it('opens dropdown on click', async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceSelector
        currentWorkspaceId={null}
        onWorkspaceChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('shows empty state in dropdown when no workspaces', async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceSelector
        currentWorkspaceId={null}
        onWorkspaceChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button'));
    expect(screen.getByText('No workspaces')).toBeInTheDocument();
  });

  it('renders workspace name when provided and API returns data', async () => {
    const { api } = await import('../../src/web/lib/api');
    (api.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      workspaces: [
        { workspace: { id: 'ws_abc', name: 'Engineering' }, role: 'admin' },
      ],
    });

    render(
      <WorkspaceSelector
        currentWorkspaceId="ws_abc"
        onWorkspaceChange={vi.fn()}
      />,
    );

    // Wait for the effect to run and state to update
    await waitFor(() => {
      expect(screen.getByText('Engineering')).toBeInTheDocument();
    });
  });
});
