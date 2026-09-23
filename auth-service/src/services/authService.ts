import { prisma } from '../lib/prisma';
import { verifyPassword } from './passwordService';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: {
    id: string;
    name: string;
    permissions: string[];
  };
}

export class InvalidCredentialsError extends Error {}

function toAuthenticatedUser(user: {
  id: string;
  email: string;
  name: string;
  role: { id: string; name: string; permissions: { permission: { key: string } }[] };
}): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: {
      id: user.role.id,
      name: user.role.name,
      permissions: user.role.permissions.map((rp) => rp.permission.key),
    },
  };
}

const USER_WITH_ROLE_INCLUDE = {
  role: { include: { permissions: { include: { permission: true } } } },
} as const;

export async function authenticate(email: string, password: string): Promise<AuthenticatedUser> {
  const user = await prisma.user.findUnique({
    where: { email },
    include: USER_WITH_ROLE_INCLUDE,
  });

  if (!user || !user.passwordHash) {
    throw new InvalidCredentialsError();
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    throw new InvalidCredentialsError();
  }

  return toAuthenticatedUser(user);
}

export async function getUserById(userId: string): Promise<AuthenticatedUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: USER_WITH_ROLE_INCLUDE,
  });
  return user ? toAuthenticatedUser(user) : null;
}
