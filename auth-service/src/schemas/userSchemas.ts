import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(255),
  password: z.string().min(8).max(255),
  roleId: z.string().uuid(),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  roleId: z.string().uuid().optional(),
  password: z.string().min(8).max(255).optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
