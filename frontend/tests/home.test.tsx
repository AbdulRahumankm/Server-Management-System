import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomePage from '../app/page';

describe('HomePage', () => {
  it('renders the platform title and a sign-in button', () => {
    render(<HomePage />);
    expect(screen.getByText('Server Inventory Platform')).toBeDefined();
    expect(screen.getByText('Sign in')).toBeDefined();
  });
});
