import jwt from 'jsonwebtoken';

export interface AccessTokenPayload {
  sub: string;
  roleId: string;
}

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, process.env.JWT_SECRET as string, { expiresIn: ACCESS_TOKEN_TTL });
}

export function signRefreshToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET as string, {
    expiresIn: REFRESH_TOKEN_TTL,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, process.env.JWT_SECRET as string) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): AccessTokenPayload {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET as string) as AccessTokenPayload;
}
