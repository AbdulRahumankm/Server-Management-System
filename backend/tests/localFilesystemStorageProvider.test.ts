import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { LocalFilesystemStorageProvider } from '../src/storage/LocalFilesystemStorageProvider';

describe('LocalFilesystemStorageProvider', () => {
  let dir: string;
  let provider: LocalFilesystemStorageProvider;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'key-storage-test-'));
    provider = new LocalFilesystemStorageProvider(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips plaintext through encrypt-and-store then decrypt-and-read', async () => {
    const plaintext = Buffer.from(
      '-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----',
    );

    const { storageRef, iv, authTag } = await provider.put('test-key', plaintext);
    expect(storageRef).toBeTruthy();

    const result = await provider.get(storageRef, iv, authTag);
    expect(result.equals(plaintext)).toBe(true);
  });

  it('never writes plaintext bytes to disk', async () => {
    const plaintext = Buffer.from(
      '-----BEGIN RSA PRIVATE KEY-----\nsecret-marker-xyz\n-----END RSA PRIVATE KEY-----',
    );
    const { storageRef } = await provider.put('test-key-2', plaintext);

    const raw = await readFile(path.join(dir, storageRef));
    expect(raw.includes('secret-marker-xyz')).toBe(false);
  });

  it('fails to decrypt with a tampered auth tag', async () => {
    const plaintext = Buffer.from(
      '-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----',
    );
    const { storageRef, iv, authTag } = await provider.put('test-key-3', plaintext);
    const tamperedAuthTag = Buffer.from(authTag, 'base64');
    tamperedAuthTag[0] ^= 0xff;

    await expect(
      provider.get(storageRef, iv, tamperedAuthTag.toString('base64')),
    ).rejects.toThrow();
  });

  it('deletes the underlying file', async () => {
    const { storageRef } = await provider.put('test-key-4', Buffer.from('-----BEGIN x'));
    await provider.delete(storageRef);
    await expect(provider.get(storageRef, 'irrelevant', 'irrelevant')).rejects.toThrow();
  });
});
