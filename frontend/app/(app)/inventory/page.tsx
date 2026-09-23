'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Database } from 'lucide-react';
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
import { EntityFieldBuilder, FieldDraft } from '@/components/inventory/EntityFieldBuilder';
import { apiFetch } from '@/lib/apiClient';
import type { InventoryEntitySummary } from '@/types/inventory';

function CreateEntityDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<FieldDraft[]>([
    { fieldName: '', fieldType: 'TEXT', required: false, options: '' },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const queryClient = useQueryClient();

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

    setIsSubmitting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? 'Failed to create inventory entity');
      return;
    }

    toast.success('Inventory entity created');
    setOpen(false);
    setName('');
    setDescription('');
    setFields([{ fieldName: '', fieldType: 'TEXT', required: false, options: '' }]);
    queryClient.invalidateQueries({ queryKey: ['inventory-entities'] });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
  const { data: entities, isLoading, isError } = useQuery<InventoryEntitySummary[]>({
    queryKey: ['inventory-entities'],
    queryFn: async () => {
      const res = await apiFetch('/api/inventory/entities');
      if (!res.ok) throw new Error('Failed to load inventory entities');
      return res.json();
    },
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
          <Link
            key={entity.id}
            href={`/inventory/${entity.id}`}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600">
              <Database className="h-5 w-5" />
            </div>
            <h2 className="text-lg font-medium text-slate-900">{entity.name}</h2>
            {entity.description && <p className="text-sm text-slate-500">{entity.description}</p>}
            <p className="mt-2 text-xs text-slate-400">
              {entity.fields.length} fields · {entity._count.records} records
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
