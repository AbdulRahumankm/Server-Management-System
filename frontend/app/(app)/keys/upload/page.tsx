'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiFetch } from '@/lib/apiClient';

export default function UploadKeyPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [keyType, setKeyType] = useState('ed25519');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      toast.error('Select a key file');
      return;
    }

    setIsSubmitting(true);
    const formData = new FormData();
    formData.set('name', name);
    formData.set('keyType', keyType);
    formData.set('description', description);
    formData.set('file', file);

    const res = await apiFetch('/api/keys', { method: 'POST', body: formData });
    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? 'Failed to upload key');
      return;
    }

    toast.success('Key uploaded');
    router.push('/keys');
  }

  return (
    <main className="p-8">
      <h1 className="mb-6 text-2xl font-semibold text-slate-900 dark:text-slate-50">
        Upload SSH Key
      </h1>
      <form onSubmit={handleSubmit} className="flex max-w-xl flex-col gap-4">
        <div>
          <Label htmlFor="name">Key Name</Label>
          <Input
            id="name"
            className="font-mono"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <Label htmlFor="keyType">Key Type</Label>
          <select
            id="keyType"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            value={keyType}
            onChange={(e) => setKeyType(e.target.value)}
          >
            <option value="ed25519">ed25519</option>
            <option value="rsa">rsa</option>
            <option value="ecdsa">ecdsa</option>
            <option value="dsa">dsa</option>
          </select>
        </div>
        <div>
          <Label htmlFor="description">Description</Label>
          <textarea
            id="description"
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-50"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="file">Private Key File</Label>
          <input
            id="file"
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block text-sm text-slate-700 dark:text-slate-300"
            required
          />
        </div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Uploading...' : 'Upload Key'}
        </Button>
      </form>
    </main>
  );
}
