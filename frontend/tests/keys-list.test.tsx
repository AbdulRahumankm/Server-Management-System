import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import KeysPage from '../app/(app)/keys/page';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('KeysPage', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/auth/me')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              id: 'u1',
              email: 'viewer@example.com',
              name: 'Viewer',
              role: 'Viewer',
              permissions: ['key:view'],
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: 'k1',
              name: 'prod-web-key',
              keyType: 'ed25519',
              description: null,
              owner: { id: 'u1', name: 'Admin', email: 'admin@example.com' },
              lastAccessedAt: null,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              assignedServer: null,
            },
          ],
        });
      }),
    );
  });

  it('renders key metadata but hides the download action for a viewer', async () => {
    renderWithClient(<KeysPage />);
    expect(await screen.findByText('prod-web-key')).toBeDefined();
    expect(screen.queryByText('Download')).toBeNull();
  });
});
