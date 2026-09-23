import type { Prisma } from '@prisma/client';

// Excludes windowsPasswordCiphertext/Iv/AuthTag (encrypted secret, never returned in a
// normal GET) and uses nested `select` (not `include`) for assignedKey/createdBy so the
// related SSHKey's storageRef/iv/authTag and the creator's passwordHash are never
// serialized into a server response either.
export const SERVER_SELECT = {
  id: true,
  hostname: true,
  ipAddress: true,
  os: true,
  environment: true,
  application: true,
  owner: true,
  location: true,
  username: true,
  sshPort: true,
  description: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  assignedKey: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.ServerSelect;
