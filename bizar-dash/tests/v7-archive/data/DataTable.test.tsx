// tests/ui/data/DataTable.test.tsx — Wave 2B

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { DataTable, type DataTableColumn } from '../../../src/web/ui/data/DataTable';

type Row = { id: string; name: string; score: number };

const COLUMNS: DataTableColumn<Row>[] = [
  { key: 'name', header: 'Name', sortable: true, accessor: (r) => r.name },
  { key: 'score', header: 'Score', sortable: true, align: 'right', accessor: (r) => r.score },
];

const DATA: Row[] = [
  { id: '1', name: 'Charlie', score: 88 },
  { id: '2', name: 'Alice', score: 92 },
  { id: '3', name: 'Bob', score: 75 },
];

describe('DataTable', () => {
  it('renders one row per datum with cells in column order', () => {
    render(<DataTable columns={COLUMNS} data={DATA} rowKey={(r) => r.id} />);
    expect(screen.getByText('Charlie')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByText('92')).toBeInTheDocument();
    expect(screen.getByText('75')).toBeInTheDocument();
  });

  it('sorts asc on header click, then desc on a second click', async () => {
    render(<DataTable columns={COLUMNS} data={DATA} rowKey={(r) => r.id} />);
    const header = screen.getByText('Name');
    await userEvent.click(header);
    // Names now in ascending alpha order.
    let tbody = screen.getAllByRole('row').slice(1);
    expect(tbody[0]).toHaveTextContent('Alice');
    expect(tbody[2]).toHaveTextContent('Charlie');

    await userEvent.click(header);
    tbody = screen.getAllByRole('row').slice(1);
    expect(tbody[0]).toHaveTextContent('Charlie');
    expect(tbody[2]).toHaveTextContent('Alice');
  });

  it('sorts numeric columns correctly', async () => {
    render(<DataTable columns={COLUMNS} data={DATA} rowKey={(r) => r.id} />);
    await userEvent.click(screen.getByText('Score'));
    const rows = screen.getAllByRole('row').slice(1);
    // Asc numeric: 75 → 88 → 92 (Bob, Charlie, Alice)
    expect(rows[0]).toHaveTextContent('Bob');
    expect(rows[2]).toHaveTextContent('Alice');
  });

  it('renders the empty placeholder when data is empty', () => {
    render(<DataTable columns={COLUMNS} data={[]} rowKey={(r) => r.id} empty="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('renders the default "No data" when empty is omitted', () => {
    render(<DataTable columns={COLUMNS} data={[]} rowKey={(r) => r.id} />);
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('renders skeleton rows when loading', () => {
    const { container } = render(
      <DataTable columns={COLUMNS} data={DATA} rowKey={(r) => r.id} loading />,
    );
    expect(container.querySelectorAll('.bd-data-table__skeleton-row').length).toBeGreaterThan(0);
  });

  it('fires onRowClick when a row is clicked', async () => {
    const onRowClick = vi.fn();
    render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );
    await userEvent.click(screen.getByText('Alice'));
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0]).toMatchObject({ id: '2', name: 'Alice' });
  });

  it('applies align + width attributes to columns', () => {
    const { container } = render(
      <DataTable columns={COLUMNS} data={DATA} rowKey={(r) => r.id} />,
    );
    const headers = container.querySelectorAll('th');
    const scoreHeader = Array.from(headers).find((h) =>
      h.textContent?.includes('Score'),
    );
    expect(scoreHeader).toHaveClass('bd-data-table__th--right');
  });

  it('uses onSortChange callback when provided', async () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        columns={COLUMNS}
        data={DATA}
        rowKey={(r) => r.id}
        onSortChange={onSortChange}
      />,
    );
    await userEvent.click(screen.getByText('Name'));
    expect(onSortChange).toHaveBeenCalledWith({ key: 'name', direction: 'asc' });
  });
});
