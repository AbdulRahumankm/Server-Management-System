import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface RequestUser {
  id: string;
  roleId: string;
  roleName: string;
  permissions: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: RequestUser;
    }
  }
}

interface AccessTokenPayload {
  sub: string;
  roleId: string;
  roleName: string;
  permissions: string[];
}

const ACCESS_COOKIE = 'access_token';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.[ACCESS_COOKIE] as string | undefined;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET as string) as AccessTokenPayload;
    req.user = {
      id: payload.sub,
      roleId: payload.roleId,
      roleName: payload.roleName,
      permissions: payload.permissions,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}
