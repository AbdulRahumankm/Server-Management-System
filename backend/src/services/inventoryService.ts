import { Prisma, FieldType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import type { CreateEntityInput, UpdateEntityInput } from '../schemas/inventorySchemas';

export class InventoryEntityNotFoundError extends Error {}
export class DuplicateEntityNameError extends Error {}
export class InventoryRecordNotFoundError extends Error {}
export class InvalidRecordDataError extends Error {
  constructor(public issues: z.ZodIssue[]) {
    super('Invalid record data');
  }
}

export async function listEntities() {
  return prisma.inventoryEntity.findMany({
    include: { fields: { orderBy: { displayOrder: 'asc' } }, _count: { select: { records: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function getEntityById(id: string) {
  return prisma.inventoryEntity.findUnique({
    where: { id },
    include: { fields: { orderBy: { displayOrder: 'asc' } } },
  });
}

export async function createEntity(input: CreateEntityInput, createdById: string) {
  try {
    return await prisma.inventoryEntity.create({
      data: {
        name: input.name,
        description: input.description,
        createdById,
        fields: {
          create: input.fields.map((f) => ({
            fieldName: f.fieldName,
            fieldType: f.fieldType,
            required: f.required,
            options: f.options as Prisma.InputJsonValue | undefined,
            displayOrder: f.displayOrder,
          })),
        },
      },
      include: { fields: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DuplicateEntityNameError();
    }
    throw err;
  }
}

export async function updateEntity(id: string, input: UpdateEntityInput) {
  try {
    return await prisma.inventoryEntity.update({
      where: { id },
      data: input,
      include: { fields: true },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') throw new InventoryEntityNotFoundError();
      if (err.code === 'P2002') throw new DuplicateEntityNameError();
    }
    throw err;
  }
}

export async function deleteEntity(id: string) {
  try {
    return await prisma.inventoryEntity.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new InventoryEntityNotFoundError();
    }
    throw err;
  }
}

function buildRecordDataSchema(
  fields: { fieldName: string; fieldType: FieldType; required: boolean; options: unknown }[],
): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    let schema: z.ZodTypeAny;
    switch (field.fieldType) {
      case 'NUMBER':
        schema = z.coerce.number();
        break;
      case 'BOOLEAN':
        schema = z.coerce.boolean();
        break;
      case 'SELECT': {
        const options = Array.isArray(field.options) ? (field.options as string[]) : [];
        schema = options.length > 0 ? z.enum(options as [string, ...string[]]) : z.string();
        break;
      }
      default:
        schema = z.string();
    }
    shape[field.fieldName] = field.required ? schema : schema.optional().nullable();
  }
  return z.object(shape);
}

export async function createRecord(entityId: string, data: Record<string, unknown>, createdById: string) {
  const entity = await prisma.inventoryEntity.findUnique({
    where: { id: entityId },
    include: { fields: true },
  });
  if (!entity) throw new InventoryEntityNotFoundError();

  const parsed = buildRecordDataSchema(entity.fields).safeParse(data);
  if (!parsed.success) throw new InvalidRecordDataError(parsed.error.issues);

  return prisma.inventoryRecord.create({
    data: { entityId, data: parsed.data as Prisma.InputJsonValue, createdById },
  });
}

export async function listRecords(entityId: string, page: number, pageSize: number) {
  const [data, total] = await Promise.all([
    prisma.inventoryRecord.findMany({
      where: { entityId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.inventoryRecord.count({ where: { entityId } }),
  ]);
  return { data, total, page, pageSize };
}

export async function updateRecord(id: string, data: Record<string, unknown>) {
  const record = await prisma.inventoryRecord.findUnique({
    where: { id },
    include: { entity: { include: { fields: true } } },
  });
  if (!record) throw new InventoryRecordNotFoundError();

  const parsed = buildRecordDataSchema(record.entity.fields).safeParse(data);
  if (!parsed.success) throw new InvalidRecordDataError(parsed.error.issues);

  return prisma.inventoryRecord.update({
    where: { id },
    data: { data: parsed.data as Prisma.InputJsonValue },
  });
}

export interface BulkCreateRecordsResult {
  insertedCount: number;
  errors: { row: number; issues: string[] }[];
}

export async function bulkCreateRecords(
  entityId: string,
  records: Record<string, unknown>[],
  createdById: string,
): Promise<BulkCreateRecordsResult> {
  const entity = await prisma.inventoryEntity.findUnique({
    where: { id: entityId },
    include: { fields: true },
  });
  if (!entity) throw new InventoryEntityNotFoundError();

  const schema = buildRecordDataSchema(entity.fields);
  const validRows: Prisma.InputJsonValue[] = [];
  const errors: { row: number; issues: string[] }[] = [];

  records.forEach((record, index) => {
    const parsed = schema.safeParse(record);
    if (parsed.success) {
      validRows.push(parsed.data as Prisma.InputJsonValue);
    } else {
      errors.push({
        row: index + 1,
        issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
      });
    }
  });

  if (validRows.length > 0) {
    await prisma.inventoryRecord.createMany({
      data: validRows.map((data) => ({ entityId, data, createdById })),
    });
  }

  return { insertedCount: validRows.length, errors };
}

export async function deleteRecord(id: string) {
  try {
    return await prisma.inventoryRecord.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new InventoryRecordNotFoundError();
    }
    throw err;
  }
}
