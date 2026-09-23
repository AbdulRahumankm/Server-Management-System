'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ServerForm, ServerFormValues } from '@/components/servers/ServerForm';
import { apiFetch } from '@/lib/apiClient';

export default function NewServerPage() {
  const router = useRouter();

  async function handleSubmit(values: ServerFormValues) {
    const res = await apiFetch('/api/servers', {
      method: 'POST',
      body: JSON.stringify(values),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? 'Failed to create server');
      return;
    }

    const server = await res.json();
    toast.success('Server created');
    router.push(`/servers/${server.id}`);
  }

  return (
    <main className="p-8">
      <h1 className="mb-6 text-2xl font-semibold text-slate-900 dark:text-slate-50">Add Server</h1>
      <ServerForm onSubmit={handleSubmit} submitLabel="Create Server" />
    </main>
  );
}
