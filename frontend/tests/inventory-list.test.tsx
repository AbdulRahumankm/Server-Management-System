import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import InventoryPage from '../app/(app)/inventory/page';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('InventoryPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [
          {
            id: 'e1',
            name: 'Network Devices',
            description: 'Switches and routers',
            fields: [
              {
                id: 'f1',
                fieldName: 'hostname',
                fieldType: 'TEXT',
                required: true,
                options: null,
                displayOrder: 0,
              },
            ],
            _count: { records: 3 },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      }),
    );
  });

  it('renders inventory entities returned from the API', async () => {
    renderWithClient(<InventoryPage />);
    expect(await screen.findByText('Network Devices')).toBeDefined();
    expect(screen.getByText(/3 records/)).toBeDefined();
  });
});
