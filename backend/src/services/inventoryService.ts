import { Prisma, FieldType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import type { CreateEntityInput, UpdateEntityInput } from '../schemas/inventorySchemas';
import { encryptSecret, decryptSecret } from '../lib/secretCrypto';
import type { EncryptedSecret } from '../lib/secretCrypto';
import type { StorageProvider } from '../storage/StorageProvider';
import { LocalFilesystemStorageProvider } from '../storage/LocalFilesystemStorageProvider';

export class InventoryEntityNotFoundError extends Error {}
export class DuplicateEntityNameError extends Error {}
export class InventoryRecordNotFoundError extends Error {}
export class InvalidCredentialError extends Error {}
export class InventoryFieldNotFoundError extends Error {}
export class InventoryFieldNotSecretError extends Error {}
export class InvalidRecordDataError extends Error {
  constructor(public issues: z.ZodIssue[]) {
    super('Invalid record data');
  }
}

const keyStorage: StorageProvider = new LocalFilesystemStorageProvider();

const KEY_FORMAT_MARKERS: Record<'PEM' | 'PPK', string> = {
  PEM: '-----BEGIN',
  PPK: 'PuTTY-User-Key-File-',
};

function looksLikeKeyFile(buffer: Buffer, format: 'PEM' | 'PPK'): boolean {
  const marker = KEY_FORMAT_MARKERS[format];
  return buffer.subarray(0, marker.length).toString('utf8') === marker;
}

function isSecretFieldType(fieldType: FieldType): fieldType is 'SSH_KEY' | 'PASSWORD' {
  return fieldType === 'SSH_KEY' || fieldType === 'PASSWORD';
}

interface SshKeyEnvelope {
  storageRef: string;
  iv: string;
  authTag: string;
  keyFormat: 'PEM' | 'PPK';
}

export interface CredentialFileInput {
  fieldName: string;
  buffer: Buffer;
}

type FieldDefinition = { fieldName: string; fieldType: FieldType; required: boolean };

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

function buildRecordDataSchema(fields: FieldDefinition[]): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    if (isSecretFieldType(field.fieldType)) continue; // handled by applySecretFields, not generic coercion
    let schema: z.ZodTypeAny;
    switch (field.fieldType) {
      case 'NUMBER':
        schema = z.coerce.number();
        break;
      case 'BOOLEAN':
        schema = z.coerce.boolean();
        break;
      case 'SELECT': {
        const options = Array.isArray((field as { options?: unknown }).options)
          ? ((field as { options?: unknown }).options as string[])
          : [];
        schema = options.length > 0 ? z.enum(options as [string, ...string[]]) : z.string();
        break;
      }
      default:
        schema = z.string();
    }
    shape[field.fieldName] = field.required ? schema : schema.optional().nullable();
  }
  // .passthrough() lets SSH_KEY/PASSWORD raw values (a format string or a plaintext
  // password) survive this validation step untouched, so applySecretFields can process them.
  return z.object(shape).passthrough();
}

/**
 * Encrypts/stores SSH_KEY and PASSWORD field values, or carries forward the
 * existing stored envelope when no new value/file was supplied (edit-without-
 * replacing semantics). Throws InvalidCredentialError for a required field
 * with no value on create, or for a bad file/format combination.
 */
async function applySecretFields(
  fields: FieldDefinition[],
  data: Record<string, unknown>,
  files: CredentialFileInput[],
  existingData: Record<string, unknown>,
  mode: 'create' | 'update',
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = { ...data };

  for (const field of fields) {
    if (!isSecretFieldType(field.fieldType)) continue;

    if (field.fieldType === 'PASSWORD') {
      const value = data[field.fieldName];
      if (typeof value === 'string' && value.length > 0) {
        result[field.fieldName] = encryptSecret(value);
        continue;
      }
      delete result[field.fieldName];
      if (existingData[field.fieldName] !== undefined) {
        result[field.fieldName] = existingData[field.fieldName];
      } else if (mode === 'create' && field.required) {
        throw new InvalidCredentialError(`Field "${field.fieldName}" is required`);
      }
      continue;
    }

    // SSH_KEY
    const keyFormat = data[field.fieldName];
    const file = files.find((f) => f.fieldName === field.fieldName);

    if (!file && keyFormat === undefined) {
      delete result[field.fieldName];
      if (existingData[field.fieldName] !== undefined) {
        result[field.fieldName] = existingData[field.fieldName];
      } else if (mode === 'create' && field.required) {
        throw new InvalidCredentialError(`Field "${field.fieldName}" is required`);
      }
      continue;
    }

    if (!file || (keyFormat !== 'PEM' && keyFormat !== 'PPK')) {
      throw new InvalidCredentialError(
        `Field "${field.fieldName}" requires a key file and a PEM or PPK format`,
      );
    }
    if (!looksLikeKeyFile(file.buffer, keyFormat)) {
      throw new InvalidCredentialError(
        `File for "${field.fieldName}" does not look like a ${keyFormat}-encoded private key`,
      );
    }

    const previous = existingData[field.fieldName] as SshKeyEnvelope | undefined;
    const { storageRef, iv, authTag } = await keyStorage.put(field.fieldName, file.buffer);
    const envelope: SshKeyEnvelope = { storageRef, iv, authTag, keyFormat };
    result[field.fieldName] = envelope;

    if (previous?.storageRef) {
      await keyStorage.delete(previous.storageRef).catch(() => undefined);
    }
  }

  return result;
}

