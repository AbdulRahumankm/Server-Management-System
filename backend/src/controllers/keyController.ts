import { Request, Response } from 'express';
import { uploadKeyMetadataSchema, assignKeySchema } from '../schemas/keySchemas';
import {
  listKeys,
  getKeyMetadata,
  uploadKey,
  getKeyForDownload,
  decryptAndRecordAccess,
  deleteKey,
  assignKeyToServer,
  KeyNotFoundError,
  DuplicateKeyNameError,
} from '../services/keyService';
import { logAudit, AUDIT_ACTIONS, requestContext } from '../services/auditService';

const PRIVATE_KEY_MARKER = '-----BEGIN';

export async function listKeysHandler(req: Request, res: Response): Promise<void> {
  const search = typeof req.query.search === 'string' ? req.query.search : undefined;
  res.status(200).json(await listKeys(search));
}

export async function getKeyHandler(req: Request, res: Response): Promise<void> {
  const key = await getKeyMetadata(req.params.id);
  if (!key) {
    res.status(404).json({ error: 'Key not found' });
    return;
  }
  res.status(200).json(key);
}

export async function uploadKeyHandler(req: Request, res: Response): Promise<void> {
  const parsed = uploadKeyMetadataSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'A key file is required' });
    return;
  }
  if (req.file.buffer.subarray(0, PRIVATE_KEY_MARKER.length).toString('utf8') !== PRIVATE_KEY_MARKER) {
    res.status(400).json({ error: 'File does not look like a PEM-encoded private key' });
    return;
  }

  try {
    const key = await uploadKey({
      name: parsed.data.name,
      keyType: parsed.data.keyType,
      description: parsed.data.description,
      ownerId: req.user!.id,
      fileBuffer: req.file.buffer,
    });
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.KEY_UPLOADED,
      resourceType: 'SSHKey',
      resourceId: key.id,
      metadata: { keyName: key.name, keyType: key.keyType },
      ...requestContext(req),
    });
    res.status(201).json(key);
  } catch (err) {
    if (err instanceof DuplicateKeyNameError) {
      res.status(409).json({ error: 'A key with this name already exists' });
      return;
    }
    throw err;
  }
}

export async function downloadKeyHandler(req: Request, res: Response): Promise<void> {
  try {
    const key = await getKeyForDownload(req.params.id);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.KEY_DOWNLOADED,
      resourceType: 'SSHKey',
      resourceId: key.id,
      metadata: { keyName: key.name },
      ...requestContext(req),
    });
    const content = await decryptAndRecordAccess(key);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${key.name}"`);
    res.status(200).send(content);
  } catch (err) {
    if (err instanceof KeyNotFoundError) {
      res.status(404).json({ error: 'Key not found' });
      return;
    }
    throw err;
  }
}

export async function deleteKeyHandler(req: Request, res: Response): Promise<void> {
  try {
    const key = await deleteKey(req.params.id);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.KEY_DELETED,
      resourceType: 'SSHKey',
      resourceId: key.id,
      metadata: { keyName: key.name },
      ...requestContext(req),
    });
    res.status(204).send();
  } catch (err) {
    if (err instanceof KeyNotFoundError) {
      res.status(404).json({ error: 'Key not found' });
      return;
    }
    throw err;
  }
}

export async function assignKeyHandler(req: Request, res: Response): Promise<void> {
  const parsed = assignKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  try {
    const server = await assignKeyToServer(req.params.id, parsed.data.serverId);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.KEY_ASSIGNED,
      resourceType: 'SSHKey',
      resourceId: req.params.id,
      metadata: { serverId: server.id, hostname: server.hostname },
      ...requestContext(req),
    });
    res.status(200).json(server);
  } catch (err) {
    if (err instanceof KeyNotFoundError) {
      res.status(404).json({ error: 'Key not found' });
      return;
    }
    throw err;
  }
}
