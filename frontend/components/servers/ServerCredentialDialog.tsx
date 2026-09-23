'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { apiFetch } from '@/lib/apiClient';

interface ServerCredential {
  type: 'SSH_KEY' | 'PASSWORD' | 'NONE';
  keyId?: string;
  keyName?: string;
  username?: string;
  password?: string;
}

export function ServerCredentialDialog({ serverId }: { serverId: string }) {
  const [credential, setCredential] = useState<ServerCredential | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpenChange(open: boolean) {
    if (!open) {
      setCredential(null);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    const res = await apiFetch(`/api/servers/${serverId}/credential`);
    setIsLoading(false);
    if (!res.ok) {
      setError('Failed to load credential');
      return;
    }
    setCredential(await res.json());
  }

  return (
    <Dialog onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">View Credential</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Server Credential</DialogTitle>
        {isLoading && <p className="mt-2 text-sm text-slate-500">Loading...</p>}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        {credential?.type === 'NONE' && (
          <p className="mt-2 text-sm text-slate-500">No credential is stored for this server.</p>
        )}
        {credential?.type === 'SSH_KEY' && (
          <div className="mt-2 text-sm text-slate-800">
            <p>
              This server uses SSH key <span className="font-mono">{credential.keyName}</span>.
            </p>
            <p className="mt-2 text-slate-500">Download the private key from the Keys page.</p>
          </div>
        )}
        {credential?.type === 'PASSWORD' && (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm text-slate-800">
            <dt className="text-slate-500">Username</dt>
            <dd className="font-mono">{credential.username}</dd>
            <dt className="text-slate-500">Password</dt>
            <dd className="font-mono">{credential.password}</dd>
          </dl>
        )}
      </DialogContent>
    </Dialog>
  );
}
