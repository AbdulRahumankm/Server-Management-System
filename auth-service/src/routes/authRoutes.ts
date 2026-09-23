import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, getUserById, InvalidCredentialsError } from '../services/authService';
import { signAccessToken, signRefreshToken, verifyAccessToken, verifyRefreshToken } from '../services/tokenService';
import {
  requireAuth,
  setAccessCookie,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
} from '../middleware/requireAuth';
import { logAudit, AUDIT_ACTIONS, requestContext } from '../services/auditClient';
import type { AuthenticatedUser } from '../services/authService';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function tokenPayloadFor(user: AuthenticatedUser) {
  return {
    sub: user.id,
    roleId: user.role.id,
    roleName: user.role.name,
    permissions: user.role.permissions,
  };
}

export const authRouter = Router();

authRouter.post('/login', loginRateLimiter, async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  try {
    const user = await authenticate(parsed.data.email, parsed.data.password);
    const payload = tokenPayloadFor(user);
    setAccessCookie(res, signAccessToken(payload));
    res.cookie(REFRESH_COOKIE, signRefreshToken(payload), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: REFRESH_COOKIE_MAX_AGE_MS,
    });

    await logAudit({
      userId: user.id,
      action: AUDIT_ACTIONS.LOGIN,
      resourceType: 'User',
      resourceId: user.id,
      ...requestContext(req),
    });

    res.status(200).json({ id: user.id, email: user.email, name: user.name, role: user.role.name });
  } catch (err) {
    if (err instanceof InvalidCredentialsError) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }
    throw err;
  }
});

authRouter.post('/logout', async (req: Request, res: Response) => {
  let userId: string | null = null;
  const token = req.cookies?.[ACCESS_COOKIE] as string | undefined;
  if (token) {
    try {
      userId = verifyAccessToken(token).sub;
    } catch {
      // expired/invalid -- log with unknown user rather than failing logout
    }
  }

  await logAudit({
    userId,
    action: AUDIT_ACTIONS.LOGOUT,
    resourceType: 'User',
    resourceId: userId,
    ...requestContext(req),
  });

  res.clearCookie(ACCESS_COOKIE);
  res.clearCookie(REFRESH_COOKIE);
  res.status(200).json({ success: true });
});

authRouter.get('/me', requireAuth, (req: Request, res: Response) => {
  res.status(200).json({
    id: req.user!.id,
    email: req.user!.email,
    name: req.user!.name,
    role: req.user!.role.name,
    permissions: req.user!.role.permissions,
  });
});

// Used by inventory-service/audit-service's frontend calls: when either of
// those services returns 401 (their JWT-only requireAuth cannot silently
// refresh, since it has no DB access), the frontend calls this endpoint to
// mint a fresh access token from the still-valid refresh token, then retries
// the original request once. See frontend/lib/apiClient.ts.
authRouter.post('/refresh', async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE] as string | undefined;
  if (!refreshToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const payload = verifyRefreshToken(refreshToken);
    const user = await getUserById(payload.sub);
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    setAccessCookie(res, signAccessToken(tokenPayloadFor(user)));
    res.status(200).json({ success: true });
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
});
