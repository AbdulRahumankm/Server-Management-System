import { z } from 'zod';

export const listAuditLogsQuerySchema = z.object({
  action: z.string().optional(),
  resourceType: z.string().optional(),
  userId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
