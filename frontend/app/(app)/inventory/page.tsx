'use client';

import { useState } from 'react';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Database, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
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
import { EntityFieldBuilder, FieldDraft } from '@/components/inventory/EntityFieldBuilder';
import { apiFetch } from '@/lib/apiClient';
import { useCurrentUser } from '@/lib/useCurrentUser';
import type { InventoryEntitySummary } from '@/types/inventory';

const BLANK_FIELD: FieldDraft = { fieldName: '', fieldType: 'TEXT', required: false, options: '' };

function CreateEntityDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<FieldDraft[]>([BLANK_FIELD]);
  const [importRows, setImportRows] = useState<Record<string, unknown>[]>([]);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();

  function reset() {
    setName('');
    setDescription('');
    setFields([BLANK_FIELD]);
    setImportRows([]);
    setImportFileName(null);
    setImportError(null);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportError(null);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      if (parsed.length === 0) {
        setImportError('No rows found in the file');
        setImportRows([]);
        return;
      }
      const headers = Object.keys(parsed[0]);
      setFields(
        headers.map((header) => ({ fieldName: header, fieldType: 'TEXT', required: false, options: '' })),
      );
      setImportRows(parsed);
    } catch {
      setImportError('Could not read this file. Use a CSV or Excel (.xlsx) export.');
      setImportRows([]);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);

    const res = await apiFetch('/api/inventory/entities', {
      method: 'POST',
      body: JSON.stringify({
        name,
        description: description || undefined,
        fields: fields.map((f, i) => ({
          fieldName: f.fieldName,
          fieldType: f.fieldType,
          required: f.required,
          options:
            f.fieldType === 'SELECT'
              ? f.options
                  .split(',')
                  .map((o) => o.trim())
                  .filter(Boolean)
              : undefined,
          displayOrder: i,
        })),
      }),
    });

    if (!res.ok) {
      setIsSubmitting(false);
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? 'Failed to create inventory entity');
      return;
    }

    const entity = await res.json();

    if (importRows.length > 0) {
      const bulkRes = await apiFetch(`/api/inventory/entities/${entity.id}/records/bulk`, {
        method: 'POST',
        body: JSON.stringify({ records: importRows }),
      });
      if (bulkRes.ok) {
        const bulkData: { insertedCount: number } = await bulkRes.json();
        toast.success(`Inventory entity created; imported ${bulkData.insertedCount} record(s)`);
      } else {
        toast.error('Entity created, but importing rows from the file failed');
      }
    } else {
      toast.success('Inventory entity created');
    }

    setIsSubmitting(false);
    setOpen(false);
    reset();
    queryClient.invalidateQueries({ queryKey: ['inventory-entities'] });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild>
        <Button>Create Inventory</Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogTitle>Create Inventory Entity</DialogTitle>
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <div>
            <Label htmlFor="entity-name">Entity Name</Label>
            <Input id="entity-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="entity-description">Description</Label>
            <Input
              id="entity-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
            <Label htmlFor="entity-import-file">Or upload a CSV/Excel file to auto-fill fields and rows</Label>
            <input
              id="entity-import-file"
              type="file"
              accept=".csv,.xlsx,.xls"
              onChange={handleFileChange}
              className="mt-1 block text-sm text-slate-700"
            />
            {importError && <p className="mt-1 text-sm text-red-600">{importError}</p>}
            {importFileName && !importError && importRows.length > 0 && (
              <p className="mt-1 text-sm text-slate-600">
                {importFileName}: {importRows.length} row(s) detected, fields below auto-filled from the
                header row. Adjust types (e.g. Password, SSH Key) as needed before creating.
              </p>
            )}
          </div>
          <EntityFieldBuilder fields={fields} onChange={setFields} />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const { data: currentUser } = useCurrentUser();
  const canDelete = (currentUser?.permissions ?? []).includes('inventory:delete');

  const { data: entities, isLoading, isError } = useQuery<InventoryEntitySummary[]>({
    queryKey: ['inventory-entities'],
    queryFn: async () => {
      const res = await apiFetch('/api/inventory/entities');
      if (!res.ok) throw new Error('Failed to load inventory entities');
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (entityId: string) => {
      const res = await apiFetch(`/api/inventory/entities/${entityId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete inventory entity');
    },
    onSuccess: () => {
      toast.success('Inventory entity deleted');
      queryClient.invalidateQueries({ queryKey: ['inventory-entities'] });
    },
    onError: () => toast.error('Failed to delete inventory entity'),
  });

  return (
    <main className="p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Dynamic Inventory</h1>
        <CreateEntityDialog />
      </div>

      {isLoading && <p className="text-slate-500">Loading inventory entities...</p>}
      {isError && <p className="text-red-600">Failed to load inventory entities.</p>}
      {entities && entities.length === 0 && <p className="text-slate-500">No inventory entities yet.</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {entities?.map((entity) => (
          <div
            key={entity.id}
            className="relative rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
          >
            <Link href={`/inventory/${entity.id}`} className="block">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
                <Database className="h-5 w-5" />
              </div>
              <h2 className="pr-8 text-lg font-medium text-slate-900">{entity.name}</h2>
              {entity.description && <p className="text-sm text-slate-500">{entity.description}</p>}
              <p className="mt-2 text-xs text-slate-400">
                {entity.fields.length} fields · {entity._count.records} records
              </p>
            </Link>
            {canDelete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Delete ${entity.name}`}
                    className="absolute right-4 top-4 text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogTitle>Delete {entity.name}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes this inventory table, its fields, and all {entity._count.records}{' '}
                    record(s). This cannot be undone.
                  </AlertDialogDescription>
                  <AlertDialogFooter>
                    <AlertDialogCancel asChild>
                      <Button variant="outline">Cancel</Button>
                    </AlertDialogCancel>
                    <AlertDialogAction asChild>
                      <Button variant="destructive" onClick={() => deleteMutation.mutate(entity.id)}>
                        Delete
                      </Button>
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
