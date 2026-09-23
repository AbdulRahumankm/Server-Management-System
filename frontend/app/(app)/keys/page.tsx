'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { apiFetch } from '@/lib/apiClient';
import { useCurrentUser } from '@/lib/useCurrentUser';
import type { SSHKeyMetadata } from '@/types/key';

export default function KeysPage() {
  const [search, setSearch] = useState('');
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const permissions = currentUser?.permissions ?? [];

  const { data: keys, isLoading, isError } = useQuery<SSHKeyMetadata[]>({
    queryKey: ['keys', search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      const res = await apiFetch(`/api/keys?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load keys');
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/keys/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete key');
    },
    onSuccess: () => {
      toast.success('Key deleted');
      queryClient.invalidateQueries({ queryKey: ['keys'] });
    },
    onError: () => toast.error('Failed to delete key'),
  });

  async function handleDownload(key: SSHKeyMetadata) {
    const res = await apiFetch(`/api/keys/${key.id}/download`);
    if (!res.ok) {
      toast.error('Failed to download key');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = key.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">SSH Keys</h1>
        {permissions.includes('key:upload') && (
          <Button asChild>
            <Link href="/keys/upload">Upload Key</Link>
          </Button>
        )}
      </div>

      <Input
        placeholder="Search key name"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 max-w-sm"
      />

      {isLoading && <p className="text-slate-500">Loading keys...</p>}
      {isError && <p className="text-red-600">Failed to load keys.</p>}
      {keys && keys.length === 0 && <p className="text-slate-500">No keys found.</p>}

      {keys && keys.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Assigned Server</TableHead>
              <TableHead>Last Accessed</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((key) => (
              <TableRow key={key.id}>
                <TableCell className="font-mono text-xs font-medium text-slate-900">
                  {key.name}
                </TableCell>
                <TableCell>{key.keyType}</TableCell>
                <TableCell>{key.owner.name}</TableCell>
                <TableCell className="font-mono text-xs">
                  {key.assignedServer?.hostname ?? '—'}
                </TableCell>
                <TableCell>
                  {key.lastAccessedAt ? new Date(key.lastAccessedAt).toLocaleString() : 'Never'}
                </TableCell>
                <TableCell className="flex gap-3">
                  {permissions.includes('key:download') && (
                    <button
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                      onClick={() => handleDownload(key)}
                    >
                      Download
                    </button>
                  )}
                  {permissions.includes('key:delete') && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button className="text-sm font-medium text-red-600 hover:text-red-700">
                          Delete
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogTitle>Delete {key.name}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently removes the encrypted key material. This cannot be undone.
                        </AlertDialogDescription>
                        <AlertDialogFooter>
                          <AlertDialogCancel asChild>
                            <Button variant="outline">Cancel</Button>
                          </AlertDialogCancel>
                          <AlertDialogAction asChild>
                            <Button variant="destructive" onClick={() => deleteMutation.mutate(key.id)}>
                              Delete
                            </Button>
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </main>
  );
}
