import { z } from 'zod';
import { idSchema } from './common.js';

export const MEMBERSHIP_STATUSES = ['INVITED', 'ACTIVE', 'DISABLED'] as const;

export const staffMemberSchema = z.object({
  membershipId: idSchema,
  userId: idSchema,
  name: z.string(),
  email: z.string(),
  role: z.object({ id: idSchema, key: z.string(), name: z.string() }),
  status: z.enum(MEMBERSHIP_STATUSES),
  joinedAt: z.iso.datetime(),
});

export const staffParamsSchema = z.object({ membershipId: idSchema });

/** Change a member's role or enable/disable them. Owners and the caller cannot be changed. */
export const updateStaffMemberRequestSchema = z
  .object({ roleId: idSchema, status: z.enum(['ACTIVE', 'DISABLED']) })
  .partial()
  .strict()
  .refine((o) => Object.keys(o).length > 0, 'Provide roleId or status');

/** A pending (unused, unexpired) invitation. */
export const invitationSchema = z.object({
  id: idSchema,
  email: z.string(),
  roleId: idSchema.nullable(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});

export const invitationParamsSchema = z.object({ id: idSchema });

export type UpdateStaffMemberRequest = z.infer<typeof updateStaffMemberRequestSchema>;
