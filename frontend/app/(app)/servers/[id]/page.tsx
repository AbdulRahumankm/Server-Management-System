'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { EnvironmentLabel } from '@/components/ui/environment-label';
import { ServerCredentialDialog } from '@/components/servers/ServerCredentialDialog';
import { apiFetch } from '@/lib/apiClient';
import { useCurrentUser } from '@/lib/useCurrentUser';
import type { Server } from '@/types/server';

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="mb-3 text-lg font-medium text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

export default function ServerDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: currentUser } = useCurrentUser();
  const permissions = currentUser?.permissions ?? [];

  const { data: server, isLoading, isError } = useQuery<Server>({
    queryKey: ['servers', id],
    queryFn: async () => {
      const res = await apiFetch(`/api/servers/${id}`);
      if (!res.ok) throw new Error('Failed to load server');
      return res.json();
    },
  });

  if (isLoading) return <main className="p-8 text-slate-500">Loading...</main>;
  if (isError || !server) return <main className="p-8 text-slate-500">Server not found.</main>;

  return (
    <main className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-mono text-2xl font-semibold text-slate-900">{server.hostname}</h1>
        <div className="flex gap-2">
          {permissions.includes('key:download') && <ServerCredentialDialog serverId={server.id} />}
          <Button asChild>
            <Link href={`/servers/${server.id}/edit`}>Edit</Link>
          </Button>
        </div>
      </div>

      <InfoSection title="Basic Information">
        <dl className="grid grid-cols-2 gap-2 text-sm text-slate-800">
          <dt className="text-slate-500">IP Address</dt>
          <dd className="font-mono">{server.ipAddress}</dd>
          <dt className="text-slate-500">OS</dt>
          <dd>{server.os}</dd>
          <dt className="text-slate-500">Environment</dt>
          <dd>
            <EnvironmentLabel environment={server.environment} />
          </dd>
          <dt className="text-slate-500">Application</dt>
          <dd>{server.application}</dd>
          <dt className="text-slate-500">Owner</dt>
          <dd>{server.owner}</dd>
          <dt className="text-slate-500">Location</dt>
          <dd>{server.location ?? '—'}</dd>
        </dl>
      </InfoSection>

      <InfoSection title="Connection Information">
        <dl className="grid grid-cols-2 gap-2 text-sm text-slate-800">
          <dt className="text-slate-500">Username</dt>
          <dd className="font-mono">{server.username}</dd>
          <dt className="text-slate-500">SSH Port</dt>
          <dd className="font-mono">{server.sshPort}</dd>
          <dt className="text-slate-500">Assigned SSH Key</dt>
          <dd>{server.assignedKey?.name ?? 'None'}</dd>
        </dl>
      </InfoSection>

      <InfoSection title="Activity">
        <dl className="grid grid-cols-2 gap-2 text-sm text-slate-800">
          <dt className="text-slate-500">Created</dt>
          <dd>{new Date(server.createdAt).toLocaleString()}</dd>
          <dt className="text-slate-500">Updated</dt>
          <dd>{new Date(server.updatedAt).toLocaleString()}</dd>
        </dl>
      </InfoSection>
    </main>
  );
}
