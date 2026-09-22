import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { CreateServerInput, UpdateServerInput, ListServersQuery } from '../schemas/serverSchemas';

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export class ServerNotFoundError extends Error {}
export class DuplicateHostnameError extends Error {}

const SERVER_INCLUDE = { assignedKey: true, createdBy: true } as const;

export async function listServers(
  query: ListServersQuery,
): Promise<PaginatedResult<Prisma.ServerGetPayload<{ include: typeof SERVER_INCLUDE }>>> {
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
      include: SERVER_INCLUDE,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.server.count({ where }),
  ]);

  return { data, total, page: query.page, pageSize: query.pageSize };
}

export async function getServerById(id: string) {
  return prisma.server.findUnique({ where: { id }, include: SERVER_INCLUDE });
}

export async function createServer(input: CreateServerInput, createdById: string) {
  try {
    return await prisma.server.create({ data: { ...input, createdById } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DuplicateHostnameError();
    }
    throw err;
  }
}

export async function updateServer(id: string, input: UpdateServerInput) {
  try {
    return await prisma.server.update({ where: { id }, data: input });
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
