'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { FieldType } from '@/types/inventory';

export interface FieldDraft {
  fieldName: string;
  fieldType: FieldType;
  required: boolean;
  options: string; // comma-separated, used only when fieldType === 'SELECT'
}

const FIELD_TYPES: FieldType[] = [
  'TEXT',
  'NUMBER',
  'BOOLEAN',
  'DATE',
  'SELECT',
  'TEXTAREA',
  'SSH_KEY',
  'PASSWORD',
];

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  TEXT: 'TEXT',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN',
  DATE: 'DATE',
  SELECT: 'SELECT',
  TEXTAREA: 'TEXTAREA',
  SSH_KEY: 'SSH Key',
  PASSWORD: 'Password',
};

interface EntityFieldBuilderProps {
  fields: FieldDraft[];
  onChange: (fields: FieldDraft[]) => void;
}

export function EntityFieldBuilder({ fields, onChange }: EntityFieldBuilderProps) {
  function addField() {
    onChange([...fields, { fieldName: '', fieldType: 'TEXT', required: false, options: '' }]);
  }

  function updateField(index: number, patch: Partial<FieldDraft>) {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function removeField(index: number) {
    onChange(fields.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-3">
      {fields.map((field, index) => (
        <div
          key={index}
          className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-slate-50/50 p-3"
        >
          <div>
            <Label htmlFor={`field-name-${index}`}>Field Name</Label>
            <Input
              id={`field-name-${index}`}
              value={field.fieldName}
              onChange={(e) => updateField(index, { fieldName: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor={`field-type-${index}`}>Type</Label>
            <select
              id={`field-type-${index}`}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              value={field.fieldType}
              onChange={(e) => updateField(index, { fieldType: e.target.value as FieldType })}
            >
              {FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {FIELD_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
          {field.fieldType === 'SELECT' && (
            <div>
              <Label htmlFor={`field-options-${index}`}>Options (comma-separated)</Label>
              <Input
                id={`field-options-${index}`}
                value={field.options}
                onChange={(e) => updateField(index, { options: e.target.value })}
              />
            </div>
          )}
          <label className="flex items-center gap-1 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={field.required}
              onChange={(e) => updateField(index, { required: e.target.checked })}
            />
            Required
          </label>
          <button
            type="button"
            className="text-sm font-medium text-red-600 hover:text-red-700"
            onClick={() => removeField(index)}
          >
            Remove
          </button>
        </div>
      ))}
      <Button type="button" variant="outline" onClick={addField}>
        Add Field
      </Button>
    </div>
  );
}
