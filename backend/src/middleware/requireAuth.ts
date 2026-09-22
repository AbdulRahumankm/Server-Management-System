import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, verifyRefreshToken, signAccessToken } from '../services/tokenService';
import { getUserById, AuthenticatedUser } from '../services/authService';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
const ACCESS_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;

export function setAccessCookie(res: Response, token: string): void {
  res.cookie(ACCESS_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: ACCESS_COOKIE_MAX_AGE_MS,
  });
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const accessToken = req.cookies?.[ACCESS_COOKIE] as string | undefined;
  const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;

  if (accessToken) {
    try {
      const payload = verifyAccessToken(accessToken);
      const user = await getUserById(payload.sub);
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      req.user = user;
      next();
      return;
    } catch {
      // access token invalid/expired -- fall through to refresh
    }
  }

  if (refreshToken) {
    try {
      const payload = verifyRefreshToken(refreshToken);
      const user = await getUserById(payload.sub);
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      setAccessCookie(res, signAccessToken({ sub: user.id, roleId: user.role.id }));
      req.user = user;
      next();
      return;
    } catch {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
  }

  res.status(401).json({ error: 'Unauthorized' });
}
