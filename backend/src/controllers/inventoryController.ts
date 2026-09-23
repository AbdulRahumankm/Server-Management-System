import { Request, Response } from 'express';
import {
  createEntitySchema,
  updateEntitySchema,
  createRecordSchema,
  updateRecordSchema,
  bulkCreateRecordsSchema,
} from '../schemas/inventorySchemas';
import {
  listEntities,
  getEntityById,
  createEntity,
  updateEntity,
  deleteEntity,
  listRecords,
  createRecord,
  updateRecord,
  deleteRecord,
  bulkCreateRecords,
  revealRecordField,
  InventoryEntityNotFoundError,
  DuplicateEntityNameError,
  InventoryRecordNotFoundError,
  InvalidRecordDataError,
  InvalidCredentialError,
  InventoryFieldNotFoundError,
  InventoryFieldNotSecretError,
} from '../services/inventoryService';
import type { CredentialFileInput } from '../services/inventoryService';
import { logAudit, AUDIT_ACTIONS, requestContext } from '../services/auditService';

function parseRecordBody(req: Request): unknown {
  if (typeof req.body?.data === 'string') {
    try {
      return { data: JSON.parse(req.body.data) };
    } catch {
      return { data: undefined };
    }
  }
  return req.body;
}

function extractCredentialFiles(req: Request): CredentialFileInput[] {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  return files.map((f) => ({ fieldName: f.fieldname, buffer: f.buffer }));
}

export async function listEntitiesHandler(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await listEntities());
}

export async function getEntityHandler(req: Request, res: Response): Promise<void> {
  const entity = await getEntityById(req.params.id);
  if (!entity) {
    res.status(404).json({ error: 'Inventory entity not found' });
    return;
  }
  res.status(200).json(entity);
}

export async function createEntityHandler(req: Request, res: Response): Promise<void> {
  const parsed = createEntitySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  try {
    const entity = await createEntity(parsed.data, req.user!.id);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.INVENTORY_CREATED,
      resourceType: 'InventoryEntity',
      resourceId: entity.id,
      metadata: { name: entity.name },
      ...requestContext(req),
    });
    res.status(201).json(entity);
  } catch (err) {
    if (err instanceof DuplicateEntityNameError) {
      res.status(409).json({ error: 'An inventory entity with this name already exists' });
      return;
    }
    throw err;
  }
}

export async function updateEntityHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateEntitySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  try {
    const entity = await updateEntity(req.params.id, parsed.data);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.INVENTORY_UPDATED,
      resourceType: 'InventoryEntity',
      resourceId: entity.id,
      metadata: { name: entity.name },
      ...requestContext(req),
    });
    res.status(200).json(entity);
  } catch (err) {
    if (err instanceof InventoryEntityNotFoundError) {
      res.status(404).json({ error: 'Inventory entity not found' });
      return;
    }
    if (err instanceof DuplicateEntityNameError) {
      res.status(409).json({ error: 'An inventory entity with this name already exists' });
      return;
    }
    throw err;
  }
}

export async function deleteEntityHandler(req: Request, res: Response): Promise<void> {
  try {
    await deleteEntity(req.params.id);
    res.status(204).send();
  } catch (err) {
    if (err instanceof InventoryEntityNotFoundError) {
      res.status(404).json({ error: 'Inventory entity not found' });
      return;
    }
    throw err;
  }
}

export async function listRecordsHandler(req: Request, res: Response): Promise<void> {
  const page = Number(req.query.page ?? 1);
  const pageSize = Math.min(Number(req.query.pageSize ?? 20), 100);
  res.status(200).json(await listRecords(req.params.id, page, pageSize));
}

export async function createRecordHandler(req: Request, res: Response): Promise<void> {
  const parsed = createRecordSchema.safeParse(parseRecordBody(req));
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  try {
    const record = await createRecord(
      req.params.id,
      parsed.data.data,
      req.user!.id,
      extractCredentialFiles(req),
    );
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.INVENTORY_RECORD_CREATED,
      resourceType: 'InventoryRecord',
      resourceId: record.id,
      metadata: { entityId: req.params.id },
      ...requestContext(req),
    });
    res.status(201).json(record);
  } catch (err) {
    if (err instanceof InventoryEntityNotFoundError) {
      res.status(404).json({ error: 'Inventory entity not found' });
      return;
    }
    if (err instanceof InvalidRecordDataError) {
      res.status(400).json({ error: 'Invalid record data', details: err.issues });
      return;
    }
    if (err instanceof InvalidCredentialError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
}

export async function bulkCreateRecordsHandler(req: Request, res: Response): Promise<void> {
  const parsed = bulkCreateRecordsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  try {
    const result = await bulkCreateRecords(req.params.id, parsed.data.records, req.user!.id);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.INVENTORY_RECORDS_IMPORTED,
      resourceType: 'InventoryEntity',
      resourceId: req.params.id,
      metadata: { insertedCount: result.insertedCount, errorCount: result.errors.length },
      ...requestContext(req),
    });
    res.status(207).json(result);
  } catch (err) {
    if (err instanceof InventoryEntityNotFoundError) {
      res.status(404).json({ error: 'Inventory entity not found' });
      return;
    }
    throw err;
  }
}

export async function updateRecordHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateRecordSchema.safeParse(parseRecordBody(req));
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  try {
    const record = await updateRecord(
      req.params.id,
      parsed.data.data,
      extractCredentialFiles(req),
    );
    res.status(200).json(record);
  } catch (err) {
    if (err instanceof InventoryRecordNotFoundError) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }
    if (err instanceof InvalidRecordDataError) {
      res.status(400).json({ error: 'Invalid record data', details: err.issues });
      return;
    }
    if (err instanceof InvalidCredentialError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
}

export async function revealRecordFieldHandler(req: Request, res: Response): Promise<void> {
  try {
    const result = await revealRecordField(req.params.id, req.params.fieldName);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.CREDENTIAL_VIEWED,
      resourceType: 'InventoryRecord',
      resourceId: req.params.id,
      metadata: { fieldName: req.params.fieldName },
      ...requestContext(req),
    });
    if (result.fieldType === 'PASSWORD') {
      res.status(200).json({ fieldType: 'PASSWORD', value: result.value });
      return;
    }
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.fieldName}.key"`);
    res.status(200).send(result.buffer);
  } catch (err) {
    if (err instanceof InventoryRecordNotFoundError) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }
    if (err instanceof InventoryFieldNotFoundError) {
      res.status(404).json({ error: 'Field not found' });
      return;
    }
    if (err instanceof InventoryFieldNotSecretError) {
      res.status(400).json({ error: 'Field is not a credential field' });
      return;
    }
    throw err;
  }
}

export async function deleteRecordHandler(req: Request, res: Response): Promise<void> {
  try {
    const record = await deleteRecord(req.params.id);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.INVENTORY_RECORD_DELETED,
      resourceType: 'InventoryRecord',
      resourceId: record.id,
      metadata: { entityId: record.entityId },
      ...requestContext(req),
    });
    res.status(204).send();
  } catch (err) {
    if (err instanceof InventoryRecordNotFoundError) {
      res.status(404).json({ error: 'Record not found' });
      return;
    }
    throw err;
  }
}
