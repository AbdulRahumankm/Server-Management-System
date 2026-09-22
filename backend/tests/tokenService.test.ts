import {
  signAccessToken,
  verifyAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from '../src/services/tokenService';

describe('tokenService', () => {
  it('signs and verifies an access token', () => {
    const token = signAccessToken({ sub: 'user-1', roleId: 'role-1' });
    const payload = verifyAccessToken(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.roleId).toBe('role-1');
  });

  it('signs and verifies a refresh token', () => {
    const token = signRefreshToken({ sub: 'user-1', roleId: 'role-1' });
    const payload = verifyRefreshToken(token);
    expect(payload.sub).toBe('user-1');
  });

  it('rejects a tampered access token', () => {
    const token = signAccessToken({ sub: 'user-1', roleId: 'role-1' });
    expect(() => verifyAccessToken(`${token}tampered`)).toThrow();
  });
});
