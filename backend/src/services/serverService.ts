import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { CreateServerInput, UpdateServerInput, ListServersQuery } from '../schemas/serverSchemas';
import { looksLikeKeyFile } from './keyService';
import type { StorageProvider } from '../storage/StorageProvider';
import { LocalFilesystemStorageProvider } from '../storage/LocalFilesystemStorageProvider';
import { encryptSecret, decryptSecret } from '../lib/secretCrypto';
import { SERVER_SELECT } from '../lib/serverSelect';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export class ServerNotFoundError extends Error {}
export class DuplicateHostnameError extends Error {}
export class InvalidCredentialError extends Error {}

const keyStorage: StorageProvider = new LocalFilesystemStorageProvider();

export async function listServers(
  query: ListServersQuery,
): Promise<PaginatedResult<Prisma.ServerGetPayload<{ select: typeof SERVER_SELECT }>>> {
  const where: Prisma.ServerWhereInput = {};

  if (query.search) {
    where.OR = [
      { hostname: { contains: query.search, mode: 'insensitive' } },
      { ipAddress: { contains: query.search, mode: 'insensitive' } },
      { application: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  if (query.os) where.os = query.os;
  if (query.environment) where.environment = query.environment;
  if (query.status) where.status = query.status;

  const orderBy: Prisma.ServerOrderByWithRelationInput = { [query.sortBy]: query.sortOrder };

  const [data, total] = await Promise.all([
    prisma.server.findMany({
      where,
      select: SERVER_SELECT,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.server.count({ where }),
  ]);

  return { data, total, page: query.page, pageSize: query.pageSize };
}

export async function getServerById(id: string) {
  return prisma.server.findUnique({ where: { id }, select: SERVER_SELECT });
}

export async function createServer(
  input: CreateServerInput,
  createdById: string,
  credentialFile?: Buffer,
) {
  const { credentialType, keyFormat, password, ...serverFields } = input;

  if (credentialType === 'SSH_KEY') {
    if (!credentialFile || !keyFormat) {
      throw new InvalidCredentialError('An SSH key file and format are required');
    }
    if (!looksLikeKeyFile(credentialFile, keyFormat)) {
      throw new InvalidCredentialError(`File does not look like a ${keyFormat}-encoded private key`);
    }

    const { storageRef, iv, authTag } = await keyStorage.put(serverFields.hostname, credentialFile);
    try {
      return await prisma.$transaction(async (tx) => {
        const key = await tx.sSHKey.create({
          data: {
            name: `${serverFields.hostname}-key`,
            keyType: 'unspecified',
            keyFormat,
            ownerId: createdById,
            storageRef,
            iv,
            authTag,
          },
        });
        return tx.server.create({
          data: { ...serverFields, createdById, assignedKeyId: key.id },
          select: SERVER_SELECT,
        });
      });
    } catch (err) {
      await keyStorage.delete(storageRef).catch(() => undefined);
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') throw new DuplicateHostnameError();
      }
      throw err;
    }
  }

  if (credentialType === 'PASSWORD') {
    if (!password) {
      throw new InvalidCredentialError('A password is required');
    }
    const encrypted = encryptSecret(password);
    try {
      return await prisma.server.create({
        data: {
          ...serverFields,
          createdById,
          windowsPasswordCiphertext: encrypted.ciphertext,
          windowsPasswordIv: encrypted.iv,
          windowsPasswordAuthTag: encrypted.authTag,
        },
        select: SERVER_SELECT,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new DuplicateHostnameError();
      }
      throw err;
    }
  }

  try {
    return await prisma.server.create({
      data: { ...serverFields, createdById },
      select: SERVER_SELECT,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DuplicateHostnameError();
    }
    throw err;
  }
}

export async function updateServer(id: string, input: UpdateServerInput) {
  try {
    return await prisma.server.update({
      where: { id },
      data: input,
      select: SERVER_SELECT,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') throw new ServerNotFoundError();
      if (err.code === 'P2002') throw new DuplicateHostnameError();
    }
    throw err;
  }
}

export async function deleteServer(id: string) {
  try {
    return await prisma.server.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new ServerNotFoundError();
    }
    throw err;
  }
}

export interface ServerCredential {
  type: 'SSH_KEY' | 'PASSWORD' | 'NONE';
  keyId?: string;
  keyName?: string;
  username?: string;
  password?: string;
}

export async function getServerCredential(id: string): Promise<ServerCredential> {
  const server = await prisma.server.findUnique({
    where: { id },
    select: {
      username: true,
      windowsPasswordCiphertext: true,
      windowsPasswordIv: true,
      windowsPasswordAuthTag: true,
      assignedKey: { select: { id: true, name: true } },
    },
  });
  if (!server) throw new ServerNotFoundError();

  if (server.assignedKey) {
    return { type: 'SSH_KEY', keyId: server.assignedKey.id, keyName: server.assignedKey.name };
  }

  if (server.windowsPasswordCiphertext && server.windowsPasswordIv && server.windowsPasswordAuthTag) {
    const password = decryptSecret({
      ciphertext: server.windowsPasswordCiphertext,
      iv: server.windowsPasswordIv,
      authTag: server.windowsPasswordAuthTag,
    });
    return { type: 'PASSWORD', username: server.username, password };
  }

  return { type: 'NONE' };
}
