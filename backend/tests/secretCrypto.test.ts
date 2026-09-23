import { encryptSecret, decryptSecret } from '../src/lib/secretCrypto';

describe('secretCrypto', () => {
  it('round-trips a plaintext secret through encrypt and decrypt', () => {
    const encrypted = encryptSecret('Sup3rSecretP@ss');
    expect(encrypted.ciphertext).not.toContain('Sup3rSecretP@ss');
    expect(decryptSecret(encrypted)).toBe('Sup3rSecretP@ss');
  });

  it('fails to decrypt with a tampered auth tag', () => {
    const encrypted = encryptSecret('another-secret');
    const tamperedAuthTag = Buffer.from(encrypted.authTag, 'base64');
    tamperedAuthTag[0] ^= 0xff;

    expect(() =>
      decryptSecret({ ...encrypted, authTag: tamperedAuthTag.toString('base64') }),
    ).toThrow();
  });
});
