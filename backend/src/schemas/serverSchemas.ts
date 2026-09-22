import { z } from 'zod';

export const operatingSystemEnum = z.enum(['LINUX', 'WINDOWS', 'OTHER']);
export const environmentEnum = z.enum(['PRODUCTION', 'UAT', 'DEVELOPMENT', 'TEST']);
export const serverStatusEnum = z.enum(['ACTIVE', 'INACTIVE', 'DECOMMISSIONED']);

export const createServerSchema = z.object({
  hostname: z.string().min(1).max(255),
  ipAddress: z.string().min(1).max(45),
  os: operatingSystemEnum,
  environment: environmentEnum,
  application: z.string().min(1).max(255),
  owner: z.string().min(1).max(255),
  location: z.string().max(255).optional(),
  username: z.string().min(1).max(100),
  sshPort: z.coerce.number().int().min(1).max(65535).default(22),
  description: z.string().max(2000).optional(),
});

export const updateServerSchema = createServerSchema.partial().extend({
  status: serverStatusEnum.optional(),
});

export const listServersQuerySchema = z.object({
  search: z.string().optional(),
  os: operatingSystemEnum.optional(),
  environment: environmentEnum.optional(),
  status: serverStatusEnum.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(['hostname', 'createdAt', 'environment', 'os']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type CreateServerInput = z.infer<typeof createServerSchema>;
export type UpdateServerInput = z.infer<typeof updateServerSchema>;
export type ListServersQuery = z.infer<typeof listServersQuerySchema>;
