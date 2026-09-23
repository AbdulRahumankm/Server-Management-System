'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { apiFetch } from '@/lib/apiClient';

interface RecordCredentialDialogProps {
  recordId: string;
  fieldName: string;
}

export function RecordCredentialDialog({ recordId, fieldName }: RecordCredentialDialogProps) {
  const [password, setPassword] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpenChange(open: boolean) {
    if (!open) {
      setPassword(null);
      setDownloaded(false);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    const res = await apiFetch(`/api/inventory/records/${recordId}/fields/${fieldName}/reveal`);
    setIsLoading(false);
    if (!res.ok) {
      setError('Failed to load credential');
      return;
    }
    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const body = await res.json();
      setPassword(body.value);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fieldName}.key`;
    link.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  }

  return (
    <Dialog onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button type="button" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
          View
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Credential</DialogTitle>
        {isLoading && <p className="mt-2 text-sm text-slate-500">Loading...</p>}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {password !== null && <p className="mt-2 font-mono text-sm text-slate-800">{password}</p>}
        {downloaded && (
          <p className="mt-2 text-sm text-slate-500">The key file download should start automatically.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
