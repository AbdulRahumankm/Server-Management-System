'use client';

import { use } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
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

  if (isLoading) return <main className="p-8">Loading...</main>;
  if (isError || !server) return <main className="p-8">Server not found.</main>;

  return (
    <main className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{server.hostname}</h1>
        <Button asChild>
          <Link href={`/servers/${server.id}/edit`}>Edit</Link>
        </Button>
      </div>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-medium">Basic Information</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">IP Address</dt>
          <dd>{server.ipAddress}</dd>
          <dt className="text-slate-500">OS</dt>
          <dd>{server.os}</dd>
          <dt className="text-slate-500">Environment</dt>
          <dd>{server.environment}</dd>
          <dt className="text-slate-500">Application</dt>
          <dd>{server.application}</dd>
          <dt className="text-slate-500">Owner</dt>
          <dd>{server.owner}</dd>
          <dt className="text-slate-500">Location</dt>
          <dd>{server.location ?? '—'}</dd>
        </dl>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-lg font-medium">Connection Information</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">Username</dt>
          <dd>{server.username}</dd>
          <dt className="text-slate-500">SSH Port</dt>
          <dd>{server.sshPort}</dd>
          <dt className="text-slate-500">Assigned SSH Key</dt>
          <dd>{server.assignedKey?.name ?? 'None'}</dd>
        </dl>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-medium">Activity</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">Created</dt>
          <dd>{new Date(server.createdAt).toLocaleString()}</dd>
          <dt className="text-slate-500">Updated</dt>
          <dd>{new Date(server.updatedAt).toLocaleString()}</dd>
        </dl>
      </section>
    </main>
  );
}
