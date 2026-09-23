import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { hashPassword } from './passwordService';
import type { CreateUserInput, UpdateUserInput } from '../schemas/userSchemas';

export class UserNotFoundError extends Error {}
export class DuplicateEmailError extends Error {}

const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  authProvider: true,
  role: { select: { id: true, name: true } },
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;
// passwordHash is intentionally excluded from every query below

export async function listUsers() {
  return prisma.user.findMany({ select: USER_SELECT, orderBy: { createdAt: 'desc' } });
}

export async function getUserById(id: string) {
  return prisma.user.findUnique({ where: { id }, select: USER_SELECT });
}

export async function createUser(input: CreateUserInput) {
  try {
    return await prisma.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
        roleId: input.roleId,
      },
      select: USER_SELECT,
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new DuplicateEmailError();
    }
    throw err;
  }
}

export async function updateUser(id: string, input: UpdateUserInput) {
  const existing = await prisma.user.findUnique({ where: { id } });
  if (!existing) throw new UserNotFoundError();

  const roleChanged = input.roleId !== undefined && input.roleId !== existing.roleId;

  try {
    const user = await prisma.user.update({
      where: { id },
      data: {
        name: input.name,
        roleId: input.roleId,
        passwordHash: input.password ? await hashPassword(input.password) : undefined,
      },
      select: USER_SELECT,
    });
    return { user, roleChanged };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new UserNotFoundError();
    }
    throw err;
  }
}

export async function deleteUser(id: string) {
  try {
    return await prisma.user.delete({ where: { id }, select: USER_SELECT });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new UserNotFoundError();
    }
    throw err;
  }
}

export async function listRoles() {
  const roles = await prisma.role.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      permissions: { select: { permission: { select: { key: true } } } },
    },
    orderBy: { name: 'asc' },
  });

  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    description: role.description,
    permissions: role.permissions.map((rp) => rp.permission.key),
  }));
}

export async function countUsers(): Promise<number> {
  return prisma.user.count();
}

export async function lookupUsers(ids: string[]) {
  return prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, email: true },
  });
}
