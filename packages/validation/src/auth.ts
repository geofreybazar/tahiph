import { z } from 'zod';
import { idSchema } from './common.js';

/**
 * Staff authentication contracts (docs/AUTHENTICATION_AND_AUTHORIZATION.md §3).
 * Auth endpoints reject unknown keys (.strict()), per docs/API_STANDARDS.md §4.
 */

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** 10–128 characters, no composition rules (§4). */
export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128, 'Use at most 128 characters');

export const personNameSchema = z.string().trim().min(1).max(100);

/** Opaque single-use token from an email link: 32 random bytes, base64url. */
export const emailTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid token');

export const registerRequestSchema = z
  .object({ email: emailSchema, password: passwordSchema, name: personNameSchema })
  .strict();

export const loginRequestSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();

export const emailOnlyRequestSchema = z.object({ email: emailSchema }).strict();

export const tokenRequestSchema = z.object({ token: emailTokenSchema }).strict();

export const resetPasswordRequestSchema = z
  .object({ token: emailTokenSchema, password: passwordSchema })
  .strict();

export const switchTenantRequestSchema = z.object({ membershipId: idSchema }).strict();

/** New users supply name + password; existing users accept while signed in. */
export const acceptInvitationRequestSchema = z
  .object({
    token: emailTokenSchema,
    name: personNameSchema.optional(),
    password: passwordSchema.optional(),
  })
  .strict();

export const acceptedResponseSchema = z.object({ status: z.literal('accepted') });

export const csrfResponseSchema = z.object({ csrfToken: z.string() });

export const membershipSummarySchema = z.object({
  membershipId: idSchema,
  status: z.enum(['INVITED', 'ACTIVE', 'DISABLED']),
  atelier: z.object({ id: idSchema, name: z.string(), slug: z.string(), status: z.string() }),
  role: z.object({ key: z.string(), name: z.string() }),
});

export const meResponseSchema = z.object({
  user: z.object({ id: idSchema, email: z.string(), name: z.string() }),
  activeMembershipId: idSchema.nullable(),
  permissions: z.array(z.string()),
  memberships: z.array(membershipSummarySchema),
});

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
