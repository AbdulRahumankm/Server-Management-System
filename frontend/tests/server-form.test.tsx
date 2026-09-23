import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ServerForm } from '../components/servers/ServerForm';

describe('ServerForm', () => {
  it('shows validation errors when required fields are missing', async () => {
    const onSubmit = vi.fn();
    render(<ServerForm onSubmit={onSubmit} submitLabel="Create" />);

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText('Hostname is required')).toBeDefined();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits valid values', async () => {
    const onSubmit = vi.fn();
    render(<ServerForm onSubmit={onSubmit} submitLabel="Create" />);

    fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: 'web-01' } });
    fireEvent.change(screen.getByLabelText('IP Address'), { target: { value: '10.0.0.1' } });
    fireEvent.change(screen.getByLabelText('Application'), { target: { value: 'web' } });
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'Platform Team' } });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'deploy' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      hostname: 'web-01',
      ipAddress: '10.0.0.1',
      application: 'web',
      owner: 'Platform Team',
      username: 'deploy',
      os: 'LINUX',
      environment: 'PRODUCTION',
    });
    expect(onSubmit.mock.calls[0][1]).toBeNull();
  });

  it('shows an SSH credential section for Linux and switches to a Windows password section', async () => {
    const onSubmit = vi.fn();
    render(<ServerForm onSubmit={onSubmit} submitLabel="Create" />);

    expect(screen.getByText('SSH Credential')).toBeDefined();
    expect(screen.queryByText('Windows Credential')).toBeNull();

    fireEvent.change(screen.getByLabelText('Operating System'), { target: { value: 'WINDOWS' } });

    expect(await screen.findByText('Windows Credential')).toBeDefined();
    expect(screen.queryByText('SSH Credential')).toBeNull();

    fireEvent.change(screen.getByLabelText('Windows Credential'), {
      target: { value: 'PASSWORD' },
    });
    expect(await screen.findByLabelText('Password')).toBeDefined();
  });

  it('shows key format and file inputs when uploading an SSH key for a Linux server', async () => {
    const onSubmit = vi.fn();
    render(<ServerForm onSubmit={onSubmit} submitLabel="Create" />);

    fireEvent.change(screen.getByLabelText('SSH Credential'), { target: { value: 'SSH_KEY' } });

    expect(await screen.findByLabelText('Key Format')).toBeDefined();
    expect(screen.getByLabelText('Private Key File')).toBeDefined();
  });

  it('hides the credential section in edit mode', () => {
    const onSubmit = vi.fn();
    render(<ServerForm mode="edit" onSubmit={onSubmit} submitLabel="Save" />);

    expect(screen.queryByText('SSH Credential')).toBeNull();
    expect(screen.queryByText('Windows Credential')).toBeNull();
  });
});
