import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DynamicRecordForm } from '../components/inventory/DynamicRecordForm';
import type { InventoryField } from '../types/inventory';

const FIELDS: InventoryField[] = [
  { id: 'f1', fieldName: 'hostname', fieldType: 'TEXT', required: true, options: null, displayOrder: 0 },
  {
    id: 'f2',
    fieldName: 'status',
    fieldType: 'SELECT',
    required: true,
    options: ['Active', 'Retired'],
    displayOrder: 1,
  },
  { id: 'f3', fieldName: 'inService', fieldType: 'BOOLEAN', required: false, options: null, displayOrder: 2 },
];

describe('DynamicRecordForm', () => {
  it('renders one input per field, matching its type', () => {
    render(<DynamicRecordForm fields={FIELDS} onSubmit={vi.fn()} submitLabel="Add" />);
    expect(screen.getByLabelText(/hostname/i)).toHaveProperty('tagName', 'INPUT');
    expect(screen.getByLabelText(/status/i)).toHaveProperty('tagName', 'SELECT');
    expect(screen.getByLabelText(/inService/i)).toHaveProperty('type', 'checkbox');
  });

  it('submits the entered values keyed by field name', async () => {
    const onSubmit = vi.fn();
    render(<DynamicRecordForm fields={FIELDS} onSubmit={onSubmit} submitLabel="Add" />);

    fireEvent.change(screen.getByLabelText(/hostname/i), { target: { value: 'sw-01' } });
    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'Active' } });
    fireEvent.click(screen.getByLabelText(/inService/i));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ hostname: 'sw-01', status: 'Active', inService: true });
  });
});
