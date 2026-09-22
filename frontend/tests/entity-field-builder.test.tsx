import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EntityFieldBuilder, FieldDraft } from '../components/inventory/EntityFieldBuilder';

describe('EntityFieldBuilder', () => {
  const baseField: FieldDraft = { fieldName: '', fieldType: 'TEXT', required: false, options: '' };

  it('calls onChange with an added field when "Add Field" is clicked', () => {
    const onChange = vi.fn();
    render(<EntityFieldBuilder fields={[baseField]} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add Field' }));

    expect(onChange).toHaveBeenCalledWith([
      baseField,
      { fieldName: '', fieldType: 'TEXT', required: false, options: '' },
    ]);
  });

  it('shows an options input only when the field type is SELECT', () => {
    const onChange = vi.fn();
    const { rerender } = render(<EntityFieldBuilder fields={[baseField]} onChange={onChange} />);
    expect(screen.queryByLabelText(/options/i)).toBeNull();

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'SELECT' } });
    const updatedFields = onChange.mock.calls[0][0];
    rerender(<EntityFieldBuilder fields={updatedFields} onChange={onChange} />);

    expect(screen.getByLabelText(/options/i)).toBeDefined();
  });

  it('removes a field when its Remove button is clicked', () => {
    const onChange = vi.fn();
    const secondField: FieldDraft = { ...baseField, fieldName: 'second' };
    render(<EntityFieldBuilder fields={[baseField, secondField]} onChange={onChange} />);

    fireEvent.click(screen.getAllByText('Remove')[0]);

    expect(onChange).toHaveBeenCalledWith([secondField]);
  });
});
