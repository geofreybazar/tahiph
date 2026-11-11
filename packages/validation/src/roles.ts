import { z } from 'zod';
import { idSchema } from './common.js';

/** Permission strings; the API checks them against the catalogue in @tahi/types. */
const permissionListSchema = z
  .array(z.string().min(1).max(64))
  .max(100)
  .transform((list) => [...new Set(list)].sort());

const roleNameSchema = z.string().trim().min(2).max(50);

export const createRoleRequestSchema = z
  .object({ name: roleNameSchema, permissions: permissionListSchema })
  .strict();

export const updateRoleRequestSchema = z
  .object({ name: roleNameSchema, permissions: permissionListSchema })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide name or permissions');

export const roleParamsSchema = z.object({ id: idSchema });

export const roleSchema = z.object({
  id: idSchema,
  key: z.string(),
  name: z.string(),
  isSystem: z.boolean(),
  permissions: z.array(z.string()),
  memberCount: z.number().int(),
});

export type CreateRoleRequest = z.infer<typeof createRoleRequestSchema>;
export type UpdateRoleRequest = z.infer<typeof updateRoleRequestSchema>;
