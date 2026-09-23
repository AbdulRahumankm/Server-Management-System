'use client';

import { use, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogTrigger, DialogContent, DialogTitle } from '@/components/ui/dialog';
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
import { DynamicRecordForm } from '@/components/inventory/DynamicRecordForm';
import { ImportRecordsDialog } from '@/components/inventory/ImportRecordsDialog';
import { apiFetch } from '@/lib/apiClient';
import type { InventoryEntity, PaginatedInventoryRecords } from '@/types/inventory';

export default function InventoryEntityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [addOpen, setAddOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: entity } = useQuery<InventoryEntity>({
    queryKey: ['inventory-entities', id],
    queryFn: async () => {
      const res = await apiFetch(`/api/inventory/entities/${id}`);
      if (!res.ok) throw new Error('Failed to load entity');
      return res.json();
    },
  });

  const { data: records } = useQuery<PaginatedInventoryRecords>({
    queryKey: ['inventory-records', id],
    queryFn: async () => {
      const res = await apiFetch(`/api/inventory/entities/${id}/records`);
      if (!res.ok) throw new Error('Failed to load records');
      return res.json();
    },
    enabled: Boolean(entity),
  });

  const deleteMutation = useMutation({
    mutationFn: async (recordId: string) => {
      const res = await apiFetch(`/api/inventory/records/${recordId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete record');
    },
    onSuccess: () => {
      toast.success('Record deleted');
      queryClient.invalidateQueries({ queryKey: ['inventory-records', id] });
    },
    onError: () => toast.error('Failed to delete record'),
  });

  async function handleAddRecord(data: Record<string, unknown>) {
    const res = await apiFetch(`/api/inventory/entities/${id}/records`, {
      method: 'POST',
      body: JSON.stringify({ data }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? 'Failed to add record');
      return;
    }
    toast.success('Record added');
    setAddOpen(false);
    queryClient.invalidateQueries({ queryKey: ['inventory-records', id] });
  }

  if (!entity) return <main className="p-8 text-slate-500">Loading...</main>;

  return (
    <main className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">{entity.name}</h1>
        <div className="flex gap-2">
          <ImportRecordsDialog
            entityId={id}
            onImported={() => queryClient.invalidateQueries({ queryKey: ['inventory-records', id] })}
          />
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>Add Record</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>Add {entity.name} Record</DialogTitle>
              <div className="mt-4">
                <DynamicRecordForm fields={entity.fields} onSubmit={handleAddRecord} submitLabel="Add" />
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {records && records.data.length === 0 && <p className="text-slate-500">No records yet.</p>}

      {records && records.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              {entity.fields.map((field) => (
                <TableHead key={field.id}>{field.fieldName}</TableHead>
              ))}
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.data.map((record) => (
              <TableRow key={record.id}>
                {entity.fields.map((field) => (
                  <TableCell key={field.id} className="font-mono text-xs">
                    {String(record.data[field.fieldName] ?? '')}
                  </TableCell>
                ))}
                <TableCell>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <button className="text-sm font-medium text-red-600 hover:text-red-700">
                        Delete
                      </button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogTitle>Delete this record?</AlertDialogTitle>
                      <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                      <AlertDialogFooter>
                        <AlertDialogCancel asChild>
                          <Button variant="outline">Cancel</Button>
                        </AlertDialogCancel>
                        <AlertDialogAction asChild>
                          <Button variant="destructive" onClick={() => deleteMutation.mutate(record.id)}>
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
    </main>
  );
}
