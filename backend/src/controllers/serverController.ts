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
  ServerNotFoundError,
  DuplicateHostnameError,
} from '../services/serverService';

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
    res.status(201).json(await createServer(parsed.data, req.user!.id));
  } catch (err) {
    if (err instanceof DuplicateHostnameError) {
      res.status(409).json({ error: 'A server with this hostname already exists' });
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
    res.status(200).json(await updateServer(req.params.id, parsed.data));
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

export async function deleteServerHandler(req: Request, res: Response): Promise<void> {
  try {
    await deleteServer(req.params.id);
    res.status(204).send();
  } catch (err) {
    if (err instanceof ServerNotFoundError) {
      res.status(404).json({ error: 'Server not found' });
      return;
    }
    throw err;
  }
}
