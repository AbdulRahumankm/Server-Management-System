'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { StatusDot } from '@/components/ui/status-dot';
import { EnvironmentLabel } from '@/components/ui/environment-label';
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
import type { PaginatedServers } from '@/types/server';

export default function ServersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<PaginatedServers>({
    queryKey: ['servers', { search, page }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) params.set('search', search);
      const res = await apiFetch(`/api/servers?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load servers');
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/servers/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete server');
    },
    onSuccess: () => {
      toast.success('Server deleted');
      queryClient.invalidateQueries({ queryKey: ['servers'] });
    },
    onError: () => toast.error('Failed to delete server'),
  });

  return (
    <main className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Servers</h1>
        <Button asChild>
          <Link href="/servers/new">Add Server</Link>
        </Button>
      </div>

      <Input
        placeholder="Search hostname, IP, or application"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
        className="mb-4 max-w-sm"
      />

      {isLoading && <p className="text-slate-500">Loading servers...</p>}
      {isError && <p className="text-red-600">Failed to load servers.</p>}
      {data && data.data.length === 0 && <p className="text-slate-500">No servers found.</p>}

      {data && data.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Hostname</TableHead>
              <TableHead>IP Address</TableHead>
              <TableHead>OS</TableHead>
              <TableHead>Environment</TableHead>
              <TableHead>Application</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.data.map((server) => (
              <TableRow key={server.id}>
                <TableCell className="font-mono text-xs font-medium text-slate-900">
                  {server.hostname}
                </TableCell>
                <TableCell className="font-mono text-xs">{server.ipAddress}</TableCell>
                <TableCell>{server.os}</TableCell>
                <TableCell>
                  <EnvironmentLabel environment={server.environment} />
                </TableCell>
                <TableCell>{server.application}</TableCell>
                <TableCell>{server.owner}</TableCell>
                <TableCell>
                  <StatusDot status={server.status} />
                </TableCell>
                <TableCell className="flex gap-3">
                  <Link
                    href={`/servers/${server.id}`}
                    className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    View
                  </Link>
                  <Link
                    href={`/servers/${server.id}/edit`}
                    className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    Edit
                  </Link>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button className="text-sm font-medium text-red-600 hover:text-red-700">
                        Delete
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogTitle>Delete {server.hostname}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This cannot be undone. The server record will be permanently removed.
                      </AlertDialogDescription>
                      <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                          <Button variant="outline">Cancel</Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                          <Button
                            variant="destructive"
                            onClick={() => deleteMutation.mutate(server.id)}
                          >
                            Delete
                          </Button>
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {data && data.total > pageSize && (
        <div className="mt-4 flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-slate-500">
            Page {data.page} of {Math.ceil(data.total / data.pageSize)}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page * pageSize >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </main>
  );
}
