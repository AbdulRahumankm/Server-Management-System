export type FieldType =
  | 'TEXT'
  | 'NUMBER'
  | 'BOOLEAN'
  | 'DATE'
  | 'SELECT'
  | 'TEXTAREA'
  | 'SSH_KEY'
  | 'PASSWORD';

export interface SecretFieldValue {
  hasValue: true;
  keyFormat?: 'PEM' | 'PPK';
}

export interface InventoryField {
  id: string;
  fieldName: string;
  fieldType: FieldType;
  required: boolean;
  options: string[] | null;
  displayOrder: number;
}

export interface InventoryEntity {
  id: string;
  name: string;
  description: string | null;
  fields: InventoryField[];
  createdAt: string;
  updatedAt: string;
}

export interface InventoryEntitySummary extends InventoryEntity {
  _count: { records: number };
}

export interface InventoryRecord {
  id: string;
  entityId: string;
  data: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedInventoryRecords {
  data: InventoryRecord[];
  total: number;
  page: number;
  pageSize: number;
}
