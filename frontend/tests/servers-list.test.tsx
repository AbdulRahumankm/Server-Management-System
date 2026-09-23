import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ServersPage from '../app/(app)/servers/page';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ServersPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              id: '1',
              hostname: 'web-01',
              ipAddress: '10.0.0.1',
              os: 'LINUX',
              environment: 'PRODUCTION',
              application: 'web',
              owner: 'Platform Team',
              status: 'ACTIVE',
              createdAt: new Date().toISOString(),
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        }),
      }),
    );
  });

  it('renders servers returned from the API', async () => {
    renderWithClient(<ServersPage />);
    expect(await screen.findByText('web-01')).toBeDefined();
    expect(screen.getByText('10.0.0.1')).toBeDefined();
  });
});
