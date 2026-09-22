import { hashPassword, verifyPassword } from '../src/services/passwordService';

describe('passwordService', () => {
  it('hashes and verifies a password round-trip', async () => {
    const hash = await hashPassword('correct-horse');
    expect(hash).not.toBe('correct-horse');
    expect(await verifyPassword(hash, 'correct-horse')).toBe(true);
    expect(await verifyPassword(hash, 'wrong')).toBe(false);
  });
});
