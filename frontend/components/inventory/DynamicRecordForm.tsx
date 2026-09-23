'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { InventoryField } from '@/types/inventory';

interface DynamicRecordFormProps {
  fields: InventoryField[];
  defaultValues?: Record<string, unknown>;
  onSubmit: (data: Record<string, unknown>) => void | Promise<void>;
  submitLabel: string;
}

const controlClassName =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';

export function DynamicRecordForm({
  fields,
  defaultValues,
  onSubmit,
  submitLabel,
}: DynamicRecordFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>(defaultValues ?? {});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function setValue(fieldName: string, value: unknown) {
    setValues((prev) => ({ ...prev, [fieldName]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    await onSubmit(values);
    setIsSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      {fields.map((field) => (
        <div key={field.id}>
          <Label htmlFor={field.fieldName}>
            {field.fieldName}
            {field.required ? ' *' : ''}
          </Label>
          {field.fieldType === 'TEXTAREA' && (
            <textarea
              id={field.fieldName}
              className={controlClassName}
              rows={3}
              required={field.required}
              value={(values[field.fieldName] as string) ?? ''}
              onChange={(e) => setValue(field.fieldName, e.target.value)}
            />
          )}
          {field.fieldType === 'BOOLEAN' && (
            <input
              id={field.fieldName}
              type="checkbox"
              checked={Boolean(values[field.fieldName])}
              onChange={(e) => setValue(field.fieldName, e.target.checked)}
            />
          )}
          {field.fieldType === 'SELECT' && (
            <select
              id={field.fieldName}
              className={controlClassName}
              required={field.required}
              value={(values[field.fieldName] as string) ?? ''}
              onChange={(e) => setValue(field.fieldName, e.target.value)}
            >
              <option value="">Select...</option>
              {(field.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
          {(field.fieldType === 'TEXT' || field.fieldType === 'NUMBER' || field.fieldType === 'DATE') && (
            <Input
              id={field.fieldName}
              type={
                field.fieldType === 'NUMBER' ? 'number' : field.fieldType === 'DATE' ? 'date' : 'text'
              }
              required={field.required}
              value={(values[field.fieldName] as string) ?? ''}
              onChange={(e) => setValue(field.fieldName, e.target.value)}
            />
          )}
        </div>
      ))}
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving...' : submitLabel}
      </Button>
    </form>
  );
}
