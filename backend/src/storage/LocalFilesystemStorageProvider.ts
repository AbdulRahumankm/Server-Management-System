import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'crypto';
import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import path from 'path';
import type { StorageProvider } from './StorageProvider';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;

function loadEncryptionKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('ENCRYPTION_KEY environment variable is not set');
  }
  const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      'ENCRYPTION_KEY must decode to exactly 32 bytes -- a 64-character hex string or base64',
    );
  }
  return key;
}

export class LocalFilesystemStorageProvider implements StorageProvider {
  constructor(private readonly basePath: string = process.env.KEY_STORAGE_PATH ?? './key-storage') {}

  async put(id: string, plaintext: Buffer): Promise<{ storageRef: string; iv: string; authTag: string }> {
    await mkdir(this.basePath, { recursive: true });
    const key = loadEncryptionKey();
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const storageRef = `${id}-${randomUUID()}.enc`;
    await writeFile(path.join(this.basePath, storageRef), encrypted);

    return { storageRef, iv: iv.toString('base64'), authTag: authTag.toString('base64') };
  }

  async get(storageRef: string, iv: string, authTag: string): Promise<Buffer> {
    const key = loadEncryptionKey();
    const encrypted = await readFile(path.join(this.basePath, storageRef));
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  }

  async delete(storageRef: string): Promise<void> {
    await unlink(path.join(this.basePath, storageRef));
  }
}
