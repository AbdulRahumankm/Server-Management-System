'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { EnvironmentLabel } from '@/components/ui/environment-label';
import { apiFetch } from '@/lib/apiClient';
import type { Server } from '@/types/server';

export default function ServerDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: server, isLoading, isError } = useQuery<Server>({
    queryKey: ['servers', id],
    queryFn: async () => {
      const res = await apiFetch(`/api/servers/${id}`);
      if (!res.ok) throw new Error('Failed to load server');
      return res.json();
    },
  });

  if (isLoading) return <main className="p-8 text-slate-500 dark:text-slate-400">Loading...</main>;
  if (isError || !server)
    return <main className="p-8 text-slate-500 dark:text-slate-400">Server not found.</main>;

  return (
    <main className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-mono text-2xl font-semibold text-slate-900 dark:text-slate-50">
          {server.hostname}
        </h1>
        <Button asChild>
          <Link href={`/servers/${server.id}/edit`}>Edit</Link>
        </Button>
      </div>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-medium text-slate-900 dark:text-slate-50">
          Basic Information
        </h2>
        <dl className="grid grid-cols-2 gap-2 text-sm text-slate-800 dark:text-slate-200">
          <dt className="text-slate-500 dark:text-slate-400">IP Address</dt>
          <dd className="font-mono">{server.ipAddress}</dd>
          <dt className="text-slate-500 dark:text-slate-400">OS</dt>
          <dd>{server.os}</dd>
          <dt className="text-slate-500 dark:text-slate-400">Environment</dt>
          <dd>
            <EnvironmentLabel environment={server.environment} />
          </dd>
          <dt className="text-slate-500 dark:text-slate-400">Application</dt>
          <dd>{server.application}</dd>
          <dt className="text-slate-500 dark:text-slate-400">Owner</dt>
          <dd>{server.owner}</dd>
          <dt className="text-slate-500 dark:text-slate-400">Location</dt>
          <dd>{server.location ?? '—'}</dd>
        </dl>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-medium text-slate-900 dark:text-slate-50">
          Connection Information
        </h2>
        <dl className="grid grid-cols-2 gap-2 text-sm text-slate-800 dark:text-slate-200">
          <dt className="text-slate-500 dark:text-slate-400">Username</dt>
          <dd className="font-mono">{server.username}</dd>
          <dt className="text-slate-500 dark:text-slate-400">SSH Port</dt>
          <dd className="font-mono">{server.sshPort}</dd>
          <dt className="text-slate-500 dark:text-slate-400">Assigned SSH Key</dt>
          <dd>{server.assignedKey?.name ?? 'None'}</dd>
        </dl>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium text-slate-900 dark:text-slate-50">Activity</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm text-slate-800 dark:text-slate-200">
          <dt className="text-slate-500 dark:text-slate-400">Created</dt>
          <dd>{new Date(server.createdAt).toLocaleString()}</dd>
          <dt className="text-slate-500 dark:text-slate-400">Updated</dt>
          <dd>{new Date(server.updatedAt).toLocaleString()}</dd>
        </dl>
      </section>
    </main>
  );
}
