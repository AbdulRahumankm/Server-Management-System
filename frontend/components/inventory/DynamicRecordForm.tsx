'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { InventoryField } from '@/types/inventory';

interface DynamicRecordFormProps {
  fields: InventoryField[];
  defaultValues?: Record<string, unknown>;
  onSubmit: (
    data: Record<string, unknown>,
    credentialFiles: Record<string, File>,
  ) => void | Promise<void>;
  submitLabel: string;
}

const controlClassName =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';

function initialValues(
  fields: InventoryField[],
  defaultValues?: Record<string, unknown>,
): Record<string, unknown> {
  const initial = { ...(defaultValues ?? {}) };
  for (const field of fields) {
    if (field.fieldType === 'SSH_KEY' || field.fieldType === 'PASSWORD') {
      delete initial[field.fieldName]; // never pre-fill a secret's sanitized placeholder
    }
  }
  return initial;
}

export function DynamicRecordForm({
  fields,
  defaultValues,
  onSubmit,
  submitLabel,
}: DynamicRecordFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    initialValues(fields, defaultValues),
  );
  const [credentialFiles, setCredentialFiles] = useState<Record<string, File>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function setValue(fieldName: string, value: unknown) {
    setValues((prev) => ({ ...prev, [fieldName]: value }));
  }

  function setCredentialFile(fieldName: string, file: File | null) {
    setCredentialFiles((prev) => {
      const next = { ...prev };
      if (file) next[fieldName] = file;
      else delete next[fieldName];
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    await onSubmit(values, credentialFiles);
    setIsSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map((field) => (
        <div
          key={field.id}
          className={field.fieldType === 'TEXTAREA' || field.fieldType === 'SSH_KEY' ? 'sm:col-span-2' : undefined}
        >
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
          {field.fieldType === 'PASSWORD' && (
            <Input
              id={field.fieldName}
              type="password"
              value={(values[field.fieldName] as string) ?? ''}
              onChange={(e) => setValue(field.fieldName, e.target.value)}
              placeholder={defaultValues ? 'Leave blank to keep the existing password' : undefined}
            />
          )}
          {field.fieldType === 'SSH_KEY' && (
            <div className="flex flex-col gap-2">
              <select
                id={field.fieldName}
                className={controlClassName}
                value={(values[field.fieldName] as string) ?? ''}
                onChange={(e) => setValue(field.fieldName, e.target.value || undefined)}
              >
                <option value="">Select format...</option>
                <option value="PEM">PEM</option>
                <option value="PPK">PPK (PuTTY)</option>
              </select>
              <input
                type="file"
                aria-label={`${field.fieldName} file`}
                className="block text-sm text-slate-700"
                onChange={(e) => setCredentialFile(field.fieldName, e.target.files?.[0] ?? null)}
              />
            </div>
          )}
        </div>
      ))}
      </div>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving...' : submitLabel}
      </Button>
    </form>
  );
}
