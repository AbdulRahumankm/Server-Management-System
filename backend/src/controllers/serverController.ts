import { Request, Response } from 'express';
import {
  createServerSchema,
  updateServerSchema,
  listServersQuerySchema,
} from '../schemas/serverSchemas';
import {
  listServers,
  getServerById,
  createServer,
  updateServer,
  deleteServer,
  getServerCredential,
  ServerNotFoundError,
  DuplicateHostnameError,
  InvalidCredentialError,
} from '../services/serverService';
import { logAudit, AUDIT_ACTIONS, requestContext } from '../services/auditService';

export async function listServersHandler(req: Request, res: Response): Promise<void> {
  const parsed = listServersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid query', details: parsed.error.flatten() });
    return;
  }
  res.status(200).json(await listServers(parsed.data));
}

export async function getServerHandler(req: Request, res: Response): Promise<void> {
  const server = await getServerById(req.params.id);
  if (!server) {
    res.status(404).json({ error: 'Server not found' });
    return;
  }
  res.status(200).json(server);
}

export async function createServerHandler(req: Request, res: Response): Promise<void> {
  const parsed = createServerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  try {
    const server = await createServer(parsed.data, req.user!.id, req.file?.buffer);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.SERVER_CREATED,
      resourceType: 'Server',
      resourceId: server.id,
      metadata: { hostname: server.hostname },
      ...requestContext(req),
    });
    res.status(201).json(server);
  } catch (err) {
    if (err instanceof DuplicateHostnameError) {
      res.status(409).json({ error: 'A server with this hostname already exists' });
      return;
    }
    if (err instanceof InvalidCredentialError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
}

export async function updateServerHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateServerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  try {
    const server = await updateServer(req.params.id, parsed.data);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.SERVER_UPDATED,
      resourceType: 'Server',
      resourceId: server.id,
      metadata: { hostname: server.hostname },
      ...requestContext(req),
    });
    res.status(200).json(server);
  } catch (err) {
    if (err instanceof ServerNotFoundError) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    if (err instanceof DuplicateHostnameError) {
      res.status(409).json({ error: 'A server with this hostname already exists' });
      return;
    }
    throw err;
  }
}

export async function getServerCredentialHandler(req: Request, res: Response): Promise<void> {
  try {
    const credential = await getServerCredential(req.params.id);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.CREDENTIAL_VIEWED,
      resourceType: 'Server',
      resourceId: req.params.id,
      metadata: { credentialType: credential.type },
      ...requestContext(req),
    });
    res.status(200).json(credential);
  } catch (err) {
    if (err instanceof ServerNotFoundError) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    throw err;
  }
}

export async function deleteServerHandler(req: Request, res: Response): Promise<void> {
  try {
    const server = await deleteServer(req.params.id);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.SERVER_DELETED,
      resourceType: 'Server',
      resourceId: server.id,
      metadata: { hostname: server.hostname },
      ...requestContext(req),
    });
    res.status(204).send();
  } catch (err) {
    if (err instanceof ServerNotFoundError) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    throw err;
  }
}
