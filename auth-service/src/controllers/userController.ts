import { Request, Response } from 'express';
import { createUserSchema, updateUserSchema } from '../schemas/userSchemas';
import {
  listUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  listRoles,
  countUsers,
  lookupUsers,
  UserNotFoundError,
  DuplicateEmailError,
} from '../services/userService';
import { logAudit, AUDIT_ACTIONS, requestContext } from '../services/auditClient';

export async function listUsersHandler(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await listUsers());
}

export async function getUserHandler(req: Request, res: Response): Promise<void> {
  const user = await getUserById(req.params.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.status(200).json(user);
}

export async function createUserHandler(req: Request, res: Response): Promise<void> {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  try {
    const user = await createUser(parsed.data);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.USER_CREATED,
      resourceType: 'User',
      resourceId: user.id,
      metadata: { email: user.email, role: user.role.name },
      ...requestContext(req),
    });
    res.status(201).json(user);
  } catch (err) {
    if (err instanceof DuplicateEmailError) {
      res.status(409).json({ error: 'A user with this email already exists' });
      return;
    }
    throw err;
  }
}

export async function updateUserHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }
  try {
    const { user, roleChanged } = await updateUser(req.params.id, parsed.data);
    await logAudit({
      userId: req.user!.id,
      action: AUDIT_ACTIONS.USER_UPDATED,
      resourceType: 'User',
      resourceId: user.id,
      metadata: { email: user.email },
      ...requestContext(req),
    });
    if (roleChanged) {
      await logAudit({
        userId: req.user!.id,
        action: AUDIT_ACTIONS.PERMISSION_CHANGED,
        resourceType: 'User',
        resourceId: user.id,
        metadata: { email: user.email, newRole: user.role.name },
        ...requestContext(req),
      });
    }
    res.status(200).json(user);
  } catch (err) {
    if (err instanceof UserNotFoundError) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (err instanceof DuplicateEmailError) {
      res.status(409).json({ error: 'A user with this email already exists' });
      return;
    }
    throw err;
  }
}

export async function deleteUserHandler(req: Request, res: Response): Promise<void> {
  try {
    await deleteUser(req.params.id);
    res.status(204).send();
  } catch (err) {
    if (err instanceof UserNotFoundError) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    throw err;
  }
}

export async function listRolesHandler(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await listRoles());
}

export async function countUsersHandler(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ totalUsers: await countUsers() });
}

export async function lookupUsersHandler(req: Request, res: Response): Promise<void> {
  const idsParam = typeof req.query.ids === 'string' ? req.query.ids : '';
  const ids = idsParam
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    res.status(200).json([]);
    return;
  }
  res.status(200).json(await lookupUsers(ids));
}
