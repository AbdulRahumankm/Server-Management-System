'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ServerForm, ServerFormValues } from '@/components/servers/ServerForm';
import { apiFetch } from '@/lib/apiClient';
import type { Server } from '@/types/server';

export default function EditServerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const { data: server, isLoading } = useQuery<Server>({
    queryKey: ['servers', id],
    queryFn: async () => {
      const res = await apiFetch(`/api/servers/${id}`);
      if (!res.ok) throw new Error('Failed to load server');
      return res.json();
    },
  });

  async function handleSubmit(values: ServerFormValues) {
    const res = await apiFetch(`/api/servers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(values),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? 'Failed to update server');
      return;
    }

    toast.success('Server updated');
    router.push(`/servers/${id}`);
  }

  if (isLoading) return <main className="p-8 text-slate-500">Loading...</main>;
  if (!server) return <main className="p-8 text-slate-500">Server not found.</main>;

  return (
    <main className="p-8">
      <h1 className="mb-6 text-2xl font-semibold text-slate-900">
        Edit <span className="font-mono">{server.hostname}</span>
      </h1>
      <ServerForm
        mode="edit"
        defaultValues={{
          hostname: server.hostname,
          ipAddress: server.ipAddress,
          os: server.os,
          environment: server.environment,
          application: server.application,
          owner: server.owner,
          location: server.location ?? undefined,
          username: server.username,
          sshPort: server.sshPort,
          description: server.description ?? undefined,
        }}
        onSubmit={handleSubmit}
        submitLabel="Save Changes"
      />
    </main>
  );
}
