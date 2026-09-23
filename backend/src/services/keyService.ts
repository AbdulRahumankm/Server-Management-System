import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { LocalFilesystemStorageProvider } from '../storage/LocalFilesystemStorageProvider';
import type { StorageProvider } from '../storage/StorageProvider';
import { SERVER_SELECT } from '../lib/serverSelect';

const storage: StorageProvider = new LocalFilesystemStorageProvider();

export class KeyNotFoundError extends Error {}
export class DuplicateKeyNameError extends Error {}

const FORMAT_MARKERS: Record<'PEM' | 'PPK', string> = {
  PEM: '-----BEGIN',
  PPK: 'PuTTY-User-Key-File-',
};

export function looksLikeKeyFile(buffer: Buffer, format: 'PEM' | 'PPK'): boolean {
  const marker = FORMAT_MARKERS[format];
  return buffer.subarray(0, marker.length).toString('utf8') === marker;
}

const KEY_METADATA_SELECT = {
  id: true,
  name: true,
  keyType: true,
  keyFormat: true,
  description: true,
  ownerId: true,
  owner: { select: { id: true, name: true, email: true } },
  lastAccessedAt: true,
  createdAt: true,
  updatedAt: true,
  assignedServer: { select: { id: true, hostname: true } },
} satisfies Prisma.SSHKeySelect;
// storageRef/iv/authTag are intentionally excluded from every query below

export async function listKeys(search?: string) {
  return prisma.sSHKey.findMany({
    where: search ? { name: { contains: search, mode: 'insensitive' } } : undefined,
    select: KEY_METADATA_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}

export async function getKeyMetadata(id: string) {
  return prisma.sSHKey.findUnique({ where: { id }, select: KEY_METADATA_SELECT });
}

export async function uploadKey(input: {
  name: string;
  keyType: string;
  keyFormat: 'PEM' | 'PPK';
  description?: string;
  ownerId: string;
  fileBuffer: Buffer;
}) {
  const { storageRef, iv, authTag } = await storage.put(input.name, input.fileBuffer);
  try {
    return await prisma.sSHKey.create({
      data: {
        name: input.name,
        keyType: input.keyType,
        keyFormat: input.keyFormat,
        description: input.description,
        ownerId: input.ownerId,
        storageRef,
        iv,
        authTag,
      },
      select: KEY_METADATA_SELECT,
    });
  } catch (err) {
    await storage.delete(storageRef).catch(() => undefined);
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DuplicateKeyNameError();
    }
    throw err;
  }
}

export async function getKeyForDownload(id: string) {
  const key = await prisma.sSHKey.findUnique({ where: { id } });
  if (!key) throw new KeyNotFoundError();
  return key;
}

export async function decryptAndRecordAccess(key: {
  id: string;
  storageRef: string;
  iv: string;
  authTag: string;
}): Promise<Buffer> {
  const content = await storage.get(key.storageRef, key.iv, key.authTag);
  await prisma.sSHKey.update({ where: { id: key.id }, data: { lastAccessedAt: new Date() } });
  return content;
}

export async function deleteKey(id: string) {
  const key = await prisma.sSHKey.findUnique({ where: { id } });
  if (!key) throw new KeyNotFoundError();
  await prisma.sSHKey.delete({ where: { id } });
  await storage.delete(key.storageRef).catch(() => undefined);
  return key;
}

export async function assignKeyToServer(keyId: string, serverId: string) {
  const key = await prisma.sSHKey.findUnique({ where: { id: keyId } });
  if (!key) throw new KeyNotFoundError();
  return prisma.server.update({
    where: { id: serverId },
    data: { assignedKeyId: keyId },
    select: SERVER_SELECT,
  });
}
