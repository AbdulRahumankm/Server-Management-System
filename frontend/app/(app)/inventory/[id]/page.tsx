'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { ArrowLeft } from 'lucide-react';
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
import { RecordCredentialDialog } from '@/components/inventory/RecordCredentialDialog';
import { apiFetch } from '@/lib/apiClient';
import { useCurrentUser } from '@/lib/useCurrentUser';
import type {
  InventoryEntity,
  InventoryField,
  InventoryRecord,
  PaginatedInventoryRecords,
} from '@/types/inventory';

function RecordCell({
  field,
  value,
  recordId,
  canReveal,
}: {
  field: InventoryField;
  value: unknown;
  recordId: string;
  canReveal: boolean;
}) {
  if (field.fieldType === 'PASSWORD' || field.fieldType === 'SSH_KEY') {
    const hasValue = Boolean((value as { hasValue?: boolean } | null)?.hasValue);
    if (!hasValue) return <span className="text-slate-400">—</span>;
    if (!canReveal) return <span className="text-slate-400">•••••</span>;
    return <RecordCredentialDialog recordId={recordId} fieldName={field.fieldName} />;
  }
  return <>{String(value ?? '')}</>;
}

export default function InventoryEntityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [addOpen, setAddOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<InventoryRecord | null>(null);
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const canReveal = (currentUser?.permissions ?? []).includes('inventory:credential:reveal');

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

  async function handleAddRecord(data: Record<string, unknown>, credentialFiles: Record<string, File>) {
    let body: BodyInit;
    if (Object.keys(credentialFiles).length > 0) {
      const formData = new FormData();
      formData.set('data', JSON.stringify(data));
      for (const [fieldName, file] of Object.entries(credentialFiles)) {
        formData.set(fieldName, file);
      }
      body = formData;
    } else {
      body = JSON.stringify({ data });
    }

    const res = await apiFetch(`/api/inventory/entities/${id}/records`, { method: 'POST', body });
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      toast.error(errorBody.error ?? 'Failed to add record');
      return;
    }
    toast.success('Record added');
    setAddOpen(false);
    queryClient.invalidateQueries({ queryKey: ['inventory-records', id] });
  }

  async function handleEditRecord(data: Record<string, unknown>, credentialFiles: Record<string, File>) {
    if (!editingRecord) return;
    let body: BodyInit;
    if (Object.keys(credentialFiles).length > 0) {
      const formData = new FormData();
      formData.set('data', JSON.stringify(data));
      for (const [fieldName, file] of Object.entries(credentialFiles)) {
        formData.set(fieldName, file);
      }
      body = formData;
    } else {
      body = JSON.stringify({ data });
    }

    const res = await apiFetch(`/api/inventory/records/${editingRecord.id}`, { method: 'PUT', body });
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({}));
      toast.error(errorBody.error ?? 'Failed to update record');
      return;
    }
    toast.success('Record updated');
    setEditingRecord(null);
    queryClient.invalidateQueries({ queryKey: ['inventory-records', id] });
  }

  function handleExport() {
    if (!entity || !records) return;
    const exportableFields = entity.fields.filter(
      (field) => field.fieldType !== 'PASSWORD' && field.fieldType !== 'SSH_KEY',
    );
    const rows = records.data.map((record) =>
      Object.fromEntries(exportableFields.map((field) => [field.fieldName, record.data[field.fieldName] ?? ''])),
    );
    const sheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Records');
    XLSX.writeFile(workbook, `${entity.name}.xlsx`);
  }

  if (!entity) return <main className="p-8 text-slate-500">Loading...</main>;

  return (
    <main className="p-8">
      <Link
        href="/inventory"
        className="mb-4 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-indigo-600"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Dynamic Inventory
      </Link>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">{entity.name}</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport} disabled={!records || records.data.length === 0}>
            Export
          </Button>
          <ImportRecordsDialog
            entityId={id}
            onImported={() => queryClient.invalidateQueries({ queryKey: ['inventory-records', id] })}
          />
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>Add Record</Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
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
                    <RecordCell
                      field={field}
                      value={record.data[field.fieldName]}
                      recordId={record.id}
                      canReveal={canReveal}
                    />
                  </TableCell>
                ))}
                <TableCell>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
                      onClick={() => setEditingRecord(record)}
                    >
                      Edit
                    </button>
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
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={Boolean(editingRecord)} onOpenChange={(open) => !open && setEditingRecord(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogTitle>Edit {entity.name} Record</DialogTitle>
          <div className="mt-4">
            {editingRecord && (
              <DynamicRecordForm
                fields={entity.fields}
                defaultValues={editingRecord.data}
                onSubmit={handleEditRecord}
                submitLabel="Save"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
