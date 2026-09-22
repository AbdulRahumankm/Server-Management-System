import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, InvalidCredentialsError } from '../services/authService';
import { signAccessToken, signRefreshToken, verifyAccessToken } from '../services/tokenService';
import {
  requireAuth,
  setAccessCookie,
  ACCESS_COOKIE,
  REFRESH_COOKIE,
} from '../middleware/requireAuth';
import { logAudit, AUDIT_ACTIONS, requestContext } from '../services/auditService';

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

export const authRouter = Router();

authRouter.post('/login', loginRateLimiter, async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
    return;
  }

  try {
    const user = await authenticate(parsed.data.email, parsed.data.password);
    setAccessCookie(res, signAccessToken({ sub: user.id, roleId: user.role.id }));
    res.cookie(REFRESH_COOKIE, signRefreshToken({ sub: user.id, roleId: user.role.id }), {
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
