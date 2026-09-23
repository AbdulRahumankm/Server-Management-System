'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { apiFetch } from '@/lib/apiClient';
import type { PaginatedAuditLogs } from '@/types/auditLog';

export default function AuditLogsPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const { data, isLoading, isError } = useQuery<PaginatedAuditLogs>({
    queryKey: ['audit-logs', { action, page }],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (action) params.set('action', action);
      const res = await apiFetch(`/api/audit-logs?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load audit logs');
      return res.json();
    },
  });

  return (
    <main className="p-8">
      <h1 className="mb-6 text-2xl font-semibold text-slate-900">Audit Logs</h1>

      <Input
        placeholder="Filter by action (e.g. SERVER_CREATED)"
        value={action}
        onChange={(e) => {
          setAction(e.target.value);
          setPage(1);
        }}
        className="mb-4 max-w-sm font-mono"
      />

      {isLoading && <p className="text-slate-500">Loading audit logs...</p>}
      {isError && <p className="text-red-600">Failed to load audit logs.</p>}
      {data && data.data.length === 0 && <p className="text-slate-500">No audit entries found.</p>}

      {data && data.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Resource</TableHead>
              <TableHead>IP Address</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.data.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell>{new Date(entry.createdAt).toLocaleString()}</TableCell>
                <TableCell>{entry.user?.email ?? 'Unknown'}</TableCell>
                <TableCell>
                  <span className="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-1 font-mono text-xs font-medium text-indigo-700">
                    {entry.action}
                  </span>
                </TableCell>
                <TableCell>
                  {entry.resourceType}
                  {entry.metadata && Object.keys(entry.metadata).length > 0
                    ? ` (${Object.values(entry.metadata).join(', ')})`
                    : ''}
                </TableCell>
                <TableCell className="font-mono text-xs">{entry.ipAddress ?? '—'}</TableCell>
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
