import { z } from 'zod';

export const fieldTypeEnum = z.enum(['TEXT', 'NUMBER', 'BOOLEAN', 'DATE', 'SELECT', 'TEXTAREA']);

export const createFieldSchema = z
  .object({
    fieldName: z.string().min(1).max(100),
    fieldType: fieldTypeEnum,
    required: z.boolean().default(false),
    options: z.array(z.string()).optional(),
    displayOrder: z.number().int().default(0),
  })
  .refine((f) => f.fieldType !== 'SELECT' || (f.options && f.options.length > 0), {
    message: 'SELECT fields must include at least one option',
    path: ['options'],
  });

export const createEntitySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  fields: z.array(createFieldSchema).min(1, 'At least one field is required'),
});

export const updateEntitySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).optional(),
});

export const createRecordSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});

export const updateRecordSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});

export type CreateEntityInput = z.infer<typeof createEntitySchema>;
export type UpdateEntityInput = z.infer<typeof updateEntitySchema>;
