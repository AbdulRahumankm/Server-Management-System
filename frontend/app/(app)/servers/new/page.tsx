'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ServerForm, ServerFormValues } from '@/components/servers/ServerForm';
import { apiFetch } from '@/lib/apiClient';

export default function NewServerPage() {
  const router = useRouter();

  async function handleSubmit(values: ServerFormValues, credentialFile: File | null) {
    let body: BodyInit;
    if (credentialFile) {
      const formData = new FormData();
      for (const [key, value] of Object.entries(values)) {
        if (value !== undefined && value !== null) {
          formData.set(key, String(value));
        }
      }
      formData.set('credentialFile', credentialFile);
      body = formData;
    } else {
      body = JSON.stringify(values);
    }

    const res = await apiFetch('/api/servers', { method: 'POST', body });

    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      toast.error(errorBody.error ?? 'Failed to create server');
      return;
    }

    const server = await res.json();
    toast.success('Server created');
    router.push(`/servers/${server.id}`);
  }

  return (
    <main className="p-8">
      <h1 className="mb-6 text-2xl font-semibold text-slate-900">Add Server</h1>
      <ServerForm onSubmit={handleSubmit} submitLabel="Create Server" />
    </main>
  );
}