function sanitizeRecordData(
  fields: { fieldName: string; fieldType: FieldType }[],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...data };
  for (const field of fields) {
    if (field.fieldType === 'PASSWORD' && result[field.fieldName] !== undefined) {
      result[field.fieldName] = { hasValue: true };
    }
    if (field.fieldType === 'SSH_KEY' && result[field.fieldName] !== undefined) {
      const envelope = result[field.fieldName] as SshKeyEnvelope;
      result[field.fieldName] = { hasValue: true, keyFormat: envelope.keyFormat };
    }
  }
  return result;
}

function sanitizeRecord<T extends { data: unknown }>(
  fields: { fieldName: string; fieldType: FieldType }[],
  record: T,
): T {
  return { ...record, data: sanitizeRecordData(fields, record.data as Record<string, unknown>) };
}

export async function createRecord(
  entityId: string,
  data: Record<string, unknown>,
  createdById: string,
  files: CredentialFileInput[] = [],
) {
  const entity = await prisma.inventoryEntity.findUnique({
    where: { id: entityId },
    include: { fields: true },
  });
  if (!entity) throw new InventoryEntityNotFoundError();

  const parsed = buildRecordDataSchema(entity.fields).safeParse(data);
  if (!parsed.success) throw new InvalidRecordDataError(parsed.error.issues);

  const finalData = await applySecretFields(entity.fields, parsed.data, files, {}, 'create');

  const record = await prisma.inventoryRecord.create({
    data: { entityId, data: finalData as Prisma.InputJsonValue, createdById },
  });
  return sanitizeRecord(entity.fields, record);
}

export async function listRecords(entityId: string, page: number, pageSize: number) {
  const [data, total, fields] = await Promise.all([
    prisma.inventoryRecord.findMany({
      where: { entityId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.inventoryRecord.count({ where: { entityId } }),
    prisma.inventoryField.findMany({ where: { entityId } }),
  ]);
  return { data: data.map((r) => sanitizeRecord(fields, r)), total, page, pageSize };
}

export async function updateRecord(
  id: string,
  data: Record<string, unknown>,
  files: CredentialFileInput[] = [],
) {
  const record = await prisma.inventoryRecord.findUnique({
    where: { id },
    include: { entity: { include: { fields: true } } },
  });
  if (!record) throw new InventoryRecordNotFoundError();

  const parsed = buildRecordDataSchema(record.entity.fields).safeParse(data);
  if (!parsed.success) throw new InvalidRecordDataError(parsed.error.issues);

  const existingData = record.data as Record<string, unknown>;
  const finalData = await applySecretFields(
    record.entity.fields,
    parsed.data,
    files,
    existingData,
    'update',
  );

  const updated = await prisma.inventoryRecord.update({
    where: { id },
    data: { data: finalData as Prisma.InputJsonValue },
  });
  return sanitizeRecord(record.entity.fields, updated);
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

  const secretFieldNames = new Set(
    entity.fields.filter((f) => isSecretFieldType(f.fieldType)).map((f) => f.fieldName),
  );
  const schema = buildRecordDataSchema(entity.fields);
  const validRows: Prisma.InputJsonValue[] = [];
  const errors: { row: number; issues: string[] }[] = [];

  records.forEach((record, index) => {
    const sanitizedInput = Object.fromEntries(
      Object.entries(record).filter(([key]) => !secretFieldNames.has(key)),
    );
    const parsed = schema.safeParse(sanitizedInput);
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

export type RevealedCredential =
  | { fieldType: 'PASSWORD'; value: string }
  | { fieldType: 'SSH_KEY'; buffer: Buffer; keyFormat: 'PEM' | 'PPK' };

export async function revealRecordField(
  recordId: string,
  fieldName: string,
): Promise<RevealedCredential> {
  const record = await prisma.inventoryRecord.findUnique({
    where: { id: recordId },
    include: { entity: { include: { fields: true } } },
  });
  if (!record) throw new InventoryRecordNotFoundError();

  const field = record.entity.fields.find((f) => f.fieldName === fieldName);
  if (!field) throw new InventoryFieldNotFoundError();
  if (!isSecretFieldType(field.fieldType)) throw new InventoryFieldNotSecretError();

  const data = record.data as Record<string, unknown>;
  const envelope = data[fieldName];
  if (!envelope) throw new InventoryFieldNotFoundError();

  if (field.fieldType === 'PASSWORD') {
    const value = decryptSecret(envelope as EncryptedSecret);
    return { fieldType: 'PASSWORD', value };
  }

  const sshEnvelope = envelope as SshKeyEnvelope;
  const buffer = await keyStorage.get(sshEnvelope.storageRef, sshEnvelope.iv, sshEnvelope.authTag);
  return { fieldType: 'SSH_KEY', buffer, keyFormat: sshEnvelope.keyFormat };
}
