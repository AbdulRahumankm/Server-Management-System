import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UploadKeyPage from '../app/(app)/keys/upload/page';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

// UploadKeyPage's inputs use the native `required` attribute (unlike the
// RHF-driven forms elsewhere, which validate in JS only), so jsdom's real
// constraint validation blocks a submit-button click before onSubmit runs.
// Dispatch the submit event directly on the form to bypass that gate --
// the standard testing-library pattern for this, not a workaround around a
// bug in the component.
function submitForm(container: HTMLElement) {
  const form = container.querySelector('form');
  if (!form) throw new Error('form not found');
  fireEvent.submit(form);
}

describe('UploadKeyPage', () => {
  beforeEach(() => {
    pushMock.mockClear();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('submits the form as multipart FormData and redirects to /keys on success', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const user = userEvent.setup();
    const { container } = render(<UploadKeyPage />);

    await user.type(screen.getByLabelText('Key Name'), 'ci-key');
    const file = new File(['-----BEGIN OPENSSH PRIVATE KEY-----'], 'id_ed25519', {
      type: 'text/plain',
    });
    await user.upload(screen.getByLabelText('Private Key File'), file);
    submitForm(container);

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/keys'));

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('does not redirect when the upload is rejected', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'File does not look like a PEM-encoded private key' }),
    });

    const user = userEvent.setup();
    const { container } = render(<UploadKeyPage />);
    await user.type(screen.getByLabelText('Key Name'), 'bad-key');
    const file = new File(['not a key'], 'bad.txt');
    await user.upload(screen.getByLabelText('Private Key File'), file);
    submitForm(container);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(pushMock).not.toHaveBeenCalled();
  });
});
