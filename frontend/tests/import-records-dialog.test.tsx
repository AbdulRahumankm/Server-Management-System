import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportRecordsDialog } from '../components/inventory/ImportRecordsDialog';

function csvFile(content: string, name = 'records.csv') {
  return new File([content], name, { type: 'text/csv' });
}

describe('ImportRecordsDialog', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ insertedCount: 2, errors: [] }),
      }),
    );
  });

  it('parses an uploaded CSV file and shows the detected row count', async () => {
    render(<ImportRecordsDialog entityId="entity-1" onImported={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));

    const input = screen.getByLabelText('Import file');
    const file = csvFile('hostname,status\nsw-01,Active\nsw-02,Retired\n');
    await userEvent.upload(input, file);

    expect(await screen.findByText(/2 row\(s\) detected/)).toBeDefined();
  });

  it('submits parsed rows to the bulk import endpoint and reports the result', async () => {
    const onImported = vi.fn();
    render(<ImportRecordsDialog entityId="entity-1" onImported={onImported} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Import' })[0]);

    const input = screen.getByLabelText('Import file');
    const file = csvFile('hostname,status\nsw-01,Active\nsw-02,Retired\n');
    await userEvent.upload(input, file);
    await screen.findByText(/2 row\(s\) detected/);

    const importButtons = screen.getAllByRole('button', { name: 'Import' });
    fireEvent.click(importButtons[importButtons.length - 1]);

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/inventory/entities/entity-1/records/bulk');
    expect(JSON.parse(init.body as string).records).toEqual([
      { hostname: 'sw-01', status: 'Active' },
      { hostname: 'sw-02', status: 'Retired' },
    ]);

    expect(await screen.findByText('2 row(s) imported successfully.')).toBeDefined();
  });
});
