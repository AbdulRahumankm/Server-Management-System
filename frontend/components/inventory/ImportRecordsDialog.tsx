'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { apiFetch } from '@/lib/apiClient';

interface BulkImportResult {
  insertedCount: number;
  errors: { row: number; issues: string[] }[];
}

interface ImportRecordsDialogProps {
  entityId: string;
  onImported: () => void;
}

export function ImportRecordsDialog({ entityId, onImported }: ImportRecordsDialogProps) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<BulkImportResult | null>(null);

  function reset() {
    setRows([]);
    setFileName(null);
    setParseError(null);
    setResult(null);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setResult(null);
    if (!file) {
      setRows([]);
      setFileName(null);
      return;
    }

    setFileName(file.name);
    setParseError(null);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
      if (parsed.length === 0) {
        setParseError('No rows found in the file');
        setRows([]);
        return;
      }
      setRows(parsed);
    } catch {
      setParseError('Could not read this file. Use a CSV or Excel (.xlsx) export.');
      setRows([]);
    }
  }

  async function handleImport() {
    setIsImporting(true);
    const res = await apiFetch(`/api/inventory/entities/${entityId}/records/bulk`, {
      method: 'POST',
      body: JSON.stringify({ records: rows }),
    });
    setIsImporting(false);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? 'Import failed');
      return;
    }

    const data: BulkImportResult = await res.json();
    setResult(data);
    if (data.insertedCount > 0) {
      toast.success(`Imported ${data.insertedCount} record(s)`);
      onImported();
    }
    if (data.errors.length === 0) {
      setRows([]);
      setFileName(null);
    }
  }

  return (
    <Dialog onOpenChange={(open) => !open && reset()}>
      <DialogTrigger asChild>
        <Button variant="outline">Import</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Import Records</DialogTitle>
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm text-slate-500">
            Upload a CSV or Excel (.xlsx) file. The first row must contain column headers matching
            this table&apos;s field names.
          </p>
          <input
            type="file"
            aria-label="Import file"
            accept=".csv,.xlsx,.xls"
            onChange={handleFileChange}
            className="block text-sm text-slate-700"
          />
          {parseError && <p className="text-sm text-red-600">{parseError}</p>}
          {fileName && !parseError && rows.length > 0 && (
            <p className="text-sm text-slate-600">
              {fileName}: {rows.length} row(s) detected.
            </p>
          )}
          {result && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="text-slate-700">{result.insertedCount} row(s) imported successfully.</p>
              {result.errors.length > 0 && (
                <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-red-600">
                  {result.errors.map((err) => (
                    <li key={err.row}>
                      Row {err.row}: {err.issues.join(', ')}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <Button
            type="button"
            disabled={rows.length === 0 || isImporting}
            onClick={handleImport}
          >
            {isImporting ? 'Importing...' : 'Import'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
