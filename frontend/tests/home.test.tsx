import { describe, it, expect, vi } from 'vitest';
import HomePage from '../app/page';

const redirectMock = vi.fn();
vi.mock('next/navigation', () => ({
  redirect: (path: string) => redirectMock(path),
}));

describe('HomePage', () => {
  it('redirects to /dashboard', () => {
    HomePage();
    expect(redirectMock).toHaveBeenCalledWith('/dashboard');
  });
});
