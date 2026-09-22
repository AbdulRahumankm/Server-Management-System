import { z } from 'zod';

export const uploadKeyMetadataSchema = z.object({
  name: z.string().min(1).max(255),
  keyType: z.enum(['rsa', 'ed25519', 'ecdsa', 'dsa']),
  description: z.string().max(2000).optional(),
});

export const assignKeySchema = z.object({
  serverId: z.string().uuid(),
});

export type UploadKeyMetadataInput = z.infer<typeof uploadKeyMetadataSchema>;
export type AssignKeyInput = z.infer<typeof assignKeySchema>;
