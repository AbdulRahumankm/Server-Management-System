import { Request, Response, NextFunction } from 'express';

export function requirePermission(permissionKey: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!req.user.permissions.includes(permissionKey)) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  };
}
